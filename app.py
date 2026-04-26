"""
SentinelKeys — Ethical Keylogger Dashboard
Flask backend with SQLite database, session management, and real-time APIs.
"""

import os
import io
import csv
import json
import hashlib
import sqlite3
import time
from datetime import datetime, timedelta
from collections import Counter
from functools import wraps
from flask import (Flask, request, jsonify, send_from_directory,
                   session, redirect, url_for)
from cryptography.fernet import Fernet

app = Flask(__name__, static_folder='.', static_url_path='')
app.secret_key = os.urandom(32)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'sentinel_keys.db')

# Encryption key (persisted to file)
KEY_FILE = os.path.join(BASE_DIR, 'encryption.key')
if os.path.exists(KEY_FILE):
    with open(KEY_FILE, 'rb') as f:
        FERNET_KEY = f.read()
else:
    FERNET_KEY = Fernet.generate_key()
    with open(KEY_FILE, 'wb') as f:
        f.write(FERNET_KEY)
cipher = Fernet(FERNET_KEY)

# ==========================================
# DATABASE
# ==========================================
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS keystrokes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_char TEXT NOT NULL,
            key_type TEXT DEFAULT 'printable',
            timestamp TEXT NOT NULL,
            session_id TEXT,
            flagged INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            start_time TEXT NOT NULL,
            end_time TEXT,
            total_keys INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active',
            notes TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alert_type TEXT NOT NULL,
            message TEXT NOT NULL,
            severity TEXT DEFAULT 'info',
            timestamp TEXT NOT NULL,
            read INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_keystrokes_ts ON keystrokes(timestamp);
        CREATE INDEX IF NOT EXISTS idx_keystrokes_session ON keystrokes(session_id);
        CREATE INDEX IF NOT EXISTS idx_alerts_read ON alerts(read);
    ''')
    # Create default admin user if not exists
    cur = conn.execute("SELECT COUNT(*) as cnt FROM users")
    if cur.fetchone()['cnt'] == 0:
        pw_hash = hashlib.sha256('admin123'.encode()).hexdigest()
        conn.execute("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                     ('admin', pw_hash, datetime.now().isoformat()))
    conn.commit()
    conn.close()

init_db()

# Active session tracking
active_session = {'id': None, 'logging': False}

# Suspicious patterns
SUSPICIOUS_PATTERNS = [
    {'name': 'Rapid Typing', 'desc': 'More than 15 keys per second detected', 'threshold': 15},
    {'name': 'Repeated Key', 'desc': 'Same key pressed 20+ times in a row', 'threshold': 20},
    {'name': 'Special Key Spam', 'desc': 'Excessive special key usage', 'threshold': 30},
]

# ==========================================
# AUTH
# ==========================================
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username', '')
    password = data.get('password', '')
    pw_hash = hashlib.sha256(password.encode()).hexdigest()
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE username = ? AND password_hash = ?",
                        (username, pw_hash)).fetchone()
    conn.close()
    if user:
        session['logged_in'] = True
        session['username'] = username
        create_alert('info', f'User {username} logged in', 'info')
        return jsonify({'success': True, 'username': username})
    return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    username = session.get('username', 'Unknown')
    create_alert('info', f'User {username} logged out', 'info')
    session.clear()
    return jsonify({'success': True})

@app.route('/api/auth/status')
def auth_status():
    return jsonify({
        'logged_in': session.get('logged_in', False),
        'username': session.get('username', '')
    })

# ==========================================
# SESSION MANAGEMENT
# ==========================================
@app.route('/api/sessions/start', methods=['POST'])
@login_required
def start_session():
    if active_session['logging']:
        return jsonify({'error': 'Session already active'}), 400
    sid = f"SES-{datetime.now().strftime('%Y%m%d%H%M%S')}-{os.urandom(3).hex()}"
    now = datetime.now().isoformat()
    conn = get_db()
    conn.execute("INSERT INTO sessions (id, start_time, status) VALUES (?, ?, 'active')", (sid, now))
    conn.commit()
    conn.close()
    active_session['id'] = sid
    active_session['logging'] = True
    create_alert('session', f'Session {sid} started', 'info')
    return jsonify({'success': True, 'session_id': sid, 'start_time': now})

@app.route('/api/sessions/stop', methods=['POST'])
@login_required
def stop_session():
    if not active_session['logging']:
        return jsonify({'error': 'No active session'}), 400
    sid = active_session['id']
    now = datetime.now().isoformat()
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) as cnt FROM keystrokes WHERE session_id = ?", (sid,)).fetchone()['cnt']
    conn.execute("UPDATE sessions SET end_time = ?, total_keys = ?, status = 'completed' WHERE id = ?",
                 (now, total, sid))
    conn.commit()
    conn.close()
    active_session['id'] = None
    active_session['logging'] = False
    create_alert('session', f'Session {sid} stopped — {total} keys logged', 'info')
    return jsonify({'success': True, 'session_id': sid, 'total_keys': total})

@app.route('/api/sessions')
@login_required
def list_sessions():
    conn = get_db()
    rows = conn.execute("SELECT * FROM sessions ORDER BY start_time DESC LIMIT 50").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/sessions/active')
@login_required
def active_session_info():
    return jsonify({
        'active': active_session['logging'],
        'session_id': active_session['id']
    })

# ==========================================
# KEYSTROKE LOGGING
# ==========================================
@app.route('/api/keystrokes/log', methods=['POST'])
@login_required
def log_keystroke():
    if not active_session['logging']:
        return jsonify({'error': 'No active session'}), 400
    data = request.get_json()
    key_char = data.get('key', '')
    key_type = data.get('type', 'printable')
    ts = datetime.now().isoformat()
    sid = active_session['id']

    conn = get_db()
    conn.execute("INSERT INTO keystrokes (key_char, key_type, timestamp, session_id) VALUES (?, ?, ?, ?)",
                 (key_char, key_type, ts, sid))
    conn.commit()

    # Check for suspicious activity
    check_suspicious(conn, sid, key_char, key_type)
    conn.close()

    return jsonify({'success': True, 'timestamp': ts})

@app.route('/api/keystrokes/batch', methods=['POST'])
@login_required
def log_batch():
    if not active_session['logging']:
        return jsonify({'error': 'No active session'}), 400
    data = request.get_json()
    keys = data.get('keys', [])
    sid = active_session['id']
    ts = datetime.now().isoformat()

    conn = get_db()
    for k in keys:
        conn.execute("INSERT INTO keystrokes (key_char, key_type, timestamp, session_id) VALUES (?, ?, ?, ?)",
                     (k.get('key', ''), k.get('type', 'printable'), ts, sid))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'count': len(keys)})

@app.route('/api/keystrokes')
@login_required
def get_keystrokes():
    session_id = request.args.get('session_id', '')
    search = request.args.get('search', '')
    key_type = request.args.get('type', '')
    flagged = request.args.get('flagged', '')
    limit = min(int(request.args.get('limit', 200)), 1000)
    offset = int(request.args.get('offset', 0))

    query = "SELECT * FROM keystrokes WHERE 1=1"
    params = []

    if session_id:
        query += " AND session_id = ?"
        params.append(session_id)
    if search:
        query += " AND key_char LIKE ?"
        params.append(f'%{search}%')
    if key_type:
        query += " AND key_type = ?"
        params.append(key_type)
    if flagged:
        query += " AND flagged = 1"

    query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    conn = get_db()
    rows = conn.execute(query, params).fetchall()
    total = conn.execute("SELECT COUNT(*) as cnt FROM keystrokes" +
                         (" WHERE session_id = ?" if session_id else ""),
                         ([session_id] if session_id else [])).fetchone()['cnt']
    conn.close()
    return jsonify({'data': [dict(r) for r in rows], 'total': total})

# ==========================================
# ANALYTICS
# ==========================================
@app.route('/api/analytics/summary')
@login_required
def analytics_summary():
    conn = get_db()
    total_keys = conn.execute("SELECT COUNT(*) as cnt FROM keystrokes").fetchone()['cnt']
    total_sessions = conn.execute("SELECT COUNT(*) as cnt FROM sessions").fetchone()['cnt']
    active_sessions = conn.execute("SELECT COUNT(*) as cnt FROM sessions WHERE status='active'").fetchone()['cnt']
    flagged = conn.execute("SELECT COUNT(*) as cnt FROM keystrokes WHERE flagged=1").fetchone()['cnt']
    unread_alerts = conn.execute("SELECT COUNT(*) as cnt FROM alerts WHERE read=0").fetchone()['cnt']

    # Keys per type
    type_dist = conn.execute("""
        SELECT key_type, COUNT(*) as cnt FROM keystrokes GROUP BY key_type
    """).fetchall()

    # Top keys
    top_keys = conn.execute("""
        SELECT key_char, COUNT(*) as cnt FROM keystrokes
        GROUP BY key_char ORDER BY cnt DESC LIMIT 10
    """).fetchall()

    # Hourly distribution (last 24h)
    hourly = conn.execute("""
        SELECT strftime('%H', timestamp) as hour, COUNT(*) as cnt
        FROM keystrokes
        WHERE timestamp >= datetime('now', '-24 hours')
        GROUP BY hour ORDER BY hour
    """).fetchall()

    # Keys per minute (last 10 minutes)
    kpm = conn.execute("""
        SELECT strftime('%H:%M', timestamp) as minute, COUNT(*) as cnt
        FROM keystrokes
        WHERE timestamp >= datetime('now', '-10 minutes')
        GROUP BY minute ORDER BY minute
    """).fetchall()

    # Daily trend (last 7 days)
    daily = conn.execute("""
        SELECT date(timestamp) as day, COUNT(*) as cnt
        FROM keystrokes
        WHERE timestamp >= date('now', '-7 days')
        GROUP BY day ORDER BY day
    """).fetchall()

    conn.close()
    return jsonify({
        'totalKeys': total_keys,
        'totalSessions': total_sessions,
        'activeSessions': active_sessions,
        'flaggedKeys': flagged,
        'unreadAlerts': unread_alerts,
        'typeDistribution': [dict(r) for r in type_dist],
        'topKeys': [dict(r) for r in top_keys],
        'hourlyDistribution': [dict(r) for r in hourly],
        'keysPerMinute': [dict(r) for r in kpm],
        'dailyTrend': [dict(r) for r in daily],
        'isLogging': active_session['logging'],
        'activeSessionId': active_session['id']
    })

@app.route('/api/analytics/realtime')
@login_required
def realtime_analytics():
    """Get last N keystrokes for real-time feed"""
    limit = int(request.args.get('limit', 30))
    conn = get_db()
    recent = conn.execute("""
        SELECT * FROM keystrokes ORDER BY id DESC LIMIT ?
    """, (limit,)).fetchall()

    # Calculate KPM  
    one_min_ago = (datetime.now() - timedelta(minutes=1)).isoformat()
    kpm = conn.execute("""
        SELECT COUNT(*) as cnt FROM keystrokes WHERE timestamp >= ?
    """, (one_min_ago,)).fetchone()['cnt']

    conn.close()
    return jsonify({
        'recentKeys': [dict(r) for r in recent],
        'keysPerMinute': kpm,
        'isLogging': active_session['logging']
    })

# ==========================================
# TIMELINE
# ==========================================
@app.route('/api/timeline')
@login_required
def timeline():
    conn = get_db()
    # Combine sessions and alerts into timeline events
    events = []

    sessions = conn.execute("SELECT * FROM sessions ORDER BY start_time DESC LIMIT 20").fetchall()
    for s in sessions:
        events.append({
            'type': 'session',
            'title': f"Session {s['id']}",
            'description': f"Status: {s['status']} — {s['total_keys']} keys",
            'timestamp': s['start_time'],
            'icon': 'session'
        })

    alerts = conn.execute("SELECT * FROM alerts ORDER BY timestamp DESC LIMIT 30").fetchall()
    for a in alerts:
        events.append({
            'type': 'alert',
            'title': a['alert_type'].title(),
            'description': a['message'],
            'timestamp': a['timestamp'],
            'severity': a['severity'],
            'icon': 'alert'
        })

    events.sort(key=lambda x: x['timestamp'], reverse=True)
    conn.close()
    return jsonify(events[:40])

# ==========================================
# ALERTS / NOTIFICATIONS
# ==========================================
@app.route('/api/alerts')
@login_required
def get_alerts():
    conn = get_db()
    rows = conn.execute("SELECT * FROM alerts ORDER BY timestamp DESC LIMIT 50").fetchall()
    unread = conn.execute("SELECT COUNT(*) as cnt FROM alerts WHERE read=0").fetchone()['cnt']
    conn.close()
    return jsonify({'alerts': [dict(r) for r in rows], 'unreadCount': unread})

@app.route('/api/alerts/read', methods=['POST'])
@login_required
def mark_alerts_read():
    data = request.get_json()
    alert_id = data.get('id')
    conn = get_db()
    if alert_id:
        conn.execute("UPDATE alerts SET read=1 WHERE id=?", (alert_id,))
    else:
        conn.execute("UPDATE alerts SET read=1")
    conn.commit()
    conn.close()
    return jsonify({'success': True})

def create_alert(alert_type, message, severity='info'):
    conn = get_db()
    conn.execute("INSERT INTO alerts (alert_type, message, severity, timestamp) VALUES (?, ?, ?, ?)",
                 (alert_type, message, severity, datetime.now().isoformat()))
    conn.commit()
    conn.close()

# ==========================================
# SUSPICIOUS ACTIVITY DETECTION
# ==========================================
def check_suspicious(conn, session_id, key_char, key_type):
    # Check rapid typing (keys in last second)
    one_sec_ago = (datetime.now() - timedelta(seconds=1)).isoformat()
    recent_count = conn.execute(
        "SELECT COUNT(*) as cnt FROM keystrokes WHERE session_id=? AND timestamp>=?",
        (session_id, one_sec_ago)
    ).fetchone()['cnt']

    if recent_count >= SUSPICIOUS_PATTERNS[0]['threshold']:
        conn.execute("UPDATE keystrokes SET flagged=1 WHERE session_id=? AND timestamp>=?",
                     (session_id, one_sec_ago))
        conn.commit()
        create_alert('suspicious', f"Rapid typing detected: {recent_count} keys/sec in session {session_id}", 'warning')

    # Check repeated key
    last_n = conn.execute("""
        SELECT key_char FROM keystrokes WHERE session_id=?
        ORDER BY id DESC LIMIT ?
    """, (session_id, SUSPICIOUS_PATTERNS[1]['threshold'])).fetchall()

    if len(last_n) >= SUSPICIOUS_PATTERNS[1]['threshold']:
        chars = [r['key_char'] for r in last_n]
        if len(set(chars)) == 1:
            create_alert('suspicious', f"Repeated key '{chars[0]}' detected {len(chars)} times", 'warning')

    # Special key spam
    five_sec_ago = (datetime.now() - timedelta(seconds=5)).isoformat()
    special_count = conn.execute("""
        SELECT COUNT(*) as cnt FROM keystrokes
        WHERE session_id=? AND key_type='special' AND timestamp>=?
    """, (session_id, five_sec_ago)).fetchone()['cnt']

    if special_count >= SUSPICIOUS_PATTERNS[2]['threshold']:
        create_alert('suspicious', f"Special key spam detected: {special_count} in 5 seconds", 'critical')

# ==========================================
# ENCRYPT / EXPORT
# ==========================================
@app.route('/api/export/csv')
@login_required
def export_csv():
    session_id = request.args.get('session_id', '')
    conn = get_db()
    query = "SELECT * FROM keystrokes"
    params = []
    if session_id:
        query += " WHERE session_id = ?"
        params.append(session_id)
    query += " ORDER BY timestamp"
    rows = conn.execute(query, params).fetchall()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['ID', 'Key', 'Type', 'Timestamp', 'Session', 'Flagged'])
    for r in rows:
        writer.writerow([r['id'], r['key_char'], r['key_type'], r['timestamp'], r['session_id'], r['flagged']])

    return app.response_class(
        output.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename=keylog_export_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'}
    )

@app.route('/api/export/encrypt', methods=['POST'])
@login_required
def encrypt_export():
    conn = get_db()
    rows = conn.execute("SELECT * FROM keystrokes ORDER BY timestamp").fetchall()
    conn.close()

    data = json.dumps([dict(r) for r in rows]).encode()
    encrypted = cipher.encrypt(data)

    return app.response_class(
        encrypted,
        mimetype='application/octet-stream',
        headers={'Content-Disposition': 'attachment; filename=keylog_encrypted.enc'}
    )

@app.route('/api/data/clear', methods=['POST'])
@login_required
def clear_data():
    conn = get_db()
    conn.execute("DELETE FROM keystrokes")
    conn.commit()
    conn.close()
    create_alert('system', 'All keystroke data cleared', 'warning')
    return jsonify({'success': True})


if __name__ == '__main__':
    app.run(debug=True, port=5050)

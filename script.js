/**
 * SentinelKeys — Ethical Keylogger Dashboard
 * Client-side JavaScript: UI, Charts, Real-time Feed, Keystroke Capture
 */
(function () {
    'use strict';

    // ============================
    // STATE
    // ============================
    const state = {
        currentView: 'overview',
        isLogging: false,
        sessionId: null,
        realtimeInterval: null,
        summaryInterval: null,
        keyBuffer: [],
        bufferInterval: null,
        notifOpen: false,
        logsPage: 0,
        logsLimit: 50,
        sidebarOpen: false
    };

    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

    // ============================
    // INIT
    // ============================
    function init() {
        initTheme();
        bindEvents();
        checkAuth();
    }

    function initTheme() {
        const saved = localStorage.getItem('sentinel-theme');
        if (saved) document.documentElement.setAttribute('data-theme', saved);
    }

    function toggleTheme() {
        const cur = document.documentElement.getAttribute('data-theme');
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('sentinel-theme', next);
    }

    // ============================
    // AUTH
    // ============================
    async function checkAuth() {
        try {
            const r = await fetch('/api/auth/status');
            const d = await r.json();
            if (d.logged_in) {
                showDashboard(d.username);
            } else {
                showLogin();
            }
        } catch {
            showLogin();
        }
    }

    function showLogin() {
        $('#login-screen').style.display = 'flex';
        $('#dashboard').style.display = 'none';
    }

    function showDashboard(username) {
        $('#login-screen').style.display = 'none';
        $('#dashboard').style.display = 'flex';
        $('#user-name').textContent = username;
        $('#user-avatar').textContent = username.charAt(0).toUpperCase();
        loadDashboardData();
        startPolling();
        checkActiveSession();
    }

    async function handleLogin(e) {
        e.preventDefault();
        const username = $('#login-user').value;
        const password = $('#login-pass').value;
        try {
            const r = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const d = await r.json();
            if (d.success) {
                showDashboard(d.username);
                toast('Logged in successfully', 'success');
            } else {
                $('#login-error').textContent = d.error || 'Login failed';
            }
        } catch {
            $('#login-error').textContent = 'Server connection failed';
        }
    }

    async function handleLogout() {
        stopPolling();
        stopKeystrokeCapture();
        await fetch('/api/auth/logout', { method: 'POST' });
        showLogin();
        toast('Logged out', 'info');
    }

    // ============================
    // NAVIGATION
    // ============================
    function switchView(viewId) {
        state.currentView = viewId;
        $$('.view').forEach(v => v.classList.remove('active'));
        $(`#view-${viewId}`).classList.add('active');
        $$('.nav-item[data-view]').forEach(n => n.classList.remove('active'));
        $(`.nav-item[data-view="${viewId}"]`).classList.add('active');

        const titles = {
            overview: 'Dashboard Overview',
            realtime: 'Real-Time Monitor',
            analytics: 'Keystroke Analytics',
            sessions: 'Session Management',
            logs: 'Keystroke Logs',
            timeline: 'Activity Timeline',
            security: 'Security Center'
        };
        $('#view-title').textContent = titles[viewId] || 'Dashboard';

        // Load view-specific data
        if (viewId === 'sessions') loadSessions();
        if (viewId === 'logs') loadLogs();
        if (viewId === 'timeline') loadTimeline();
        if (viewId === 'security') loadSecurityData();
        if (viewId === 'analytics') loadAnalytics();

        // Close sidebar on mobile
        if (state.sidebarOpen) {
            $('#sidebar').classList.remove('open');
            state.sidebarOpen = false;
        }
    }

    // ============================
    // SESSION MANAGEMENT
    // ============================
    async function checkActiveSession() {
        try {
            const r = await fetch('/api/sessions/active');
            const d = await r.json();
            if (d.active) {
                state.isLogging = true;
                state.sessionId = d.session_id;
                updateSessionUI(true);
                startKeystrokeCapture();
            }
        } catch { /* ignore */ }
    }

    async function startSession() {
        try {
            const r = await fetch('/api/sessions/start', { method: 'POST' });
            const d = await r.json();
            if (d.success) {
                state.isLogging = true;
                state.sessionId = d.session_id;
                updateSessionUI(true);
                startKeystrokeCapture();
                toast('Logging session started', 'success');
            } else {
                toast(d.error, 'error');
            }
        } catch { toast('Failed to start session', 'error'); }
    }

    async function stopSession() {
        try {
            const r = await fetch('/api/sessions/stop', { method: 'POST' });
            const d = await r.json();
            if (d.success) {
                state.isLogging = false;
                state.sessionId = null;
                updateSessionUI(false);
                stopKeystrokeCapture();
                toast(`Session stopped — ${d.total_keys} keys captured`, 'info');
                loadDashboardData();
            }
        } catch { toast('Failed to stop session', 'error'); }
    }

    function updateSessionUI(active) {
        const dot = $('#status-dot');
        const label = $('#session-label');
        const btnStart = $('#btn-start-session');
        const btnStop = $('#btn-stop-session');

        if (active) {
            dot.className = 'status-dot active';
            label.textContent = 'Recording';
            btnStart.style.display = 'none';
            btnStop.style.display = 'flex';
        } else {
            dot.className = 'status-dot idle';
            label.textContent = 'Idle';
            btnStart.style.display = 'flex';
            btnStop.style.display = 'none';
        }

        // Update real-time view
        $('#rt-status').textContent = active ? 'Recording' : 'Idle';
        $('#rt-sid').textContent = state.sessionId || '—';
    }

    // ============================
    // KEYSTROKE CAPTURE
    // ============================
    function startKeystrokeCapture() {
        document.addEventListener('keydown', captureKey);
        state.bufferInterval = setInterval(flushKeyBuffer, 1000);
    }

    function stopKeystrokeCapture() {
        document.removeEventListener('keydown', captureKey);
        if (state.bufferInterval) clearInterval(state.bufferInterval);
        flushKeyBuffer();
    }

    function captureKey(e) {
        if (!state.isLogging) return;

        // Don't capture keys in login form
        if (e.target.closest('#login-form')) return;
        // Don't capture keys when typing in search/filter inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

        let keyChar = e.key;
        let keyType = 'printable';

        if (e.key.length > 1) {
            keyChar = `[${e.key}]`;
            keyType = 'special';
            if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
                keyType = 'modifier';
            }
        }

        state.keyBuffer.push({ key: keyChar, type: keyType });
    }

    async function flushKeyBuffer() {
        if (state.keyBuffer.length === 0) return;
        const keys = [...state.keyBuffer];
        state.keyBuffer = [];

        try {
            await fetch('/api/keystrokes/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keys })
            });
        } catch { /* buffer will be retried */ }
    }

    // ============================
    // POLLING & DATA LOADING
    // ============================
    function startPolling() {
        loadDashboardData();
        state.summaryInterval = setInterval(loadDashboardData, 5000);
        state.realtimeInterval = setInterval(loadRealtimeData, 2000);
    }

    function stopPolling() {
        if (state.summaryInterval) clearInterval(state.summaryInterval);
        if (state.realtimeInterval) clearInterval(state.realtimeInterval);
    }

    async function loadDashboardData() {
        try {
            const r = await fetch('/api/analytics/summary');
            const d = await r.json();
            updateSummaryCards(d);
            drawHourlyChart(d.hourlyDistribution);
            drawTypeChart(d.typeDistribution);
            drawDailyChart(d.dailyTrend);
            renderTopKeys(d.topKeys);
            updateNotifBadge(d.unreadAlerts);
        } catch { /* retry next cycle */ }
    }

    async function loadRealtimeData() {
        if (state.currentView !== 'realtime' && state.currentView !== 'overview') return;
        try {
            const r = await fetch('/api/analytics/realtime?limit=40');
            const d = await r.json();
            updateRealtimeFeed(d.recentKeys);
            updateKPM(d.keysPerMinute);
        } catch { /* ignore */ }
    }

    async function loadSessions() {
        try {
            const r = await fetch('/api/sessions');
            const sessions = await r.json();
            renderSessions(sessions);
            populateSessionFilter(sessions);
        } catch { /* ignore */ }
    }

    async function loadLogs() {
        const search = $('#log-search').value;
        const type = $('#log-filter-type').value;
        const sessionId = $('#log-filter-session').value;
        const flagged = $('#log-filter-flagged').checked;

        const params = new URLSearchParams({
            limit: state.logsLimit,
            offset: state.logsPage * state.logsLimit
        });
        if (search) params.append('search', search);
        if (type) params.append('type', type);
        if (sessionId) params.append('session_id', sessionId);
        if (flagged) params.append('flagged', '1');

        try {
            const r = await fetch(`/api/keystrokes?${params}`);
            const d = await r.json();
            renderLogs(d.data, d.total);
        } catch { /* ignore */ }
    }

    async function loadTimeline() {
        try {
            const r = await fetch('/api/timeline');
            const events = await r.json();
            renderTimeline(events);
        } catch { /* ignore */ }
    }

    async function loadSecurityData() {
        try {
            const r = await fetch('/api/alerts');
            const d = await r.json();
            renderSuspiciousActivity(d.alerts.filter(a => a.alert_type === 'suspicious'));
        } catch { /* ignore */ }
    }

    async function loadAnalytics() {
        try {
            const r = await fetch('/api/analytics/summary');
            const d = await r.json();
            drawFreqChart(d.topKeys);
            drawTypePieChart(d.typeDistribution);
            drawHeatmapChart(d.hourlyDistribution);
        } catch { /* ignore */ }
    }

    // ============================
    // RENDERING
    // ============================
    function updateSummaryCards(d) {
        animateNumber($('#sc-total-keys'), d.totalKeys);
        animateNumber($('#sc-sessions'), d.totalSessions);
        animateNumber($('#sc-flagged'), d.flaggedKeys);
        animateNumber($('#sc-alerts'), d.unreadAlerts);
    }

    function animateNumber(el, target) {
        const current = parseInt(el.textContent.replace(/,/g, '')) || 0;
        if (current === target) return;
        const diff = target - current;
        const steps = 20;
        const increment = diff / steps;
        let step = 0;
        const timer = setInterval(() => {
            step++;
            const val = Math.round(current + increment * step);
            el.textContent = val.toLocaleString();
            if (step >= steps) {
                el.textContent = target.toLocaleString();
                clearInterval(timer);
            }
        }, 30);
    }

    function renderTopKeys(topKeys) {
        const container = $('#top-keys-list');
        if (!topKeys.length) {
            container.innerHTML = '<p style="color:var(--text-3);text-align:center;padding:20px;">No data yet</p>';
            return;
        }
        const maxCount = topKeys[0]?.cnt || 1;
        container.innerHTML = topKeys.map(k => `
            <div class="top-key-item">
                <span class="top-key-char">${escapeHtml(k.key_char)}</span>
                <div class="top-key-bar"><div class="top-key-fill" style="width:${(k.cnt/maxCount)*100}%"></div></div>
                <span class="top-key-count">${k.cnt}</span>
            </div>
        `).join('');
    }

    function updateRealtimeFeed(keys) {
        const stream = $('#rt-stream');
        const sequence = $('#key-sequence');

        stream.innerHTML = keys.map(k => {
            const cls = k.flagged ? 'flagged' : (k.key_type !== 'printable' ? 'special' : '');
            const time = k.timestamp ? k.timestamp.split('T')[1]?.substring(0, 8) || '' : '';
            return `<div class="rt-entry">
                <span class="rt-time">${time}</span>
                <span class="rt-key ${cls}">${escapeHtml(k.key_char)}</span>
                <span class="rt-type">${k.key_type}</span>
            </div>`;
        }).join('');

        sequence.innerHTML = keys.slice(0, 30).map(k =>
            `<span class="key-tag">${escapeHtml(k.key_char)}</span>`
        ).join('');
    }

    function updateKPM(kpm) {
        $('#kpm-badge').textContent = `${kpm} keys/min`;
        $('#rt-kpm').textContent = kpm;
    }

    function renderSessions(sessions) {
        const tbody = $('#sessions-tbody');
        const empty = $('#sessions-empty');

        if (!sessions.length) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';
        tbody.innerHTML = sessions.map(s => `
            <tr>
                <td><span style="font-family:var(--font-mono);font-size:.82rem">${s.id}</span></td>
                <td>${formatTime(s.start_time)}</td>
                <td>${s.end_time ? formatTime(s.end_time) : '—'}</td>
                <td>${s.total_keys}</td>
                <td><span class="status-badge ${s.status}">${s.status}</span></td>
            </tr>
        `).join('');
    }

    function populateSessionFilter(sessions) {
        const sel = $('#log-filter-session');
        const current = sel.value;
        sel.innerHTML = '<option value="">All Sessions</option>' +
            sessions.map(s => `<option value="${s.id}">${s.id}</option>`).join('');
        sel.value = current;
    }

    function renderLogs(logs, total) {
        const tbody = $('#logs-tbody');
        const empty = $('#logs-empty');
        const pagination = $('#logs-pagination');

        if (!logs.length) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            pagination.innerHTML = '';
            return;
        }
        empty.style.display = 'none';
        tbody.innerHTML = logs.map(l => `
            <tr>
                <td>${l.id}</td>
                <td><span class="rt-key ${l.flagged ? 'flagged' : (l.key_type !== 'printable' ? 'special' : '')}">${escapeHtml(l.key_char)}</span></td>
                <td>${l.key_type}</td>
                <td style="font-family:var(--font-mono);font-size:.82rem">${formatTime(l.timestamp)}</td>
                <td style="font-family:var(--font-mono);font-size:.78rem">${l.session_id || '—'}</td>
                <td>${l.flagged ? '<span class="flag-icon">⚠️</span>' : ''}</td>
            </tr>
        `).join('');

        // Pagination
        const totalPages = Math.ceil(total / state.logsLimit);
        let html = '';
        for (let i = 0; i < Math.min(totalPages, 10); i++) {
            html += `<button class="page-btn ${i === state.logsPage ? 'active' : ''}" data-page="${i}">${i + 1}</button>`;
        }
        pagination.innerHTML = html;
        pagination.querySelectorAll('.page-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                state.logsPage = parseInt(btn.dataset.page);
                loadLogs();
            });
        });
    }

    function renderTimeline(events) {
        const container = $('#timeline-container');
        const empty = $('#timeline-empty');

        if (!events.length) {
            container.innerHTML = '';
            container.appendChild(empty);
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';

        container.innerHTML = events.map(e => {
            const dotClass = e.type === 'session' ? 'session' : (e.severity || 'info');
            return `<div class="timeline-item">
                <div class="timeline-dot ${dotClass}"></div>
                <div class="timeline-card">
                    <h4>${escapeHtml(e.title)}</h4>
                    <p>${escapeHtml(e.description)}</p>
                    <span class="tl-time">${formatTime(e.timestamp)}</span>
                </div>
            </div>`;
        }).join('');
    }

    function renderSuspiciousActivity(alerts) {
        const container = $('#suspicious-list');
        if (!alerts.length) {
            container.innerHTML = '<p class="sec-empty">No suspicious activity detected.</p>';
            return;
        }
        container.innerHTML = alerts.slice(0, 10).map(a => `
            <div class="sec-stat">
                <span class="sec-label">${escapeHtml(a.message)}</span>
                <span class="sec-value" style="color:var(--${a.severity === 'critical' ? 'error' : 'warning'})">${a.severity.toUpperCase()}</span>
            </div>
        `).join('');
    }

    // ============================
    // NOTIFICATIONS
    // ============================
    function updateNotifBadge(count) {
        const badge = $('#notif-badge');
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    async function toggleNotifPanel() {
        state.notifOpen = !state.notifOpen;
        const panel = $('#notif-panel');
        if (state.notifOpen) {
            panel.style.display = 'block';
            await loadNotifications();
        } else {
            panel.style.display = 'none';
        }
    }

    async function loadNotifications() {
        try {
            const r = await fetch('/api/alerts');
            const d = await r.json();
            const list = $('#notif-list');
            if (!d.alerts.length) {
                list.innerHTML = '<p style="text-align:center;color:var(--text-3);padding:40px;">No notifications</p>';
                return;
            }
            list.innerHTML = d.alerts.map(a => `
                <div class="notif-item ${a.read ? '' : 'unread'}" data-id="${a.id}">
                    <div class="ni-type ${a.alert_type}">${a.alert_type}</div>
                    <div class="ni-msg">${escapeHtml(a.message)}</div>
                    <div class="ni-time">${formatTime(a.timestamp)}</div>
                </div>
            `).join('');

            list.querySelectorAll('.notif-item.unread').forEach(item => {
                item.addEventListener('click', async () => {
                    await fetch('/api/alerts/read', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: parseInt(item.dataset.id) })
                    });
                    item.classList.remove('unread');
                    loadDashboardData();
                });
            });
        } catch { /* ignore */ }
    }

    async function markAllRead() {
        await fetch('/api/alerts/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        loadNotifications();
        loadDashboardData();
        toast('All notifications marked as read', 'info');
    }

    // ============================
    // CHARTS (simple canvas)
    // ============================
    function getChartColors() {
        return {
            accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6366f1',
            accent2: getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || '#a855f7',
            accent3: getComputedStyle(document.documentElement).getPropertyValue('--accent-3').trim() || '#ec4899',
            text3: getComputedStyle(document.documentElement).getPropertyValue('--text-3').trim() || '#555',
            grid: getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim() || 'rgba(0,0,0,.1)',
            success: getComputedStyle(document.documentElement).getPropertyValue('--success').trim() || '#22c55e',
            warning: getComputedStyle(document.documentElement).getPropertyValue('--warning').trim() || '#f59e0b',
            error: getComputedStyle(document.documentElement).getPropertyValue('--error').trim() || '#ef4444',
            info: getComputedStyle(document.documentElement).getPropertyValue('--info').trim() || '#3b82f6',
        };
    }

    function drawBarChart(canvasId, labels, values, color, opts = {}) {
        const canvas = $(`#${canvasId}`);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        const w = rect.width;
        const h = parseInt(canvas.height);
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        const c = getChartColors();
        const padL = 45, padR = 15, padT = 15, padB = 35;
        const chartW = w - padL - padR;
        const chartH = h - padT - padB;

        if (!values.length) {
            ctx.fillStyle = c.text3;
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data available', w / 2, h / 2);
            return;
        }

        const maxVal = Math.max(...values, 1);

        // Grid lines
        ctx.strokeStyle = c.grid;
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = padT + (chartH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(w - padR, y);
            ctx.stroke();
            ctx.fillStyle = c.text3;
            ctx.font = '10px JetBrains Mono, monospace';
            ctx.textAlign = 'right';
            ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), padL - 6, y + 4);
        }

        const barW = Math.max(6, chartW / labels.length - 4);
        const gap = (chartW - barW * labels.length) / (labels.length + 1);

        labels.forEach((label, i) => {
            const x = padL + gap + i * (barW + gap);
            const barH = (values[i] / maxVal) * chartH;
            const y = padT + chartH - barH;

            // Bar gradient
            const grad = ctx.createLinearGradient(x, y, x, padT + chartH);
            grad.addColorStop(0, color);
            grad.addColorStop(1, color + '33');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.roundRect(x, y, barW, barH, [3, 3, 0, 0]);
            ctx.fill();

            // Label
            ctx.fillStyle = c.text3;
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(label, x + barW / 2, h - 8);
        });
    }

    function drawLineChart(canvasId, labels, values, color) {
        const canvas = $(`#${canvasId}`);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        const w = rect.width;
        const h = parseInt(canvas.height);
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        const c = getChartColors();
        const padL = 45, padR = 15, padT = 15, padB = 35;
        const chartW = w - padL - padR;
        const chartH = h - padT - padB;

        if (!values.length) {
            ctx.fillStyle = c.text3;
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data available', w / 2, h / 2);
            return;
        }

        const maxVal = Math.max(...values, 1);

        // Grid
        ctx.strokeStyle = c.grid;
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = padT + (chartH / 4) * i;
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
            ctx.fillStyle = c.text3;
            ctx.font = '10px JetBrains Mono, monospace';
            ctx.textAlign = 'right';
            ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), padL - 6, y + 4);
        }

        // Area fill
        const stepX = chartW / Math.max(values.length - 1, 1);
        ctx.beginPath();
        ctx.moveTo(padL, padT + chartH);
        values.forEach((v, i) => {
            const x = padL + i * stepX;
            const y = padT + chartH - (v / maxVal) * chartH;
            ctx.lineTo(x, y);
        });
        ctx.lineTo(padL + (values.length - 1) * stepX, padT + chartH);
        ctx.closePath();
        const grd = ctx.createLinearGradient(0, padT, 0, padT + chartH);
        grd.addColorStop(0, color + '30');
        grd.addColorStop(1, color + '05');
        ctx.fillStyle = grd;
        ctx.fill();

        // Line
        ctx.beginPath();
        values.forEach((v, i) => {
            const x = padL + i * stepX;
            const y = padT + chartH - (v / maxVal) * chartH;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Dots + labels
        values.forEach((v, i) => {
            const x = padL + i * stepX;
            const y = padT + chartH - (v / maxVal) * chartH;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        });

        // X labels
        const step = Math.max(1, Math.floor(labels.length / 7));
        labels.forEach((l, i) => {
            if (i % step === 0 || i === labels.length - 1) {
                ctx.fillStyle = c.text3;
                ctx.font = '10px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(l, padL + i * stepX, h - 8);
            }
        });
    }

    function drawPieChart(canvasId, labels, values, colors) {
        const canvas = $(`#${canvasId}`);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        const w = rect.width;
        const h = parseInt(canvas.height);
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        const c = getChartColors();
        const total = values.reduce((a, b) => a + b, 0);
        if (!total) {
            ctx.fillStyle = c.text3;
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data available', w / 2, h / 2);
            return;
        }

        const cx = w * 0.38, cy = h / 2, r = Math.min(w * 0.3, h * 0.38);
        let startAngle = -Math.PI / 2;

        values.forEach((v, i) => {
            const slice = (v / total) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, startAngle, startAngle + slice);
            ctx.fillStyle = colors[i % colors.length];
            ctx.fill();
            startAngle += slice;
        });

        // Inner circle (donut)
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-card-solid').trim() || '#10101e';
        ctx.fill();

        // Center text
        ctx.fillStyle = c.text3;
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Total', cx, cy - 6);
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-1').trim();
        ctx.font = 'bold 18px JetBrains Mono, monospace';
        ctx.fillText(total.toLocaleString(), cx, cy + 14);

        // Legend
        const legX = w * 0.72;
        labels.forEach((l, i) => {
            const y = 30 + i * 28;
            ctx.fillStyle = colors[i % colors.length];
            ctx.beginPath();
            ctx.roundRect(legX, y - 5, 12, 12, 3);
            ctx.fill();
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-1').trim();
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`${l} (${v})`, legX + 18, y + 5);
            var v = values[i];
        });
    }

    function drawHourlyChart(data) {
        const labels = [], values = [];
        for (let i = 0; i < 24; i++) {
            const h = i.toString().padStart(2, '0');
            labels.push(h);
            const found = data.find(d => d.hour === h);
            values.push(found ? found.cnt : 0);
        }
        const c = getChartColors();
        drawBarChart('chart-hourly', labels, values, c.accent);
    }

    function drawTypeChart(data) {
        const labels = data.map(d => d.key_type);
        const values = data.map(d => d.cnt);
        const c = getChartColors();
        const colors = [c.accent, c.accent2, c.accent3, c.success, c.warning];
        drawPieChart('chart-types', labels, values, colors);
    }

    function drawDailyChart(data) {
        const labels = data.map(d => d.day?.substring(5) || '');
        const values = data.map(d => d.cnt);
        const c = getChartColors();
        drawLineChart('chart-daily', labels, values, c.accent2);
    }

    function drawFreqChart(data) {
        const labels = data.map(d => d.key_char);
        const values = data.map(d => d.cnt);
        const c = getChartColors();
        drawBarChart('chart-freq', labels, values, c.accent);
    }

    function drawTypePieChart(data) {
        const labels = data.map(d => d.key_type);
        const values = data.map(d => d.cnt);
        const c = getChartColors();
        drawPieChart('chart-type-pie', labels, values, [c.accent, c.accent2, c.accent3, c.success]);
    }

    function drawHeatmapChart(data) {
        const labels = [], values = [];
        for (let i = 0; i < 24; i++) {
            const h = i.toString().padStart(2, '0');
            labels.push(`${h}:00`);
            const found = data.find(d => d.hour === h);
            values.push(found ? found.cnt : 0);
        }
        const c = getChartColors();
        drawBarChart('chart-heatmap', labels, values, c.accent3);
    }

    // ============================
    // UTILITIES
    // ============================
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatTime(ts) {
        if (!ts) return '—';
        try {
            const d = new Date(ts);
            return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch { return ts; }
    }

    function toast(message, type = 'info') {
        const container = $('#toast-container');
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
        t.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;
        container.appendChild(t);
        setTimeout(() => { t.classList.add('toast-exit'); setTimeout(() => t.remove(), 300); }, 3500);
    }

    // ============================
    // EVENT BINDINGS
    // ============================
    function bindEvents() {
        // Login
        $('#login-form').addEventListener('submit', handleLogin);

        // Logout
        $('#btn-logout').addEventListener('click', handleLogout);

        // Theme
        $('#btn-theme').addEventListener('click', toggleTheme);

        // Navigation
        $$('.nav-item[data-view]').forEach(btn => {
            btn.addEventListener('click', () => switchView(btn.dataset.view));
        });

        // Sidebar toggle (mobile)
        $('#btn-sidebar-toggle').addEventListener('click', () => {
            state.sidebarOpen = !state.sidebarOpen;
            $('#sidebar').classList.toggle('open', state.sidebarOpen);
        });

        // Session controls
        $('#btn-start-session').addEventListener('click', startSession);
        $('#btn-stop-session').addEventListener('click', stopSession);
        $('#btn-new-session').addEventListener('click', startSession);

        // Notifications
        $('#btn-notif').addEventListener('click', toggleNotifPanel);
        $('#btn-mark-all-read').addEventListener('click', markAllRead);

        // Logs filters
        $('#log-search').addEventListener('input', debounce(loadLogs, 300));
        $('#log-filter-type').addEventListener('change', () => { state.logsPage = 0; loadLogs(); });
        $('#log-filter-session').addEventListener('change', () => { state.logsPage = 0; loadLogs(); });
        $('#log-filter-flagged').addEventListener('change', () => { state.logsPage = 0; loadLogs(); });

        // Export
        $('#btn-export-csv').addEventListener('click', () => {
            window.open('/api/export/csv', '_blank');
            toast('CSV exported', 'success');
        });
        $('#btn-export-enc').addEventListener('click', () => {
            window.open('/api/export/encrypt', '_blank');
            toast('Encrypted export downloaded', 'success');
        });
        if ($('#btn-encrypt-export-sec')) {
            $('#btn-encrypt-export-sec').addEventListener('click', () => {
                window.open('/api/export/encrypt', '_blank');
                toast('Encrypted export downloaded', 'success');
            });
        }

        // Clear data
        $('#btn-clear-data').addEventListener('click', async () => {
            if (!confirm('Are you sure? This will permanently delete all keystroke data.')) return;
            await fetch('/api/data/clear', { method: 'POST' });
            toast('All data cleared', 'warning');
            loadDashboardData();
        });

        // Close notif panel when clicking outside
        document.addEventListener('click', (e) => {
            if (state.notifOpen && !e.target.closest('#notif-panel') && !e.target.closest('#btn-notif')) {
                state.notifOpen = false;
                $('#notif-panel').style.display = 'none';
            }
        });

        // Redraw charts on resize
        window.addEventListener('resize', debounce(() => {
            if (state.currentView === 'overview') loadDashboardData();
            if (state.currentView === 'analytics') loadAnalytics();
        }, 300));
    }

    function debounce(fn, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

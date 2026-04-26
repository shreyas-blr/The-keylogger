# SentinelKeys: Ethical Keylogger & Security Dashboard

This project is a comprehensive Ethical Keylogger application featuring both a lightweight local GUI and a sophisticated web-based security dashboard for monitoring, analyzing, and securely storing keystroke data. This project was developed as part of a Cyber Security internship task.

## 🚀 Features

### 1. Web-based Security Dashboard (SentinelKeys)
This modern web application provides deep analytics and real-time monitoring of keystroke sessions.
* **Real-time Analytics**: Live statistics showing keys per minute, top keys used, and hourly distributions.
* **Session Management**: Start and stop logging sessions, and review past active sessions.
* **Suspicious Activity Detection**: Automatically flags anomalous patterns such as:
  * Rapid typing (15+ keys per second)
  * Repeated keys (same key 20+ times)
  * Special key spamming
* **Alerts & Notifications**: Automatic real-time alerts when suspicious activity is detected.
* **Secure Database**: Stores keystrokes, sessions, and alerts in an SQLite database using WAL mode for high concurrency.
* **Export & Encryption**: Export logged records as a cleartext CSV or downlaod an encrypted payload (using Fernet encryption).

### 2. Local Python GUI (`source_code.py`)
A standalone Python desktop application built with Tkinter.
* Easy-to-use "Start" and "Stop" toggles.
* Live stats of the most frequently typed keys.
* Built-in file encryption and decryption for the log files directly through the interface using the `cryptography` library.
* Export tracking data to CSV.

## 🛠️ Technology Stack
* **Backend Framework:** Python Flask
* **Database:** SQLite
* **Frontend:** HTML5, Vanilla CSS, JavaScript
* **Security & Encryption:** `cryptography` (Fernet)
* **Desktop GUI:** Tkinter

## 📋 Installation & Usage

### Prerequisites
Make sure you have Python 3.7+ installed.
1. Clone the repository:
   ```bash
   git clone https://github.com/shreyas-blr/The-keylogger.git
   cd The-keylogger
   ```
2. Install the required Python dependencies:
   ```bash
   pip install flask cryptography
   ```

### Running the Web Dashboard (SentinelKeys)
To start the Flask backend and the web app:
```bash
python app.py
```
Open a browser and navigate to `http://localhost:5050/`.
> **Default Login**: \`admin\` / \`admin123\`

### Running the Local Tkinter App
If you prefer to use the standalone desktop GUI:
```bash
python source_code.py
```

## 🔐 Security Considerations
This software is intended **strictly for educational and ethical auditing purposes only**. Any execution or deployment of this tool should only be done on systems or networks where you have explicit and documented authorization.

* **Excluded from Version Control**: Secret keys (`encryption.key`), local logs (`keylog.csv`, `keylog.txt`), and SQLite databases (`sentinel_keys.db`, etc.) are `.gitignore`d to prevent accidental exposure of sensitive information.

## 📄 License
This project is for educational use.

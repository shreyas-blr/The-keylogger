import tkinter as tk
from datetime import datetime
import csv
from collections import Counter
from cryptography.fernet import Fernet

# ========== CONFIG ==========
LOG_FILE = "keylog.txt"
ENCRYPTED_FILE = "keylog.enc"

# Generate key once (save this if needed)
key = Fernet.generate_key()
cipher = Fernet(key)

logging_active = False
key_counts = Counter()

# ========== FUNCTIONS ==========

def log_key(event):
    global key_counts
    
    if not logging_active:
        return

    key = event.char if event.char else f"[{event.keysym}]"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    key_counts[key] += 1

    with open(LOG_FILE, "a") as f:
        f.write(f"{timestamp} : {key}\n")

    update_stats()


def start_logging():
    global logging_active
    logging_active = True
    root.bind("<Key>", log_key)
    status_label.config(text="Status: Logging Started", fg="green")


def stop_logging():
    global logging_active
    logging_active = False
    root.unbind("<Key>")
    status_label.config(text="Status: Logging Stopped", fg="red")


def clear_log():
    global key_counts
    open(LOG_FILE, "w").close()
    key_counts.clear()
    update_stats()
    status_label.config(text="Log Cleared", fg="blue")


def update_stats():
    total_keys = sum(key_counts.values())
    stats_text = f"Total Keys: {total_keys}\n"

    for key, count in key_counts.most_common(5):
        stats_text += f"{key}: {count}\n"

    stats_label.config(text=stats_text)


def export_csv():
    with open("keylog.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Key", "Count"])

        for key, count in key_counts.items():
            writer.writerow([key, count])

    status_label.config(text="Exported to CSV", fg="purple")


def encrypt_logs():
    try:
        with open(LOG_FILE, "rb") as f:
            data = f.read()

        encrypted = cipher.encrypt(data)

        with open(ENCRYPTED_FILE, "wb") as f:
            f.write(encrypted)

        status_label.config(text="Logs Encrypted", fg="orange")
    except:
        status_label.config(text="Encryption Failed", fg="red")


def decrypt_logs():
    try:
        with open(ENCRYPTED_FILE, "rb") as f:
            data = f.read()

        decrypted = cipher.decrypt(data)

        with open("decrypted_log.txt", "wb") as f:
            f.write(decrypted)

        status_label.config(text="Logs Decrypted", fg="green")
    except:
        status_label.config(text="Decryption Failed", fg="red")


# ========== GUI ==========

root = tk.Tk()
root.title("Ethical Keylogger Dashboard")
root.geometry("500x500")
root.configure(bg="#1e1e2f")

title = tk.Label(root, text="Ethical Keylogger", font=("Arial", 18, "bold"), bg="#1e1e2f", fg="white")
title.pack(pady=10)

text_area = tk.Text(root, height=8, width=50)
text_area.pack(pady=10)

# Buttons
btn_frame = tk.Frame(root, bg="#1e1e2f")
btn_frame.pack(pady=10)

tk.Button(btn_frame, text="Start", width=12, command=start_logging, bg="green", fg="white").grid(row=0, column=0, padx=5)
tk.Button(btn_frame, text="Stop", width=12, command=stop_logging, bg="red", fg="white").grid(row=0, column=1, padx=5)

tk.Button(btn_frame, text="Clear Log", width=12, command=clear_log).grid(row=1, column=0, pady=5)
tk.Button(btn_frame, text="Export CSV", width=12, command=export_csv).grid(row=1, column=1, pady=5)

tk.Button(btn_frame, text="Encrypt Logs", width=12, command=encrypt_logs).grid(row=2, column=0, pady=5)
tk.Button(btn_frame, text="Decrypt Logs", width=12, command=decrypt_logs).grid(row=2, column=1, pady=5)

# Status
status_label = tk.Label(root, text="Status: Idle", bg="#1e1e2f", fg="white")
status_label.pack(pady=10)

# Stats
stats_label = tk.Label(root, text="No Data Yet", bg="#1e1e2f", fg="white", justify="left")
stats_label.pack(pady=10)

root.mainloop()
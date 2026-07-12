from PyQt6.QtWidgets import QApplication, QMainWindow, QTextBrowser, QLineEdit, QVBoxLayout, QWidget, QPushButton, QLabel, QHBoxLayout
from PyQt6.QtCore import Qt, pyqtSignal, QThread, QTimer
import paramiko
import time
import threading
import os
from queue import Queue, Empty
from flask import Flask, request, jsonify
from datetime import datetime

# Resolve std/ directory (next to main.py)
STD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'std')
os.makedirs(STD_DIR, exist_ok=True)

# --- Buffer limits (adjust these to tune performance / memory) ---
# GUI terminal display: 2000 lines (matches tmux / most terminal defaults)
MAX_DISPLAY_LINES = 2000
# std/out.txt file: kept to this many lines
MAX_OUT_FILE_LINES = 5000
# In-memory API buffer: ~MAX_DISPLAY_LINES * 120 chars = ~240 KB
MAX_BUFFER_BYTES = MAX_DISPLAY_LINES * 120

# ---------------------------------------------------------------------------
# Strip ANSI / OSC escape sequences → plain text for the API response
# ---------------------------------------------------------------------------
def strip_ansi(text):
    """Remove all ANSI escape and OSC sequences, return plain text."""
    import re
    # OSC: ESC ] ... ST (ST = ESC \ or BEL 0x07)
    text = re.sub(r'\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)', '', text)
    # CSI: ESC [ ... final_letter
    text = re.sub(r'\x1b\[[0-9;?]*[A-Za-z]', '', text)
    # Remaining ESC sequences
    text = re.sub(r'\x1b[()][A-Za-z0-9]', '', text)
    return text


# ---------------------------------------------------------------------------
# SSH Client — runs all blocking I/O in a QThread
# ---------------------------------------------------------------------------
class SSHClient(QThread):
    output_signal = pyqtSignal(str)
    connected_signal = pyqtSignal(bool)

    def __init__(self):
        super().__init__()
        self.client = None
        self.channel = None
        self.is_connected = False
        self._should_stop = False
        self._pending_connect = Queue()   # (host, username, password, port)
        self._pending_ui_commands = Queue()  # from the GUI input line
        self._pending_api_commands = Queue() # from the Flask API

        # Plain-text output buffer (ANSI stripped) — shared with the API
        self._text_buffer = ""
        self._buf_lock = threading.Lock()

    # ---- Thread lifecycle ----

    # ---- File IPC helpers ----

    def _file_log_in(self, cmd, source="api"):
        """Append command to std/in.txt"""
        try:
            with open(os.path.join(STD_DIR, 'in.txt'), 'a', encoding='utf-8') as f:
                f.write(f"[{datetime.now().isoformat()}] ({source}) {cmd}\n")
        except Exception:
            pass

    def _file_log_out(self, text):
        """Append terminal output to std/out.txt, capped at MAX_OUT_FILE_LINES."""
        path = os.path.join(STD_DIR, 'out.txt')
        try:
            with open(path, 'a', encoding='utf-8') as f:
                f.write(text)
            # Truncate if over line limit
            with open(path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            if len(lines) > MAX_OUT_FILE_LINES:
                with open(path, 'w', encoding='utf-8') as f:
                    f.writelines(lines[-MAX_OUT_FILE_LINES:])
        except Exception:
            pass

    # ---- Thread lifecycle ----

    def run(self):
        while not self._should_stop:
            try:
                connect_params = self._pending_connect.get(timeout=0.1)
            except Empty:
                continue

            host, username, password, port = connect_params
            try:
                self.output_signal.emit(
                    f"\n\x1b[90mConnecting to: {host}:{port} using password {'*' * len(password)}\x1b[0m\n"
                )

                self.client = paramiko.SSHClient()
                self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                self.client.connect(
                    hostname=host, port=port, username=username,
                    password=password, timeout=10, look_for_keys=False, allow_agent=False,
                )

                self.is_connected = True
                self.output_signal.emit("\x1b[32mConnected!\x1b[0m\n")
                self.connected_signal.emit(True)

                self.channel = self.client.invoke_shell(
                    term='xterm-256color', width=120, height=40
                )
                self.channel.setblocking(0)
                self._read_loop()

            except Exception as e:
                self.is_connected = False
                self.connected_signal.emit(False)
                self.output_signal.emit(f"\n\x1b[31mConnection failed: {e}\x1b[0m\n")
            finally:
                self._cleanup()

    def _read_loop(self):
        while self.is_connected and self.channel and not self._should_stop:
            # Drain UI commands
            try:
                while True:
                    cmd = self._pending_ui_commands.get_nowait()
                    self.channel.send(cmd + '\n')
                    self._file_log_in(cmd, source="ui")
            except Empty:
                pass

            # Drain API commands
            try:
                while True:
                    cmd = self._pending_api_commands.get_nowait()
                    self.channel.send(cmd + '\n')
                    self._file_log_in(cmd, source="api")
            except Empty:
                pass

            # Read output
            try:
                if self.channel.recv_ready():
                    raw = self.channel.recv(4096).decode('utf-8', errors='ignore')
                    if raw:
                        # Forward raw ANSI to GUI for rendering
                        self.output_signal.emit(raw)
                        # Strip ANSI and append to buffer + file
                        plain = strip_ansi(raw)
                        with self._buf_lock:
                            self._text_buffer += plain
                            if len(self._text_buffer) > MAX_BUFFER_BYTES:
                                self._text_buffer = self._text_buffer[-MAX_BUFFER_BYTES:]
                        self._file_log_out(plain)

                if self.channel.closed or self.channel.eof_received:
                    self.is_connected = False
                    # Connection dropped on its own — notify the GUI so the
                    # connect button is re-enabled and status updates.
                    self.connected_signal.emit(False)
                    self.output_signal.emit("\n\x1b[90mConnection closed by remote\x1b[0m\n")
                    break

                time.sleep(0.05)
            except Exception as e:
                if self.is_connected:
                    self.output_signal.emit(f"\n\x1b[31mRead error: {e}\x1b[0m\n")
                self.is_connected = False
                # Read error — notify the GUI so the connect button is re-enabled.
                self.connected_signal.emit(False)
                break

    def _cleanup(self):
        if self.channel:
            try: self.channel.close()
            except: pass
            self.channel = None
        if self.client:
            try: self.client.close()
            except: pass
            self.client = None
        self.is_connected = False

    # ---- Public API (called from other threads) ----

    def request_connect(self, host, username, password, port=22):
        # Clear std files on new connection for fresh session
        try:
            marker = f"--- Session started {datetime.now().isoformat()} → {host}:{port} ---\n"
            for fname in ('in.txt', 'out.txt', 'err.txt'):
                fpath = os.path.join(STD_DIR, fname)
                with open(fpath, 'w', encoding='utf-8') as f:
                    f.write(marker)
        except Exception:
            pass

        if ':' in host and '@' in host:
            parts = host.split('@')
            if len(parts) == 2 and ':' in parts[1]:
                username = parts[0]
                host_port = parts[1].split(':')
                host = host_port[0]
                port = int(host_port[1])
        elif ':' in host:
            host_parts = host.split(':')
            host = host_parts[0]
            port = int(host_parts[1])
        self._pending_connect.put((host, username, password, port))

    def send_ui_command(self, cmd):
        """From the GUI input line."""
        if self.is_connected:
            self._pending_ui_commands.put(cmd)

    def send_interrupt(self, count=5):
        """Send Ctrl+C then Ctrl+D raw bytes — breaks runaway commands."""
        if not self.channel or not self.is_connected:
            return
        try:
            for _ in range(count):
                self.channel.send('\x03')  # Ctrl+C
                time.sleep(0.05)
            for _ in range(count):
                self.channel.send('\x04')  # Ctrl+D
                time.sleep(0.05)
        except Exception:
            pass

    def send_raw(self, data):
        """Send raw bytes to the SSH channel WITHOUT appending a newline.

        Used by the PythonGuiCarrier to drive interactive TUIs (nano/vim/htop)
        and bracketed paste — sends the exact bytes the caller encoded
        (KeyEncoder sequences), so control codes survive intact.
        Returns True if sent, False if not connected.
        """
        if not self.channel or not self.is_connected:
            return False
        try:
            self.channel.send(data)
            self._file_log_in(repr(data), source="raw")
            return True
        except Exception:
            return False

    def upload_file(self, local_path, remote_path):
        """Upload a local file to the remote host via SFTP (paramiko)."""
        if not self.client or not self.is_connected:
            return False, "not connected"
        sftp = None
        try:
            sftp = self.client.open_sftp()
            sftp.put(local_path, remote_path)
            return True, None
        except Exception as e:
            return False, str(e)
        finally:
            if sftp:
                try:
                    sftp.close()
                except Exception:
                    pass

    def download_file(self, remote_path, local_path):
        """Download a remote file to a local path via SFTP (paramiko)."""
        if not self.client or not self.is_connected:
            return False, "not connected"
        sftp = None
        try:
            sftp = self.client.open_sftp()
            sftp.get(remote_path, local_path)
            return True, None
        except Exception as e:
            return False, str(e)
        finally:
            if sftp:
                try:
                    sftp.close()
                except Exception:
                    pass

    def send_api_command(self, cmd):
        """From the Flask API — queues into the SSH session."""
        if self.is_connected:
            # Clear buffer so API can capture fresh output
            with self._buf_lock:
                self._text_buffer = ""
            self._pending_api_commands.put(cmd)

    def get_buffer(self):
        """Return current plain-text output buffer."""
        with self._buf_lock:
            return self._text_buffer

    def disconnect(self):
        self.is_connected = False
        self.connected_signal.emit(False)
        self.output_signal.emit("\n\x1b[90mDisconnected\x1b[0m\n")

    def stop(self):
        self._should_stop = True
        self.is_connected = False


# ---------------------------------------------------------------------------
# Flask API server — runs in a daemon thread
# ---------------------------------------------------------------------------
class ApiServer(threading.Thread):
    """Flask API on 127.0.0.85:8564 to let the pi AI send SSH commands."""

    def __init__(self, ssh_client: SSHClient):
        super().__init__(daemon=True)
        self.ssh = ssh_client
        self.app = Flask("aftc-ssh")
        self._register_routes()

    def _register_routes(self):
        @self.app.route('/api/v1/status', methods=['GET'])
        def status():
            return jsonify({
                'connected': self.ssh.is_connected,
            })

        @self.app.route('/api/v1/connect', methods=['POST'])
        def connect():
            """Programmatically connect to an SSH server."""
            data = request.get_json(force=True)
            host = data.get('host', '').strip()
            username = data.get('username', 'root').strip()
            password = data.get('password', '')
            port = data.get('port', 22)
            if not host:
                return jsonify({'error': 'host is required'}), 400
            if not password:
                return jsonify({'error': 'password is required'}), 400
            if self.ssh.is_connected:
                return jsonify({'error': 'already connected'}), 409
            self.ssh.request_connect(host, username, password, int(port))
            return jsonify({'ok': True, 'host': host, 'username': username, 'port': port})

        @self.app.route('/api/v1/output', methods=['GET'])
        def output():
            """Peek at recent terminal output (plain text, ANSI-stripped)."""
            buf = self.ssh.get_buffer()
            lines = buf.splitlines()
            tail = int(request.args.get('lines', 50))
            return jsonify({
                'output': '\n'.join(lines[-tail:]),
                'connected': self.ssh.is_connected,
            })

        @self.app.route('/api/v1/send', methods=['POST'])
        def send():
            """Send a command, wait for output, return it."""
            data = request.get_json(force=True)
            cmd = data.get('command', '').strip()
            if not cmd:
                return jsonify({'error': 'No command provided'}), 400
            if not self.ssh.is_connected:
                return jsonify({'error': 'Not connected'}), 503

            timeout = data.get('timeout', 15)
            # Clear the buffer, send command, then poll for output
            self.ssh.send_api_command(cmd)

            deadline = time.time() + timeout
            # Wait a moment for the initial prompt / echo
            time.sleep(0.3)

            # Poll until output settles (no new data for 2s) or timeout
            last_len = 0
            stable_count = 0
            while time.time() < deadline:
                buf = self.ssh.get_buffer()
                current_len = len(buf)
                if current_len > last_len:
                    stable_count = 0
                    last_len = current_len
                else:
                    stable_count += 1
                if stable_count >= 10:  # 10 * 0.2s = 2s of silence
                    break
                time.sleep(0.2)

            buf = self.ssh.get_buffer().strip()
            return jsonify({
                'output': buf,
                'connected': self.ssh.is_connected,
            })

        @self.app.route('/api/v1/interrupt', methods=['POST'])
        def interrupt():
            """Send Ctrl+C x5 then Ctrl+D x5 to break runaway commands."""
            if not self.ssh.is_connected:
                return jsonify({'error': 'Not connected'}), 503
            data = request.get_json(silent=True) or {}
            count = data.get('count', 5)
            self.ssh.send_interrupt(count)
            return jsonify({'ok': True, 'sent_ctrl_c': count, 'sent_ctrl_d': count})

        @self.app.route('/api/v1/disconnect', methods=['POST'])
        def disconnect():
            """Programmatically disconnect the SSH session."""
            if not self.ssh.is_connected:
                return jsonify({'error': 'Not connected'}), 409
            self.ssh.disconnect()
            return jsonify({'ok': True})

        @self.app.route('/api/v1/send_raw', methods=['POST'])
        def send_raw():
            """Send raw bytes (base64-encoded UTF-8) directly to the SSH
            channel WITHOUT a trailing newline.

            Used by the PythonGuiCarrier for interactive TUI driving
            (nano/vim/htop via KeyEncoder sequences) and bracketed paste,
            which need exact control codes that /api/v1/send would corrupt
            by appending a newline.
            """
            if not self.ssh.is_connected:
                return jsonify({'error': 'Not connected'}), 503
            data = request.get_json(force=True)
            b64 = data.get('data', '')
            if not b64:
                return jsonify({'error': 'No data provided'}), 400
            import base64 as _b64
            try:
                raw = _b64.b64decode(b64).decode('utf-8', errors='surrogateescape')
            except Exception as e:
                return jsonify({'error': f'Invalid base64: {e}'}), 400
            ok = self.ssh.send_raw(raw)
            return jsonify({'ok': ok, 'connected': self.ssh.is_connected})

        @self.app.route('/api/v1/upload', methods=['POST'])
        def upload():
            """Upload a local file to the remote host via SFTP (paramiko).

            Body: {"local_path": "...", "remote_path": "..."}
            """
            if not self.ssh.is_connected:
                return jsonify({'error': 'Not connected'}), 503
            data = request.get_json(force=True)
            local_path = data.get('local_path', '').strip()
            remote_path = data.get('remote_path', '').strip()
            if not local_path or not remote_path:
                return jsonify({'error': 'local_path and remote_path required'}), 400
            ok, err = self.ssh.upload_file(local_path, remote_path)
            if not ok:
                return jsonify({'error': err or 'upload failed'}), 500
            return jsonify({'ok': True})

        @self.app.route('/api/v1/download', methods=['POST'])
        def download():
            """Download a remote file to a local path via SFTP (paramiko).

            Body: {"remote_path": "...", "local_path": "..."}
            """
            if not self.ssh.is_connected:
                return jsonify({'error': 'Not connected'}), 503
            data = request.get_json(force=True)
            remote_path = data.get('remote_path', '').strip()
            local_path = data.get('local_path', '').strip()
            if not remote_path or not local_path:
                return jsonify({'error': 'remote_path and local_path required'}), 400
            ok, err = self.ssh.download_file(remote_path, local_path)
            if not ok:
                return jsonify({'error': err or 'download failed'}), 500
            return jsonify({'ok': True})

    def run(self):
        # Quiet Flask — no startup banner
        import logging
        log = logging.getLogger('werkzeug')
        log.setLevel(logging.ERROR)
        self.app.run(host='127.0.0.85', port=8564, debug=False, use_reloader=False)


# ---------------------------------------------------------------------------
# ANSI → HTML converter (for QTextBrowser rendering)
# ---------------------------------------------------------------------------
def ansi_to_html(text):
    """Convert ANSI escape sequences to HTML for QTextBrowser."""
    FG_COLORS = {
        30: '#000000', 31: '#FF4444', 32: '#44FF44', 33: '#FFFF44',
        34: '#4444FF', 35: '#FF44FF', 36: '#44FFFF', 37: '#FFFFFF',
        90: '#808080', 91: '#FF6B6B', 92: '#6BFF6B', 93: '#FFFF6B',
        94: '#6B6BFF', 95: '#FF6BFF', 96: '#6BFFFF', 97: '#FFFFFF',
    }
    BG_COLORS = {v + 10: c for v, c in FG_COLORS.items()}

    result = ""
    i = 0
    n = len(text)
    active_styles = []

    def current_fg():
        for s in reversed(active_styles):
            if 'color' in s: return s['color']
        return None

    def current_bg():
        for s in reversed(active_styles):
            if 'bg' in s: return s['bg']
        return None

    def open_tag():
        parts = []
        fg = current_fg()
        bg = current_bg()
        if fg: parts.append(f"color:{fg}")
        if bg: parts.append(f"background:{bg}")
        return f'<span style="{";".join(parts)}">' if parts else ''

    while i < n:
        c = text[i]
        if c == '\x1b' and i + 1 < n:
            nc = text[i + 1]
            # OSC sequence
            if nc == ']':
                i += 2
                while i < n:
                    if text[i] == '\x07': i += 1; break
                    if text[i] == '\x1b' and i + 1 < n and text[i + 1] == '\\': i += 2; break
                    i += 1
                continue
            # CSI sequence
            if nc == '[':
                i += 2
                params = ""
                while i < n and not (0x40 <= ord(text[i]) <= 0x7E):
                    params += text[i]; i += 1
                final = text[i] if i < n else ''
                i += 1
                if final == 'm':
                    codes = [int(p) if p else 0 for p in params.split(';')]
                    if not codes: codes = [0]
                    if 0 in codes:
                        while active_styles: result += '</span>'; active_styles.pop()
                        codes = [c for c in codes if c != 0]
                    for code in codes:
                        if code == 1:
                            result += '<b>'; active_styles.append({'bold': True})
                        elif code == 4:
                            result += '<u>'; active_styles.append({'underline': True})
                        elif code in FG_COLORS:
                            if active_styles: result += '</span>'
                            style = {'color': FG_COLORS[code]}
                            bg = current_bg()
                            if bg: style['bg'] = bg
                            active_styles.append(style)
                            result += open_tag()
                        elif code in BG_COLORS:
                            if active_styles: result += '</span>'
                            style = {'bg': BG_COLORS[code]}
                            fg = current_fg()
                            if fg: style['color'] = fg
                            active_styles.append(style)
                            result += open_tag()
                        elif code == 39:
                            active_styles = [s for s in active_styles if 'color' not in s]
                            if active_styles: result += '</span>'; result += open_tag()
                        elif code == 49:
                            active_styles = [s for s in active_styles if 'bg' not in s]
                            if active_styles: result += '</span>'; result += open_tag()
                continue
            i += 1
            continue
        # Printable
        if c == '\n':
            result += '<br/>'
        elif c == '\r':
            pass
        elif c == ' ':
            result += '&nbsp;'
        elif c == '&':
            result += '&amp;'
        elif c == '<':
            result += '&lt;'
        elif c == '>':
            result += '&gt;'
        else:
            result += c
        i += 1

    while active_styles:
        result += '</span>'
        active_styles.pop()
    return result


# ---------------------------------------------------------------------------
# PyQt6 GUI
# ---------------------------------------------------------------------------
class SSHApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("AFTC PI SSH Tool v1.0.0")
        self.resize(1200, 800)

        self.ssh_client = SSHClient()
        self.ssh_client.output_signal.connect(self.append_output)
        self.ssh_client.connected_signal.connect(self.on_connection_changed)
        self.ssh_client.start()

        # Start Flask API server
        self.api_server = ApiServer(self.ssh_client)
        self.api_server.start()

        self.output_text = None
        self.command_input = None
        self.host_input = None
        self.password_input = None
        self.connect_btn = None
        self.disconnect_btn = None
        self.init_ui()

    def init_ui(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)
        main_layout.setContentsMargins(20, 20, 20, 20)
        main_layout.setSpacing(0)

        # Terminal output
        self.output_text = QTextBrowser()
        self.output_text.setReadOnly(True)
        self.output_text.setStyleSheet("""
            QTextBrowser {
                background-color: #151515;
                color: #CCCCCC;
                font-family: 'Courier New', monospace;
                font-size: 10pt;
                border: 1px solid #666666;
                border-bottom: none;
            }
        """)
        main_layout.addWidget(self.output_text, stretch=1)

        # Command input
        input_container = QWidget()
        input_container.setStyleSheet("""
            QWidget {
                background-color: #111122;
                border-left: 1px solid #666666;
                border-right: 1px solid #666666;
            }
        """)
        input_layout = QHBoxLayout(input_container)
        input_layout.setContentsMargins(10, 5, 10, 5)
        input_layout.setSpacing(5)

        prompt_label = QLabel(">")
        prompt_label.setStyleSheet("color: #CCCCCC; font-weight: bold; border: none;")
        prompt_label.setFixedWidth(20)
        input_layout.addWidget(prompt_label)

        self.command_input = QLineEdit()
        self.command_input.setStyleSheet("""
            QLineEdit {
                background-color: transparent;
                color: #CCCCCC;
                font-family: 'Courier New', monospace;
                font-size: 10pt;
                border: none;
            }
        """)
        self.command_input.returnPressed.connect(self.on_command_entered)
        input_layout.addWidget(self.command_input)
        main_layout.addWidget(input_container)

        # Connection bar
        conn_container = QWidget()
        conn_container.setStyleSheet("""
            QWidget {
                background-color: #242424;
                border: 1px solid #666666;
                border-top: none;
            }
        """)
        conn_layout = QHBoxLayout(conn_container)
        conn_layout.setContentsMargins(10, 10, 10, 10)
        conn_layout.setSpacing(10)

        host_label = QLabel("Connect to:")
        host_label.setStyleSheet("color: #CCCCCC; border: none;")
        conn_layout.addWidget(host_label)

        self.host_input = QLineEdit()
        self.host_input.setPlaceholderText("root@127.0.0.1:22")
        self.host_input.setStyleSheet("""
            QLineEdit {
                background-color: #FFFFFF;
                color: #000000;
                padding: 5px;
                min-width: 250px;
            }
        """)
        conn_layout.addWidget(self.host_input)

        password_label = QLabel("Password:")
        password_label.setStyleSheet("color: #CCCCCC; border: none;")
        conn_layout.addWidget(password_label)

        self.password_input = QLineEdit()
        self.password_input.setPlaceholderText("Enter password")
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_input.setStyleSheet("""
            QLineEdit {
                background-color: #FFFFFF;
                color: #000000;
                padding: 5px;
                min-width: 200px;
            }
        """)
        conn_layout.addWidget(self.password_input)

        self.connect_btn = QPushButton("CONNECT")
        self.connect_btn.setStyleSheet("""
            QPushButton {
                background-color: #4CAF50; color: white;
                font-weight: bold; padding: 8px 20px; border: none;
            }
            QPushButton:hover { background-color: #45a049; }
        """)
        self.connect_btn.clicked.connect(self.on_connect_clicked)
        conn_layout.addWidget(self.connect_btn)

        self.disconnect_btn = QPushButton("DISCONNECT")
        self.disconnect_btn.setStyleSheet("""
            QPushButton {
                background-color: #f44336; color: white;
                font-weight: bold; padding: 8px 20px; border: none;
            }
            QPushButton:hover { background-color: #da190b; }
        """)
        self.disconnect_btn.clicked.connect(self.on_disconnect_clicked)
        self.disconnect_btn.setEnabled(False)
        conn_layout.addWidget(self.disconnect_btn)

        conn_layout.addStretch()
        main_layout.addWidget(conn_container)

        # Status bar
        status_container = QWidget()
        status_container.setStyleSheet("""
            QWidget {
                background-color: #191919;
                border: 1px solid #666666;
                border-top: none;
            }
        """)
        status_layout = QHBoxLayout(status_container)
        status_layout.setContentsMargins(10, 5, 10, 5)

        self.status_label = QLabel("STATUS: <span style='color: #FF0000;'>DISCONNECTED</span>")
        self.status_label.setStyleSheet("color: #CCCCCC; border: none; margin: 0;")
        status_layout.addWidget(self.status_label)

        server_label = QLabel("Server running at: http://127.0.0.85:8564")
        server_label.setStyleSheet("color: #CCCCCC; border: none; margin: 0;")
        status_layout.addWidget(server_label)

        status_layout.addStretch()
        main_layout.addWidget(status_container)

        self.setStyleSheet("QMainWindow { background-color: #000000; }")

    # ---- Output ----

    def append_output(self, text):
        html = ansi_to_html(text)
        cursor = self.output_text.textCursor()
        cursor.movePosition(cursor.MoveOperation.End)
        cursor.insertHtml(html)
        self.output_text.setTextCursor(cursor)

        # Trim oldest blocks if we exceed MAX_DISPLAY_LINES
        doc = self.output_text.document()
        extra = doc.blockCount() - MAX_DISPLAY_LINES
        if extra > 0:
            cursor = self.output_text.textCursor()
            cursor.movePosition(cursor.MoveOperation.Start)
            for _ in range(extra):
                cursor.movePosition(cursor.MoveOperation.Down,
                                    cursor.MoveMode.KeepAnchor)
            cursor.removeSelectedText()

        scrollbar = self.output_text.verticalScrollBar()
        scrollbar.setValue(scrollbar.maximum())

    # ---- Event handlers ----

    def on_command_entered(self):
        cmd = self.command_input.text().strip()
        if not cmd:
            return
        self.command_input.clear()
        if not self.ssh_client.is_connected:
            self.append_output("\x1b[31mNot connected to any server\x1b[0m\n")
            return
        self.append_output(f"\x1b[36m> {cmd}\x1b[0m\n")
        self.ssh_client.send_ui_command(cmd)

    def on_connect_clicked(self):
        host = self.host_input.text().strip()
        password = self.password_input.text()
        if not host:
            self.append_output("\x1b[31mPlease enter a host\x1b[0m\n")
            return
        if not password:
            self.append_output("\x1b[31mPlease enter a password\x1b[0m\n")
            return
        username = "root"
        if '@' in host:
            parts = host.split('@')
            username = parts[0]
            host = parts[1]

        # Always allow re-connect: if currently connected, disconnect first
        # so the new credentials take effect. The user can switch servers
        # at any time without manually clicking DISCONNECT first.
        if self.ssh_client.is_connected:
            self.append_output(
                f"\x1b[90mSwitching connection: disconnecting current session to connect to {username}@{host}...\x1b[0m\n"
            )
            self.ssh_client.disconnect()
        else:
            self.append_output(f"\x1b[90mConnecting to {username}@{host}...\x1b[0m\n")

        # Debounce: briefly disable to absorb accidental double-clicks, then
        # re-enable so the button is always usable for the next reconnect.
        self.connect_btn.setEnabled(False)
        QTimer.singleShot(800, lambda: self.connect_btn.setEnabled(True))

        self.ssh_client.request_connect(host, username, password)

    def on_disconnect_clicked(self):
        self.ssh_client.disconnect()

    def on_connection_changed(self, connected):
        if connected:
            self.status_label.setText("STATUS: <span style='color: #00FF00;'>CONNECTED</span>")
            # Keep the connect button enabled so the user can reconnect to
            # another server at any time, even mid-session.
            self.connect_btn.setEnabled(True)
            self.disconnect_btn.setEnabled(True)
            self.command_input.setFocus()
        else:
            self.status_label.setText("STATUS: <span style='color: #FF0000;'>DISCONNECTED</span>")
            self.connect_btn.setEnabled(True)
            self.disconnect_btn.setEnabled(False)
            self.connect_btn.setFocus()

    def closeEvent(self, event):
        if self.ssh_client.is_connected:
            self.ssh_client.disconnect()
        self.ssh_client.stop()
        self.ssh_client.wait(3000)
        event.accept()


if __name__ == "__main__":
    import sys
    import argparse

    parser = argparse.ArgumentParser(description="AFTC PI SSH Tool")
    parser.add_argument("--host", default=None,
                        help="SSH destination: 'host', 'user@host', or 'user@host:port'. "
                             "When set, the GUI auto-connects on launch.")
    parser.add_argument("--username", default=None, help="SSH username (overrides user in --host).")
    parser.add_argument("--password", default=None, help="SSH password.")
    parser.add_argument("--port", type=int, default=None, help="SSH port (overrides port in --host).")
    args = parser.parse_args()

    app = QApplication(sys.argv)
    window = SSHApp()
    window.show()

    # Auto-connect when credentials were provided via CLI. Deferred briefly so
    # the PyQt event loop + Flask API are fully up before the connect fires.
    if args.host:
        host = args.host
        username = args.username
        port = args.port
        if '@' in host and not username:
            parts = host.split('@')
            username = parts[0]
            host = parts[1]
        if not username:
            username = "root"
        if not port and ':' in host:
            host_parts = host.split(':')
            host = host_parts[0]
            try:
                port = int(host_parts[1])
            except Exception:
                port = None
        if not port:
            port = 22
        password = args.password or ""

        def _auto_connect():
            display = f"{username}@{host}" if port == 22 else f"{username}@{host}:{port}"
            window.host_input.setText(display)
            window.password_input.setText(password)
            window.on_connect_clicked()

        QTimer.singleShot(1000, _auto_connect)

    sys.exit(app.exec())

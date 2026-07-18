"""Main daemon loop.

Reads JSON-RPC from stdin, dispatches to handlers, writes responses to stdout.
A background ConnectionMonitor watches for SSH connection loss and emits
a `session_lost` notification; it MUST NOT terminate the daemon (AFTC
contract; see README.md and the SSH specification).

Wire format:
- One JSON object per line.
- Stdin: requests (and notifications).
- Stdout: responses and our notifications (no id).
- Stderr: human-readable diagnostic logs (not part of the protocol).

On startup:
1. The daemon writes `{"ready": true, "version": ..., "pid": ..., "capabilities": [...]}`.
2. It then enters the read loop.

On shutdown:
- Via `shutdown` method (clean exit, code 0).
- Via SIGTERM/SIGINT (clean exit, code 0).
- Via stdin EOF (host pipe closed) - clean exit, code 0.

All stdout writes are protected by a lock to prevent interleaving from
worker threads.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
import threading
import traceback
from typing import Any

from . import __version__
from .errors import RpcError
from .monitor import ConnectionMonitor
from .rpc import dispatch


PROTOCOL_VERSION = 1

# Module-level lock for stdout writes.
_stdout_lock = threading.Lock()


def _write_stdout(obj: dict) -> None:
    """Write a JSON object to stdout as a single line, newline-terminated."""
    line = json.dumps(obj, separators=(",", ":")) + "\n"
    with _stdout_lock:
        sys.stdout.write(line)
        sys.stdout.flush()


def _write_log(level: str, message: str) -> None:
    """Write a diagnostic log to stderr (not part of JSON-RPC)."""
    sys.stderr.write(f"[aftc_ssh_carrier] {level}: {message}\n")
    sys.stderr.flush()


class Daemon:
    """The aftc_ssh_carrier daemon.

    Lifecycle:
    - `start()` blocks until shutdown.
    - Returns 0 on clean exit.
    - Keeps running when a single SSH connection is lost; only the dead
      session is closed. Other sessions continue to serve.
    """

    def __init__(self) -> None:
        self._stopped = threading.Event()
        self._shutdown_reason: str | None = None
        self._monitor: ConnectionMonitor | None = None

    def start(self) -> int:
        # Send ready signal.
        _write_stdout({
            "ready": True,
            "protocolVersion": PROTOCOL_VERSION,
            "version": __version__,
            "pid": os.getpid(),
            "capabilities": [
                "exec",     # run commands (no PTY, zero races)
                "sftp",     # upload/download + file ops
                "shell",    # interactive PTY for nano/vim/htop
                "forward",  # local/remote/dynamic port forwarding
                "env",      # per-session env vars
                "monitor",  # per-session loss detection (NOT self-terminating)
            ],
        })

        # Install signal handlers for clean shutdown.
        try:
            signal.signal(signal.SIGTERM, self._on_signal)
            signal.signal(signal.SIGINT, self._on_signal)
        except (ValueError, OSError):
            # Not in main thread, or platform doesn't support it.
            pass

        # Start the connection monitor. On any SSH connection loss the monitor
        # emits a session_lost notification and prunes that single session
        # without terminating the daemon (AFTC contract). Its idle watchdog is
        # the TS-independent backstop that exits a quiet, idle daemon so a
        # wedged host never leaves an orphan.
        self._monitor = ConnectionMonitor(
            on_connection_lost=self._on_connection_lost,
            on_idle=self._on_idle,
        )
        self._monitor.start()

        # Reader thread (reads JSON-RPC from stdin).
        reader = threading.Thread(
            target=self._reader_loop,
            name="rpc-reader",
            daemon=True,
        )
        reader.start()

        # Wait for shutdown.
        self._stopped.wait()

        # Tear down.
        _write_log("info", f"daemon shutting down (reason={self._shutdown_reason})")
        if self._monitor is not None:
            self._monitor.stop()
        return 0

    def _on_signal(self, signum: int, frame) -> None:
        """Handle SIGTERM/SIGINT - clean shutdown."""
        self._shutdown_reason = f"signal-{signum}"
        self._stopped.set()

    def _on_connection_lost(self, session_id: str) -> None:
        """Monitor detected connection loss for one session.

        AFTC ADAPTATION: emit a `session_lost` notification to the host and
        continue serving every other session. Do NOT terminate the daemon.
        """
        # Best-effort notification; the host's read loop may not be waiting,
        # so we just write the line and let the host pick it up.
        try:
            _write_stdout({
                "notify": "session_lost",
                "sessionId": session_id,
                "reason": "transport closed",
            })
        except Exception:
            pass

    def _on_idle(self) -> None:
        """Idle watchdog fired: stdin quiet past the timeout with no active work.

        Reuses the same teardown path as stdin EOF and signals.
        """
        self._shutdown_reason = "idle"
        self._stopped.set()

    def _reader_loop(self) -> None:
        """Read JSON-RPC from stdin and dispatch each request."""
        try:
            for line in sys.stdin:
                # Every line read proves the host pipe is open and resets the
                # idle watchdog window.
                if self._monitor is not None:
                    self._monitor.touch_stdin()
                line = line.strip()
                if not line:
                    continue
                try:
                    request = json.loads(line)
                except json.JSONDecodeError:
                    _write_stdout({
                        "id": None,
                        "error": {"code": -32700, "message": "Malformed carrier request."},
                    })
                    continue

                # Notifications (no id) - currently we don't define any from host,
                # but support them for forward-compat.
                if "id" not in request and "method" in request:
                    continue  # notifications are fire-and-forget

                # Dispatch each request in its own worker thread so the reader
                # can keep reading while long-running handlers (run, upload) work.
                threading.Thread(
                    target=self._handle_request,
                    args=(request,),
                    daemon=True,
                ).start()
        except (EOFError, KeyboardInterrupt):
            pass
        except Exception as e:
            _write_log("error", f"reader crashed: {e}\n{traceback.format_exc()}")
        finally:
            # stdin closed = host pipe broken. Treat as shutdown signal.
            if self._shutdown_reason is None:
                self._shutdown_reason = "stdin-closed"
            self._stopped.set()

    def _handle_request(self, request: dict) -> None:
        """Dispatch a single JSON-RPC request."""
        req_id = request.get("id")
        method = request.get("method")
        params = request.get("params", {}) or {}

        if not isinstance(method, str):
            _write_stdout({
                "id": req_id,
                "error": {"code": -32600, "message": "Invalid Request: missing method"},
            })
            return

        try:
            monitor = self._monitor
            result = dispatch(method, params, monitor)
            if req_id is not None:
                _write_stdout({"id": req_id, "result": result})
        except SystemExit:
            # Clean shutdown requested via 'shutdown' method.
            self._shutdown_reason = "shutdown-method"
            self._stopped.set()
        except RpcError as e:
            if req_id is not None:
                _write_stdout({
                    "id": req_id,
                    "error": {"code": e.code, "message": "SSH carrier request failed."},
                })
        except Exception:
            _write_stdout({
                "id": req_id,
                "error": {"code": -32603, "message": "SSH carrier request failed."},
            })


def main() -> int:
    """Console-script entry point."""
    daemon = Daemon()
    return daemon.start()
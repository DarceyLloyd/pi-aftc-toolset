"""Connection monitor.

Watches all active sessions in a background thread. When any session's
SSH transport dies (network error, server restart, etc.), the monitor
invokes the configured callback so the daemon can notify the host and
remove just that session - it MUST NOT self-terminate (AFTC contract;
the SSH specification).

Polls every `_POLL_INTERVAL_SEC` seconds. The transport.is_active() check
is cheap - no bytes are sent over the wire.
"""

from __future__ import annotations

import os
import threading
import time

from .session import all_sessions_snapshot


_POLL_INTERVAL_SEC = 5.0

# TS-independent idle backstop. When stdin has been quiet longer than this and
# there is no active work (no sessions, shells, forwards, or in-flight
# transfers), the daemon exits cleanly so a wedged or killed host never leaves
# an orphan the user must end-task. Tests override this with a short value via
# AFTC_SSH_IDLE_TIMEOUT_SEC; the production default stays 600 seconds.
_DEFAULT_IDLE_TIMEOUT_SEC = 600.0


def _read_idle_timeout() -> float | None:
    """Read the idle timeout from the environment. None disables it."""
    raw = os.environ.get("AFTC_SSH_IDLE_TIMEOUT_SEC")
    if raw is None or raw == "":
        return _DEFAULT_IDLE_TIMEOUT_SEC
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return _DEFAULT_IDLE_TIMEOUT_SEC
    return value if value > 0 else None


def _has_active_work() -> bool:
    """True when any session, shell, forward, or in-flight transfer is active.

    Shells and forwards are owned by sessions, so "no sessions" is the
    load-bearing clause; the transfer check is defensive.
    """
    if all_sessions_snapshot():
        return True
    try:
        from .sftp_ops import _active_transfers, _transfers_lock
        with _transfers_lock:
            return bool(_active_transfers)
    except Exception:
        return False


class ConnectionMonitor:
    """Background thread that watches SSH transports for connection loss.

    On any connection loss, calls `on_connection_lost(session_id)`.
    The default daemon uses this to emit a `session_lost` notification and
    remove the dead session while keeping the rest of the daemon alive.
    """

    def __init__(self, on_connection_lost=None, on_idle=None, idle_timeout=None) -> None:
        self._stopped = threading.Event()
        self._thread: threading.Thread | None = None
        self._on_connection_lost = on_connection_lost
        self._on_idle = on_idle
        self._idle_timeout = idle_timeout if idle_timeout is not None else _read_idle_timeout()
        self._last_stdin_activity = time.monotonic()
        self._idle_fired = False
        self._start_time = time.monotonic()

    @property
    def uptime_seconds(self) -> float:
        return time.monotonic() - self._start_time

    def touch_stdin(self) -> None:
        """Mark a stdin read so the idle watchdog restarts its window."""
        self._last_stdin_activity = time.monotonic()
        self._idle_fired = False

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._monitor_loop,
            name="connection-monitor",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stopped.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None

    def _monitor_loop(self) -> None:
        """Periodically check all sessions for liveness and idle state.

        AFTC ADAPTATION: when a single session dies we just remove it and
        notify the host. We never call SystemExit; other sessions keep
        serving requests. Separately, the idle watchdog exits the daemon when
        stdin has been quiet past the timeout and there is no active work.
        """
        while not self._stopped.wait(_POLL_INTERVAL_SEC):
            try:
                self._check_idle()
                sessions = all_sessions_snapshot()
                if not sessions:
                    # No active sessions - keep monitoring (host might add one).
                    continue
                for session in sessions:
                    if not session.is_alive():
                        # Connection lost for this single session. Close the
                        # session locally (idempotent) and notify the host.
                        # The daemon continues running.
                        try:
                            session.close()
                        except Exception:
                            pass
                        if self._on_connection_lost is not None:
                            try:
                                self._on_connection_lost(session.session_id)
                            except Exception:
                                pass
                        # Do NOT return - other sessions must continue to be
                        # monitored.
                # Best-effort: prune any sessions that have been locally
                # closed (e.g. via `disconnect`) so the snapshot stays
                # consistent with the registry.
                from .session import _sessions as _reg, _lock as _reg_lock
                with _reg_lock:
                    dead_ids = [sid for sid, s in _reg.items() if s._closed]
                    for sid in dead_ids:
                        _reg.pop(sid, None)
            except Exception:
                # Don't let monitor exceptions kill the thread.
                continue

    def _check_idle(self) -> None:
        """TS-independent idle backstop.

        Exit the daemon when stdin has been quiet past the configured timeout
        and there is no active work. It covers the wedged-host case the TS-side
        reaper cannot (the host process is hung or killed). Normal shutdown,
        stdin EOF, and signals keep working unchanged.
        """
        if self._idle_timeout is None or self._on_idle is None:
            return
        if self._idle_fired:
            return
        if time.monotonic() - self._last_stdin_activity < self._idle_timeout:
            return
        if _has_active_work():
            return
        self._idle_fired = True
        try:
            self._on_idle()
        except Exception:
            pass
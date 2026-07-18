"""Interactive shell mode for driving nano, vim, htop, tail -f, etc.

Uses paramiko's invoke_shell which opens an SSH channel with a remote PTY.
A background reader thread drains incoming bytes into a thread-safe buffer;
peek/expect operations use condition variables to wait for new data.

This is the only path that still has PTY-related race conditions (the remote
shell's readline redraws, wrap indicators, etc.). They are far less severe than
the node-pty local-PTY situation pyPtyCarrier replaced, but expect/send_keys
should be used carefully for interactive TUI driving.
"""

from __future__ import annotations

import re
import threading
import time
import uuid
from typing import Any

import paramiko

from .errors import RpcError, UNKNOWN_SHELL, CHANNEL_CLOSED
from .keys import encode_sequence
from .session import Session


MAX_BUFFER_BYTES = 256 * 1024

# ─── Interactive shell ──────────────────────────────────────────────────────

class InteractiveShell:
    """A single interactive shell channel with buffered I/O."""

    def __init__(
        self,
        session: Session,
        cols: int = 80,
        rows: int = 24,
        term: str = "xterm-256color",
    ) -> None:
        self.session = session
        self.cols = cols
        self.rows = rows
        self.term = term
        self._channel: paramiko.Channel | None = None
        self._buffer = bytearray()
        self._cond = threading.Condition()
        self._closed = False
        self._cursor = 0  # Monotonic byte counter returned to clients.
        self._buffer_start_cursor = 0
        self._reader_thread: threading.Thread | None = None
        self._open()

    def _open(self) -> None:
        client = self.session.client()
        transport = client.get_transport()
        if transport is None:
            raise RpcError(CHANNEL_CLOSED, "Session transport is not available")
        # invoke_shell: open a shell channel on the remote side with a PTY.
        # get_pty=True requests a pseudo-terminal on the remote.
        chan = transport.open_session(timeout=10.0)
        chan.get_pty(term=self.term, width=self.cols, height=self.rows)
        chan.invoke_shell()
        chan.settimeout(0.1)  # short timeout for recv loop responsiveness
        self._channel = chan
        # Background reader thread drains incoming bytes into the buffer.
        self._reader_thread = threading.Thread(
            target=self._reader_loop,
            name=f"shell-reader-{uuid.uuid4().hex[:6]}",
            daemon=True,
        )
        self._reader_thread.start()

    def _reader_loop(self) -> None:
        chan = self._channel
        if chan is None:
            return
        try:
            while not self._closed:
                try:
                    data = chan.recv(4096)
                except Exception:
                    # Timeout or socket error; check _closed and loop.
                    continue
                if not data:
                    # Channel closed by remote.
                    with self._cond:
                        self._closed = True
                        self._cond.notify_all()
                    return
                with self._cond:
                    self._buffer.extend(data)
                    self._cursor += len(data)
                    discarded = max(0, len(self._buffer) - MAX_BUFFER_BYTES)
                    if discarded:
                        del self._buffer[:discarded]
                        self._buffer_start_cursor += discarded
                    self._cond.notify_all()
        except Exception:
            with self._cond:
                self._closed = True
                self._cond.notify_all()

    # ─── public API ────────────────────────────────────────────────

    def send(self, keys: list, pace_ms: int | None = None) -> dict:
        """Send a key sequence.

        `pace_ms` (optional) sleeps that many milliseconds between
        adjacent keys so callers can drive editors that need paced typing
        (e.g. vim's `gg`, htop's selection).
        """
        chan = self._channel
        if chan is None or self._closed:
            raise RpcError(CHANNEL_CLOSED, "Shell channel is closed")
        try:
            payload = encode_sequence(keys)
            if pace_ms and pace_ms > 0:
                # Send each chunk individually with a short sleep so the
                # remote terminal's input parser can keep up.
                pieces: list[bytes] = []
                run = bytearray()
                for k in keys:
                    piece = encode_sequence([k])
                    if piece:
                        pieces.append(piece)
                offset = 0
                for piece in pieces:
                    chan.send(piece)
                    time.sleep(pace_ms / 1000.0)
                    offset += len(piece)
            else:
                chan.send(payload)
        except Exception as e:
            raise RpcError(CHANNEL_CLOSED, f"Send failed: {e}")
        self.session.touch()
        return {"bytesSent": len(payload)}

    def paste(self, text: str) -> dict:
        """Paste multi-line text using bracketed-paste framing."""
        chan = self._channel
        if chan is None or self._closed:
            raise RpcError(CHANNEL_CLOSED, "Shell channel is closed")
        # \e[200~ ... \e[201~
        payload = b"\x1b[200~" + text.encode("utf-8") + b"\x1b[201~"
        try:
            chan.send(payload)
        except Exception as e:
            raise RpcError(CHANNEL_CLOSED, f"Paste failed: {e}")
        self.session.touch()
        return {"bytesSent": len(payload)}

    def peek(self, max_bytes: int = 65_536, since: int | None = None) -> dict:
        """Return a snapshot of the buffer.

        - `since`: optional cursor offset; only return data received after it.
          Returns the new cursor.
        - `max_bytes`: cap on the returned text length (in bytes).
        """
        with self._cond:
            limit = max(1, min(max_bytes, MAX_BUFFER_BYTES))
            truncated = False
            if since is None or since < 0:
                local_from = max(0, len(self._buffer) - limit)
            elif since < self._buffer_start_cursor:
                # The requested cursor fell out of the retained circular buffer.
                local_from = 0
                truncated = True
            elif since >= self._cursor:
                local_from = len(self._buffer)
            else:
                local_from = since - self._buffer_start_cursor
            snap = bytes(self._buffer[local_from:local_from + limit])
            return {
                "text": snap.decode("utf-8", errors="replace"),
                "cursor": self._cursor,
                "bufferStartCursor": self._buffer_start_cursor,
                "truncated": truncated,
                "closed": self._closed,
            }

    def expect(self, pattern: str, timeout_ms: int = 5_000) -> dict:
        """Wait for `pattern` (regex string) to appear in the buffer.

        Returns {matched: bool, text: <buffer snapshot>, cursor: <int>}.
        """
        if not isinstance(pattern, str) or not pattern:
            from .errors import INVALID_PARAMS
            raise RpcError(INVALID_PARAMS, "pattern must be a non-empty string")
        try:
            regex = re.compile(pattern.encode("utf-8"), re.DOTALL)
        except re.error as e:
            from .errors import INVALID_PARAMS
            raise RpcError(INVALID_PARAMS, f"Invalid regex pattern: {e}")

        deadline = time.monotonic() + (timeout_ms / 1000.0)
        with self._cond:
            while True:
                buf = bytes(self._buffer)
                m = regex.search(buf)
                if m:
                    return {
                        "matched": True,
                        "match": {
                            "start": m.start(),
                            "end": m.end(),
                            "group": m.group(0).decode("utf-8", errors="replace"),
                        },
                        "text": buf.decode("utf-8", errors="replace"),
                        "cursor": self._cursor,
                    }
                if self._closed:
                    return {
                        "matched": False,
                        "text": buf.decode("utf-8", errors="replace"),
                        "cursor": self._cursor,
                    }
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return {
                        "matched": False,
                        "text": buf.decode("utf-8", errors="replace"),
                        "cursor": self._cursor,
                    }
                self._cond.wait(timeout=remaining)

    def resize(self, cols: int, rows: int) -> dict:
        """Resize the remote PTY."""
        chan = self._channel
        if chan is None or self._closed:
            raise RpcError(CHANNEL_CLOSED, "Shell channel is closed")
        try:
            chan.resize_pty(width=cols, height=rows)
        except Exception as e:
            raise RpcError(CHANNEL_CLOSED, f"Resize failed: {e}")
        self.cols = cols
        self.rows = rows
        self.session.touch()
        return {"cols": cols, "rows": rows}

    def interrupt(self, count: int = 5) -> dict:
        """Send Ctrl+C bursts followed by Ctrl+D bursts to break a runaway app."""
        chan = self._channel
        if chan is None or self._closed:
            raise RpcError(CHANNEL_CLOSED, "Shell channel is closed")
        # Ctrl+C (0x03) then Ctrl+D (0x04), count of each.
        payload = (b"\x03" * count) + (b"\x04" * count)
        try:
            chan.send(payload)
        except Exception as e:
            raise RpcError(CHANNEL_CLOSED, f"Interrupt failed: {e}")
        self.session.touch()
        return {"bytesSent": len(payload)}

    def close(self) -> None:
        """Close the shell channel. Idempotent."""
        with self._cond:
            if self._closed:
                return
            self._closed = True
            chan = self._channel
            self._channel = None
            self._cond.notify_all()
        if chan is not None:
            try:
                chan.close()
            except Exception:
                pass
        if self._reader_thread is not None:
            self._reader_thread.join(timeout=1.0)

    def is_closed(self) -> bool:
        with self._cond:
            return self._closed

    def summary(self) -> dict:
        with self._cond:
            return {
                "cols": self.cols,
                "rows": self.rows,
                "term": self.term,
                "closed": self._closed,
                "bufferBytes": len(self._buffer),
                "bufferStartCursor": self._buffer_start_cursor,
                "cursor": self._cursor,
            }


# ─── Module-level helpers ───────────────────────────────────────────────────

def open_shell(session: Session, cols: int = 80, rows: int = 24, term: str = "xterm-256color") -> str:
    """Open an interactive shell on `session` and register it. Returns shellId."""
    shell = InteractiveShell(session, cols=cols, rows=rows, term=term)
    return session.add_shell(shell)


def get_shell(session: Session, shell_id: str) -> InteractiveShell:
    s = session.get_shell(shell_id)
    if s is None:
        raise RpcError(UNKNOWN_SHELL, f"Unknown shell: {shell_id!r}")
    return s


def require_shell(session: Session, shell_id: str) -> InteractiveShell:
    """Alias for get_shell that never returns None (raises instead)."""
    return get_shell(session, shell_id)


def close_shell(session: Session, shell_id: str) -> None:
    s = session.get_shell(shell_id)
    if s is not None:
        s.close()
        session.remove_shell(shell_id)
"""Command execution via paramiko exec channel (no PTY).

This is the race-free path for the common case of running a one-shot command
and capturing stdout/stderr/exit-code. The exec channel is a clean SSH
protocol pipe - no kernel TTY layer, no bash readline, no marker matching.
"""

from __future__ import annotations

import shlex
import threading

import paramiko

from .errors import RpcError, COMMAND_TIMEOUT, CHANNEL_CLOSED
from .session import Session


MAX_STDIN_BYTES = 64 * 1024
MAX_OUTPUT_BYTES = 256 * 1024


def run(session: Session, command: str, timeout_ms: int = 30_000, stdin_text: str | None = None) -> dict:
    """Execute `command` on `session` and return {stdout, stderr, exitCode}.

    Uses paramiko's exec_command which opens a new SSH channel in exec mode
    (no PTY). Waits up to `timeout_ms` for the command to complete.

    Environment variables set via set_env() are injected as a prefix:
        export KEY1=val1; export KEY2=val2; <user command>
    This is done because exec_command runs in a non-interactive subshell that
    does not source the user's profile, so per-session env vars must be set
    inline. The export pattern is safe for arbitrary values (single-quoted
    shell-escaped via shlex.quote).

    Raises:
        RpcError COMMAND_TIMEOUT: if the command did not complete in time.
        RpcError CHANNEL_CLOSED:  if the channel closed before completion.
    """
    if not isinstance(command, str) or not command.strip():
        from .errors import INVALID_PARAMS
        raise RpcError(INVALID_PARAMS, "command must be a non-empty string")
    timeout_ms = max(1, int(timeout_ms))

    # Build the env-prefixed command. We use shlex.quote so values containing
    # spaces, quotes, $ etc. are safe.
    env = session.env_snapshot()
    if env:
        prefix_lines = [f"export {k}={shlex.quote(v)}" for k, v in env.items()]
        prefix = "; ".join(prefix_lines) + "; "
    else:
        prefix = ""

    full_command = prefix + command

    client = session.client()
    session.touch()

    # exec_command is synchronous; we run it in a worker thread to honor
    # the timeout without blocking the whole daemon.
    result: dict = {"stdout": "", "stderr": "", "exitCode": -1, "_error": None}
    done = threading.Event()

    def worker() -> None:
        try:
            stdin, stdout, stderr = client.exec_command(full_command, timeout=timeout_ms / 1000.0)
            if stdin_text is not None:
                stdin_bytes = stdin_text.encode("utf-8")
                if len(stdin_bytes) > MAX_STDIN_BYTES:
                    from .errors import INVALID_PARAMS
                    raise RpcError(INVALID_PARAMS, "stdinText exceeds the 64 KiB limit")
                stdin.write(stdin_text)
            stdin.close()
            # Read stdout/stderr fully (this blocks until the command finishes
            # or the channel closes).
            out_bytes = b""
            err_bytes = b""
            stdout.channel.settimeout(timeout_ms / 1000.0)
            try:
                out_bytes = stdout.read()
            except Exception:
                pass
            try:
                err_bytes = stderr.read()
            except Exception:
                pass
            try:
                exit_code = stdout.channel.recv_exit_status()
            except Exception:
                exit_code = -1
            result["stdout"] = out_bytes.decode("utf-8", errors="replace")
            result["stderr"] = err_bytes.decode("utf-8", errors="replace")
            result["exitCode"] = exit_code
        except Exception as e:
            result["_error"] = e
        finally:
            done.set()

    t = threading.Thread(target=worker, name=f"exec-{session.session_id}", daemon=True)
    t.start()

    if not done.wait(timeout=timeout_ms / 1000.0 + 1.0):
        # Timed out. The worker thread is daemon so it'll be cleaned up at
        # process exit; we can't reliably kill the remote exec because
        # paramiko doesn't expose channel.cancel() for exec channels.
        raise RpcError(COMMAND_TIMEOUT, f"Command timed out after {timeout_ms}ms")

    if result["_error"] is not None:
        err = result["_error"]
        if isinstance(err, (OSError, paramiko.SSHException)):
            raise RpcError(CHANNEL_CLOSED, f"Channel closed: {err}")
        raise RpcError(CHANNEL_CLOSED, f"Exec error: {err}")

    session.touch()
    stdout = result["stdout"]
    stderr = result["stderr"]
    truncated = len(stdout.encode("utf-8")) > MAX_OUTPUT_BYTES or len(stderr.encode("utf-8")) > MAX_OUTPUT_BYTES
    if len(stdout.encode("utf-8")) > MAX_OUTPUT_BYTES:
        stdout = stdout.encode("utf-8")[:MAX_OUTPUT_BYTES].decode("utf-8", errors="replace")
    if len(stderr.encode("utf-8")) > MAX_OUTPUT_BYTES:
        stderr = stderr.encode("utf-8")[:MAX_OUTPUT_BYTES].decode("utf-8", errors="replace")
    return {
        "stdout": stdout,
        "stderr": stderr,
        "exitCode": result["exitCode"],
        "truncated": truncated,
    }

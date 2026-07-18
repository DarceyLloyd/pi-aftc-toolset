"""JSON-RPC method dispatch.

Maps method names to handler functions. Each handler receives (params, monitor)
and returns a dict (the response). Errors are raised as RpcError.

Public method surface (see README.md for full docs):
- initialize, ping, shutdown
- connect, disconnect, list_sessions, get_session
- run  (exec command)
- upload, download, read_file, write_file, list_dir, mkdir, remove, stat, chmod, chown
- open_shell, close_shell, send_keys, paste, peek, expect, resize_shell, interrupt_shell
- list_shells
- get_env, set_env
- forward_local, forward_remote, forward_dynamic, cancel_forward, list_forwards
"""

from __future__ import annotations

from typing import Any, Callable

from .errors import (
    RpcError,
    METHOD_NOT_FOUND,
    INVALID_PARAMS,
    UNKNOWN_SHELL,
    UNKNOWN_FORWARD,
)
from .exec_mode import run as exec_run
from .monitor import ConnectionMonitor
from .port_forward import (
    cancel_forward,
    forward_dynamic,
    forward_local,
    forward_remote,
)
from .session import (
    Session,
    create as session_create,
    get as session_get,
    list_all,
    remove as session_remove,
    require as session_require,
)
from .sftp_ops import (
    cancel_transfer,
    chmod,
    chown,
    download,
    list_dir,
    mkdir,
    read_file,
    rename as sftp_rename,
    remove as sftp_remove,
    stat as sftp_stat,
    upload,
    write_file,
)
from .shell_mode import (
    InteractiveShell,
    close_shell,
    get_shell,
    open_shell,
    require_shell,
)


# Method registry.
_METHODS: dict[str, Callable[[dict, ConnectionMonitor | None], dict]] = {}


def _register(name: str):
    def deco(fn):
        _METHODS[name] = fn
        return fn
    return deco


def _require_session_id(params: dict) -> str:
    sid = params.get("sessionId")
    if not isinstance(sid, str) or not sid:
        raise RpcError(INVALID_PARAMS, "params.sessionId is required")
    return sid


def _require_str(params: dict, key: str) -> str:
    v = params.get(key)
    if not isinstance(v, str) or not v:
        raise RpcError(INVALID_PARAMS, f"params.{key} must be a non-empty string")
    return v


def _require_int(params: dict, key: str, default: int | None = None) -> int:
    v = params.get(key, default)
    if v is None:
        raise RpcError(INVALID_PARAMS, f"params.{key} is required")
    try:
        return int(v)
    except (TypeError, ValueError):
        raise RpcError(INVALID_PARAMS, f"params.{key} must be an integer")


def _make_progress_emitter(session_id: str, transfer_id: str):
    """Build a progress callback that emits a transfer_progress notification."""
    def emit(sent: int, total: int) -> None:
        try:
            from .daemon import _write_stdout
            _write_stdout({
                "notify": "transfer_progress",
                "sessionId": session_id,
                "transferId": transfer_id,
                "bytes": sent,
                "total": total,
            })
        except Exception:
            pass
    return emit


# ─── lifecycle ──────────────────────────────────────────────────────────────

@_register("initialize")
def _initialize(params: dict, monitor: ConnectionMonitor | None) -> dict:
    from . import __version__
    return {
        "version": __version__,
        "capabilities": [
            "exec", "sftp", "shell", "forward", "env", "monitor",
        ],
    }


@_register("ping")
def _ping(params: dict, monitor: ConnectionMonitor | None) -> dict:
    return {
        "ok": True,
        "uptime": monitor.uptime_seconds if monitor is not None else 0.0,
    }


@_register("shutdown")
def _shutdown(params: dict, monitor: ConnectionMonitor | None) -> dict:
    # Raising SystemExit is the cleanest way - the daemon will catch it.
    raise SystemExit(0)


# ─── session lifecycle ─────────────────────────────────────────────────────

@_register("connect")
def _connect(params: dict, monitor: ConnectionMonitor | None) -> dict:
    if not isinstance(params, dict):
        raise RpcError(INVALID_PARAMS, "params must be an object")
    if "host" not in params:
        raise RpcError(INVALID_PARAMS, "params.host is required")
    session = session_create(params)
    summary = session.summary()
    return {
        "sessionId": session.session_id,
        "host": summary["host"],
        "user": summary["user"],
        "port": summary["port"],
    }


@_register("disconnect")
def _disconnect(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_get(sid)
    if session is None:
        return {}
    session.close()
    session_remove(sid)
    return {}


@_register("list_sessions")
def _list_sessions(params: dict, monitor: ConnectionMonitor | None) -> dict:
    return {"sessions": list_all()}


@_register("get_session")
def _get_session(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_get(sid)
    if session is None:
        return {"session": None}
    return {"session": session.summary()}


# ─── exec ──────────────────────────────────────────────────────────────────

@_register("run")
def _run(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    command = _require_str(params, "command")
    timeout_ms = _require_int(params, "timeoutMs", default=30000)
    stdin_text = params.get("stdinText")
    if stdin_text is not None and not isinstance(stdin_text, str):
        raise RpcError(INVALID_PARAMS, "params.stdinText must be a string")
    session = session_require(sid)
    return exec_run(session, command, timeout_ms=timeout_ms, stdin_text=stdin_text)


# ─── sftp ──────────────────────────────────────────────────────────────────

@_register("upload")
def _upload(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    local = _require_str(params, "localPath")
    remote = _require_str(params, "remotePath")
    preserve = bool(params.get("preserve", False))
    transfer_id = params.get("transferId")
    if transfer_id is not None and not isinstance(transfer_id, str):
        raise RpcError(INVALID_PARAMS, "params.transferId must be a string")
    progress = _make_progress_emitter(sid, transfer_id) if transfer_id else None
    return upload(session, local, remote, preserve=preserve, transfer_id=transfer_id, progress=progress)


@_register("download")
def _download(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    remote = _require_str(params, "remotePath")
    local = _require_str(params, "localPath")
    preserve = bool(params.get("preserve", False))
    transfer_id = params.get("transferId")
    if transfer_id is not None and not isinstance(transfer_id, str):
        raise RpcError(INVALID_PARAMS, "params.transferId must be a string")
    progress = _make_progress_emitter(sid, transfer_id) if transfer_id else None
    return download(session, remote, local, preserve=preserve, transfer_id=transfer_id, progress=progress)


@_register("read_file")
def _read_file(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    remote = _require_str(params, "remotePath")
    encoding = params.get("encoding", "utf-8")
    return read_file(session, remote, encoding=encoding)


@_register("write_file")
def _write_file(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    remote = _require_str(params, "remotePath")
    content = params.get("content", "")
    if not isinstance(content, str):
        raise RpcError(INVALID_PARAMS, "params.content must be a string")
    encoding = params.get("encoding", "utf-8")
    mode = params.get("mode")
    return write_file(session, remote, content, encoding=encoding, mode=mode)


@_register("list_dir")
def _list_dir(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    remote = _require_str(params, "remotePath")
    entries = list_dir(session, remote)
    return {"entries": entries}


@_register("mkdir")
def _mkdir(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    remote = _require_str(params, "remotePath")
    recursive = bool(params.get("recursive", False))
    mode = params.get("mode")
    return mkdir(session, remote, recursive=recursive, mode=mode)


@_register("rename")
def _rename(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    source = _require_str(params, "sourcePath")
    destination = _require_str(params, "destinationPath")
    return sftp_rename(session, source, destination)


@_register("remove")
def _remove(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    remote = _require_str(params, "remotePath")
    recursive = bool(params.get("recursive", False))
    return sftp_remove(session, remote, recursive=recursive)


@_register("stat")
def _stat(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    remote = _require_str(params, "remotePath")
    return sftp_stat(session, remote)


@_register("chmod")
def _chmod(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    remote = _require_str(params, "remotePath")
    mode = _require_int(params, "mode")
    return chmod(session, remote, mode)


@_register("chown")
def _chown(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    remote = _require_str(params, "remotePath")
    uid = params.get("uid")
    gid = params.get("gid")
    return chown(session, remote, uid=int(uid) if uid is not None else None, gid=int(gid) if gid is not None else None)


# ─── shell ─────────────────────────────────────────────────────────────────

@_register("open_shell")
def _open_shell(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    cols = _require_int(params, "cols", default=80)
    rows = _require_int(params, "rows", default=24)
    term = params.get("term", "xterm-256color")
    shell_id = open_shell(session, cols=cols, rows=rows, term=term)
    return {"shellId": shell_id}


@_register("close_shell")
def _close_shell(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    shell_id = _require_str(params, "shellId")
    session = session_require(sid)
    close_shell(session, shell_id)
    return {}


@_register("send_keys")
def _send_keys(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    shell_id = _require_str(params, "shellId")
    keys = params.get("keys")
    if not isinstance(keys, list):
        raise RpcError(INVALID_PARAMS, "params.keys must be a list")
    pace_ms = params.get("paceMs")
    if pace_ms is not None:
        try:
            pace_ms = int(pace_ms)
        except (TypeError, ValueError):
            raise RpcError(INVALID_PARAMS, "params.paceMs must be an integer")
    session = session_require(sid)
    shell = require_shell(session, shell_id)
    return shell.send(keys, pace_ms=pace_ms)


@_register("paste")
def _paste(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    shell_id = _require_str(params, "shellId")
    text = _require_str(params, "text")
    session = session_require(sid)
    shell = require_shell(session, shell_id)
    return shell.paste(text)


@_register("peek")
def _peek(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    shell_id = _require_str(params, "shellId")
    session = session_require(sid)
    shell = require_shell(session, shell_id)
    max_bytes = _require_int(params, "maxBytes", default=65536)
    since = params.get("since")
    if since is not None:
        since = _require_int(params, "since")
    return shell.peek(max_bytes=max_bytes, since=since)


@_register("expect")
def _expect(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    shell_id = _require_str(params, "shellId")
    pattern = _require_str(params, "pattern")
    timeout_ms = _require_int(params, "timeoutMs", default=5000)
    session = session_require(sid)
    shell = require_shell(session, shell_id)
    return shell.expect(pattern, timeout_ms=timeout_ms)


@_register("resize_shell")
def _resize_shell(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    shell_id = _require_str(params, "shellId")
    cols = _require_int(params, "cols")
    rows = _require_int(params, "rows")
    session = session_require(sid)
    shell = require_shell(session, shell_id)
    return shell.resize(cols, rows)


@_register("interrupt_shell")
def _interrupt_shell(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    shell_id = _require_str(params, "shellId")
    count = _require_int(params, "count", default=5)
    session = session_require(sid)
    shell = require_shell(session, shell_id)
    return shell.interrupt(count)


@_register("list_shells")
def _list_shells(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    return {"shells": session.list_shells()}


# ─── env ───────────────────────────────────────────────────────────────────

@_register("get_env")
def _get_env(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    key = _require_str(params, "key")
    session = session_require(sid)
    return {"value": session.get_env(key)}


@_register("set_env")
def _set_env(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    key = _require_str(params, "key")
    value = params.get("value", "")
    if not isinstance(value, str):
        raise RpcError(INVALID_PARAMS, "params.value must be a string")
    session = session_require(sid)
    session.set_env(key, value)
    return {}


# ─── port forwarding ───────────────────────────────────────────────────────

@_register("forward_local")
def _forward_local(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    local_host = params.get("localHost", "127.0.0.1")
    local_port = _require_int(params, "localPort", default=0)
    remote_host = _require_str(params, "remoteHost")
    remote_port = _require_int(params, "remotePort")
    fwd_id = forward_local(session, local_host, local_port, remote_host, remote_port)
    forward = session.get_forward(fwd_id)
    bound_port = forward.summary()["localPort"] if forward is not None else local_port
    return {"forwardId": fwd_id, "localHost": local_host, "localPort": bound_port, "remoteHost": remote_host, "remotePort": remote_port}


@_register("forward_remote")
def _forward_remote(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    remote_port = _require_int(params, "remotePort")
    local_host = params.get("localHost", "127.0.0.1")
    local_port = _require_int(params, "localPort")
    fwd_id = forward_remote(session, remote_port, local_host, local_port)
    return {"forwardId": fwd_id, "remotePort": remote_port, "localHost": local_host, "localPort": local_port}


@_register("forward_dynamic")
def _forward_dynamic(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    local_host = params.get("localHost", "127.0.0.1")
    local_port = _require_int(params, "localPort", default=0)
    fwd_id = forward_dynamic(session, local_host, local_port)
    forward = session.get_forward(fwd_id)
    bound_port = forward.summary()["localPort"] if forward is not None else local_port
    return {"forwardId": fwd_id, "localHost": local_host, "localPort": bound_port}


@_register("cancel_transfer")
def _cancel_transfer(params: dict, monitor: ConnectionMonitor | None) -> dict:
    transfer_id = _require_str(params, "transferId")
    return cancel_transfer(transfer_id)


@_register("cancel_forward")
def _cancel_forward(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    forward_id = _require_str(params, "forwardId")
    session = session_require(sid)
    cancel_forward(session, forward_id)
    return {}


@_register("list_forwards")
def _list_forwards(params: dict, monitor: ConnectionMonitor | None) -> dict:
    sid = _require_session_id(params)
    session = session_require(sid)
    return {"forwards": session.list_forwards()}


# ─── dispatch ──────────────────────────────────────────────────────────────

def dispatch(method: str, params: dict, monitor: ConnectionMonitor | None) -> dict:
    """Dispatch a JSON-RPC method to its handler."""
    handler = _METHODS.get(method)
    if handler is None:
        raise RpcError(METHOD_NOT_FOUND, f"Method not found: {method!r}")
    return handler(params, monitor)

"""SFTP operations: file read/write, upload/download, directory ops, chmod/chown.

All operations go through paramiko's SFTPClient which uses pure-protocol SSH
file transfer - no PTY. Every public operation is serialized per session (see
`_serialized`): paramiko's synchronous `_read_response()` drops a response
that a concurrent thread reads first, wedging both threads in `_read_packet()`
forever, and the daemon runs one worker thread per RPC.
"""

from __future__ import annotations

import functools
import os
import stat as stat_mod
import threading
import uuid
from typing import Any, Callable

import paramiko

from .errors import RpcError, FILE_NOT_FOUND, PERMISSION_DENIED, PATH_IS_DIRECTORY, TRANSFER_CANCELLED
from .session import Session


CHUNK_BYTES = 256 * 1024

# In-flight transfers keyed by opaque id, so a concurrent cancel_transfer RPC
# can signal a long upload/download to abort between chunks.
_active_transfers: dict[str, threading.Event] = {}
_transfers_lock = threading.Lock()


def _serialized(fn: Callable) -> Callable:
    """Hold the session's SFTP op lock for the whole operation.

    Paramiko multiplexes every request over one channel; its synchronous
    `_read_response()` consumes whichever packet arrives next and silently
    drops responses a sibling thread was waiting for, so overlapping ops on
    one SFTPClient wedge each other permanently. `cancel_transfer` is the
    deliberate exception: it only sets an event and must never wait on this
    lock, or an in-flight transfer could never be aborted.
    """
    @functools.wraps(fn)
    def wrapper(session: Session, *args: Any, **kwargs: Any):
        with session.sftp_lock:
            return fn(session, *args, **kwargs)
    return wrapper


def cancel_transfer(transfer_id: str) -> dict:
    """Signal an in-flight transfer to abort. No-op if it has already finished."""
    with _transfers_lock:
        event = _active_transfers.get(transfer_id)
    if event is not None:
        event.set()
    return {"transferId": transfer_id, "cancelled": True}


def _register_transfer(transfer_id: str | None) -> threading.Event | None:
    if not transfer_id:
        return None
    event = threading.Event()
    with _transfers_lock:
        _active_transfers[transfer_id] = event
    return event


def _release_transfer(transfer_id: str | None) -> None:
    if not transfer_id:
        return
    with _transfers_lock:
        _active_transfers.pop(transfer_id, None)


def _put_chunked(sftp: paramiko.SFTPClient, local_path: str, remote_path: str, transfer_id: str | None = None, progress: Callable[[int, int], None] | None = None) -> None:
    """Upload local_path to remote_path in fixed chunks, aborting if cancelled."""
    cancel = _register_transfer(transfer_id)
    try:
        total = os.path.getsize(local_path)
        sent = 0
        index = 0
        with open(local_path, "rb") as src, sftp.open(remote_path, "wb") as dst:
            while True:
                if cancel is not None and cancel.is_set():
                    raise RpcError(TRANSFER_CANCELLED, "Transfer cancelled")
                chunk = src.read(CHUNK_BYTES)
                if not chunk:
                    break
                dst.write(chunk)
                sent += len(chunk)
                index += 1
                if progress is not None and (index % 8 == 0 or sent >= total):
                    progress(sent, total)
        if progress is not None:
            progress(sent, total)
    finally:
        _release_transfer(transfer_id)


def _get_chunked(sftp: paramiko.SFTPClient, remote_path: str, local_path: str, transfer_id: str | None = None, progress: Callable[[int, int], None] | None = None) -> None:
    """Download remote_path to local_path in fixed chunks, aborting if cancelled."""
    cancel = _register_transfer(transfer_id)
    try:
        try:
            total = sftp.stat(remote_path).st_size or 0
        except Exception:
            total = 0
        received = 0
        index = 0
        with sftp.open(remote_path, "rb") as src, open(local_path, "wb") as dst:
            while True:
                if cancel is not None and cancel.is_set():
                    raise RpcError(TRANSFER_CANCELLED, "Transfer cancelled")
                chunk = src.read(CHUNK_BYTES)
                if not chunk:
                    break
                dst.write(chunk)
                received += len(chunk)
                index += 1
                if progress is not None and (index % 8 == 0 or (total and received >= total)):
                    progress(received, total)
        if progress is not None:
            progress(received, total)
    finally:
        _release_transfer(transfer_id)


# ─── Upload / download ──────────────────────────────────────────────────────

@_serialized
def upload(session: Session, local_path: str, remote_path: str, preserve: bool = False, transfer_id: str | None = None, progress: Callable[[int, int], None] | None = None) -> dict:
    """Upload a file or symlink-safe directory tree via SFTP.

    When ``preserve`` is set, remote mtime/atime and permission bits are restored
    from the local file after the transfer. ``transfer_id`` enables a concurrent
    ``cancel_transfer`` RPC to abort a large upload; ``progress`` receives
    (bytes, total) updates during the transfer.
    """
    if not os.path.exists(local_path):
        raise RpcError(FILE_NOT_FOUND, f"Local file not found: {local_path!r}")
    if os.path.islink(local_path):
        raise RpcError(FILE_NOT_FOUND, "Local symlink uploads are not supported")
    sftp = session.sftp()
    session.touch()
    try:
        if os.path.isdir(local_path):
            transferred = _upload_tree(sftp, local_path, remote_path, preserve, transfer_id, progress)
        else:
            _upload_file_atomic(sftp, local_path, remote_path, transfer_id, progress)
            transferred = os.path.getsize(local_path)
            if preserve:
                _preserve_remote_file_attrs(sftp, local_path, remote_path)
    except PermissionError as e:
        raise RpcError(PERMISSION_DENIED, f"Permission denied uploading to {remote_path!r}: {e}")
    except FileNotFoundError as e:
        raise RpcError(FILE_NOT_FOUND, f"Remote path not found: {remote_path!r} ({e})")
    session.touch()
    return {"bytesTransferred": transferred, "remotePath": remote_path}


@_serialized
def download(session: Session, remote_path: str, local_path: str, preserve: bool = False, transfer_id: str | None = None, progress: Callable[[int, int], None] | None = None) -> dict:
    """Download a file or symlink-safe directory tree via SFTP.

    When ``preserve`` is set, local mtime/atime is restored from the remote
    file after the transfer, and permission bits are restored on POSIX hosts.
    ``transfer_id`` enables a concurrent ``cancel_transfer`` RPC to abort a
    large download; ``progress`` receives (bytes, total) updates.
    """
    sftp = session.sftp()
    session.touch()
    try:
        attr = sftp.lstat(remote_path)
        if stat_mod.S_ISLNK(attr.st_mode):
            raise RpcError(FILE_NOT_FOUND, "Remote symlink downloads are not supported")
        if stat_mod.S_ISDIR(attr.st_mode):
            transferred = _download_tree(sftp, remote_path, local_path, preserve, transfer_id, progress)
        else:
            os.makedirs(os.path.dirname(os.path.abspath(local_path)), exist_ok=True)
            _download_file_atomic(sftp, remote_path, local_path, transfer_id, progress)
            transferred = os.path.getsize(local_path)
            if preserve:
                _preserve_local_file_attrs(sftp, remote_path, local_path)
    except PermissionError as e:
        raise RpcError(PERMISSION_DENIED, f"Permission denied downloading {remote_path!r}: {e}")
    except FileNotFoundError as e:
        raise RpcError(FILE_NOT_FOUND, f"Remote file not found: {remote_path!r} ({e})")
    session.touch()
    return {"bytesTransferred": transferred, "localPath": local_path}


def _ensure_remote_dir(sftp: paramiko.SFTPClient, remote_path: str) -> None:
    parts = remote_path.strip("/").split("/")
    current = ""
    for part in parts:
        if not part:
            continue
        current = f"{current}/{part}" if current else f"/{part}"
        try:
            sftp.stat(current)
        except IOError:
            sftp.mkdir(current)


def _upload_file_atomic(sftp: paramiko.SFTPClient, local_path: str, remote_path: str, transfer_id: str | None = None, progress: Callable[[int, int], None] | None = None) -> None:
    temporary = f"{remote_path}.aftc-upload-{uuid.uuid4().hex}"
    try:
        _put_chunked(sftp, local_path, temporary, transfer_id, progress)
        try:
            sftp.posix_rename(temporary, remote_path)
        except (AttributeError, IOError):
            try:
                sftp.remove(remote_path)
            except IOError:
                pass
            sftp.rename(temporary, remote_path)
    except Exception:
        try:
            sftp.remove(temporary)
        except IOError:
            pass
        raise


def _download_file_atomic(sftp: paramiko.SFTPClient, remote_path: str, local_path: str, transfer_id: str | None = None, progress: Callable[[int, int], None] | None = None) -> None:
    temporary = f"{local_path}.aftc-download-{uuid.uuid4().hex}"
    try:
        _get_chunked(sftp, remote_path, temporary, transfer_id, progress)
        os.replace(temporary, local_path)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _upload_tree(sftp: paramiko.SFTPClient, local_root: str, remote_root: str, preserve: bool = False, transfer_id: str | None = None, progress: Callable[[int, int], None] | None = None) -> int:
    total = 0
    _ensure_remote_dir(sftp, remote_root)
    for directory, names, files in os.walk(local_root, followlinks=False):
        names[:] = [name for name in names if not os.path.islink(os.path.join(directory, name))]
        relative = os.path.relpath(directory, local_root)
        remote_dir = remote_root if relative == "." else f"{remote_root.rstrip('/')}/{relative.replace(os.sep, '/')}"
        _ensure_remote_dir(sftp, remote_dir)
        for filename in files:
            local_file = os.path.join(directory, filename)
            if os.path.islink(local_file):
                continue
            remote_file = f"{remote_dir.rstrip('/')}/{filename}"
            _put_chunked(sftp, local_file, remote_file, transfer_id, progress)
            if preserve:
                _preserve_remote_file_attrs(sftp, local_file, remote_file)
            total += os.path.getsize(local_file)
    return total


def _download_tree(sftp: paramiko.SFTPClient, remote_root: str, local_root: str, preserve: bool = False, transfer_id: str | None = None, progress: Callable[[int, int], None] | None = None) -> int:
    total = 0
    os.makedirs(local_root, exist_ok=True)
    for entry in sftp.listdir_attr(remote_root):
        remote_child = f"{remote_root.rstrip('/')}/{entry.filename}"
        local_child = os.path.join(local_root, entry.filename)
        if stat_mod.S_ISLNK(entry.st_mode):
            continue
        if stat_mod.S_ISDIR(entry.st_mode):
            total += _download_tree(sftp, remote_child, local_child, preserve, transfer_id, progress)
        else:
            _get_chunked(sftp, remote_child, local_child, transfer_id, progress)
            if preserve:
                _preserve_local_file_attrs(sftp, remote_child, local_child)
            total += os.path.getsize(local_child)
    return total


def _preserve_remote_file_attrs(sftp: paramiko.SFTPClient, local_path: str, remote_path: str) -> None:
    """Restore remote mtime/atime and permission bits from the local file."""
    try:
        st = os.stat(local_path)
    except OSError:
        return
    try:
        sftp.utime(remote_path, (st.st_atime, st.st_mtime))
    except Exception:
        pass
    try:
        sftp.chmod(remote_path, stat_mod.S_IMODE(st.st_mode) or 0o644)
    except Exception:
        pass


def _preserve_local_file_attrs(sftp: paramiko.SFTPClient, remote_path: str, local_path: str) -> None:
    """Restore local mtime/atime (and permission bits on POSIX) from the remote file."""
    try:
        attr = sftp.stat(remote_path)
    except Exception:
        return
    try:
        if attr.st_atime and attr.st_mtime:
            os.utime(local_path, (attr.st_atime, attr.st_mtime))
    except OSError:
        pass
    if os.name != "nt" and attr.st_mode:
        try:
            os.chmod(local_path, stat_mod.S_IMODE(attr.st_mode))
        except OSError:
            pass


# ─── Read / write ───────────────────────────────────────────────────────────

@_serialized
def read_file(session: Session, remote_path: str, encoding: str = "utf-8") -> dict:
    """Read a remote file as text."""
    sftp = session.sftp()
    session.touch()
    try:
        with sftp.open(remote_path, "r") as f:
            content = f.read().decode(encoding, errors="replace")
    except PermissionError as e:
        raise RpcError(PERMISSION_DENIED, f"Permission denied reading {remote_path!r}: {e}")
    except FileNotFoundError as e:
        raise RpcError(FILE_NOT_FOUND, f"Remote file not found: {remote_path!r} ({e})")
    except IOError as e:
        # paramiko raises IOError for "not a regular file" / "is a directory"
        if "Is a directory" in str(e) or "is a directory" in str(e):
            raise RpcError(PATH_IS_DIRECTORY, f"{remote_path!r} is a directory")
        raise
    session.touch()
    return {"content": content, "encoding": encoding, "remotePath": remote_path}


@_serialized
def write_file(
    session: Session,
    remote_path: str,
    content: str,
    encoding: str = "utf-8",
    mode: int | None = None,
) -> dict:
    """Write `content` to `remote_path` as text."""
    sftp = session.sftp()
    session.touch()
    try:
        with sftp.open(remote_path, "wb") as f:
            f.write(content.encode(encoding))
            if mode is not None:
                f.chmod(mode)
    except PermissionError as e:
        raise RpcError(PERMISSION_DENIED, f"Permission denied writing {remote_path!r}: {e}")
    except FileNotFoundError as e:
        raise RpcError(FILE_NOT_FOUND, f"Remote path not found: {remote_path!r} ({e})")
    session.touch()
    return {"bytesWritten": len(content.encode(encoding)), "remotePath": remote_path}


# ─── Directory ops ──────────────────────────────────────────────────────────

@_serialized
def rename(session: Session, source_path: str, destination_path: str) -> dict:
    """Rename a remote file or directory without copying its content."""
    sftp = session.sftp()
    session.touch()
    try:
        sftp.rename(source_path, destination_path)
    except PermissionError as e:
        raise RpcError(PERMISSION_DENIED, f"Permission denied renaming remote path: {e}")
    except FileNotFoundError as e:
        raise RpcError(FILE_NOT_FOUND, f"Remote path not found: {e}")
    session.touch()
    return {"sourcePath": source_path, "destinationPath": destination_path}


@_serialized
def list_dir(session: Session, remote_path: str) -> list[dict]:
    """List a remote directory."""
    sftp = session.sftp()
    session.touch()
    entries: list[dict] = []
    try:
        for attr in sftp.listdir_attr(remote_path):
            entries.append(_attr_to_entry(attr, remote_path))
    except PermissionError as e:
        raise RpcError(PERMISSION_DENIED, f"Permission denied listing {remote_path!r}: {e}")
    except FileNotFoundError as e:
        raise RpcError(FILE_NOT_FOUND, f"Remote directory not found: {remote_path!r} ({e})")
    session.touch()
    return entries


@_serialized
def mkdir(session: Session, remote_path: str, recursive: bool = False, mode: int | None = None) -> dict:
    """Create a remote directory."""
    sftp = session.sftp()
    session.touch()
    try:
        if recursive:
            # Walk up creating parents as needed.
            parts = remote_path.strip("/").split("/")
            cur = ""
            for i, part in enumerate(parts):
                cur = f"{cur}/{part}" if cur else f"/{part}"
                try:
                    sftp.stat(cur)
                    continue
                except IOError:
                    pass
                sftp.mkdir(cur, mode=mode if i == len(parts) - 1 and mode is not None else 0o755)
        else:
            sftp.mkdir(remote_path, mode=mode if mode is not None else 0o755)
    except PermissionError as e:
        raise RpcError(PERMISSION_DENIED, f"Permission denied creating {remote_path!r}: {e}")
    session.touch()
    return {"remotePath": remote_path}


@_serialized
def remove(session: Session, remote_path: str, recursive: bool = False) -> dict:
    """Remove a remote file or directory."""
    sftp = session.sftp()
    session.touch()
    try:
        try:
            attr = sftp.stat(remote_path)
        except FileNotFoundError as e:
            raise RpcError(FILE_NOT_FOUND, f"Remote path not found: {remote_path!r} ({e})")
        if stat_mod.S_ISDIR(attr.st_mode):
            if not recursive:
                raise RpcError(PATH_IS_DIRECTORY, f"{remote_path!r} is a directory (use recursive=True)")
            _remove_recursive(sftp, remote_path)
        else:
            sftp.remove(remote_path)
    except PermissionError as e:
        raise RpcError(PERMISSION_DENIED, f"Permission denied removing {remote_path!r}: {e}")
    session.touch()
    return {"remotePath": remote_path}


def _remove_recursive(sftp: paramiko.SFTPClient, path: str) -> None:
    """Recursively remove a directory tree."""
    for entry in sftp.listdir_attr(path):
        full = f"{path.rstrip('/')}/{entry.filename}"
        if stat_mod.S_ISDIR(entry.st_mode):
            _remove_recursive(sftp, full)
        else:
            sftp.remove(full)
    sftp.rmdir(path)


@_serialized
def stat(session: Session, remote_path: str) -> dict:
    """Stat a remote file or directory."""
    sftp = session.sftp()
    session.touch()
    try:
        attr = sftp.stat(remote_path)
    except FileNotFoundError as e:
        raise RpcError(FILE_NOT_FOUND, f"Remote path not found: {remote_path!r} ({e})")
    session.touch()
    # sftp.stat() returns SFTPAttributes without a `filename` attribute, so
    # derive the entry name from the remote_path itself.
    entry = _attr_to_entry(attr, remote_path)
    if not entry.get("name"):
        entry["name"] = os.path.basename(remote_path.rstrip("/")) or remote_path
        entry["path"] = remote_path
    return entry


@_serialized
def chmod(session: Session, remote_path: str, mode: int) -> dict:
    """Change remote file mode."""
    sftp = session.sftp()
    session.touch()
    try:
        sftp.chmod(remote_path, mode)
    except PermissionError as e:
        raise RpcError(PERMISSION_DENIED, f"Permission denied chmod {remote_path!r}: {e}")
    except FileNotFoundError as e:
        raise RpcError(FILE_NOT_FOUND, f"Remote path not found: {remote_path!r} ({e})")
    session.touch()
    return {"remotePath": remote_path, "mode": mode}


@_serialized
def chown(session: Session, remote_path: str, uid: int | None = None, gid: int | None = None) -> dict:
    """Change remote file ownership."""
    sftp = session.sftp()
    session.touch()
    try:
        sftp.chown(remote_path, uid if uid is not None else -1, gid if gid is not None else -1)
    except PermissionError as e:
        raise RpcError(PERMISSION_DENIED, f"Permission denied chown {remote_path!r}: {e}")
    except FileNotFoundError as e:
        raise RpcError(FILE_NOT_FOUND, f"Remote path not found: {remote_path!r} ({e})")
    session.touch()
    return {"remotePath": remote_path, "uid": uid, "gid": gid}


# ─── helpers ────────────────────────────────────────────────────────────────

def _attr_to_entry(attr: paramiko.SFTPAttributes, parent: str = "") -> dict:
    """Convert a paramiko SFTPAttributes into a JSON-friendly dict."""
    # SFTPAttributes returned by sftp.stat() do NOT have a `filename` attribute
    # (only listdir_attr results do). Handle both cases.
    filename = getattr(attr, "filename", "") or ""
    full = f"{parent.rstrip('/')}/{filename}" if parent and filename else (filename or (parent or ""))
    is_dir = stat_mod.S_ISDIR(attr.st_mode) if attr.st_mode else False
    is_link = stat_mod.S_ISLNK(attr.st_mode) if attr.st_mode else False
    size = attr.st_size or 0
    mode = attr.st_mode or 0
    return {
        "path": full,
        "name": filename,
        "isDirectory": is_dir,
        "isFile": stat_mod.S_ISREG(attr.st_mode) if attr.st_mode else False,
        "isSymlink": is_link,
        "size": size,
        "mode": mode,
        "modeStr": stat_mod.filemode(mode) if mode else "?",
        "uid": attr.st_uid,
        "gid": attr.st_gid,
        "mtime": attr.st_mtime,
        "atime": attr.st_atime,
    }

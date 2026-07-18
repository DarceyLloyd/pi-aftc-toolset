"""SSH session manager.

Each session wraps a paramiko.SSHClient. Sessions are tracked in a dict
keyed by session ID. The manager is thread-safe.

Sessions own:
- One paramiko.SSHClient (the underlying transport)
- One paramiko.SFTPClient (lazy-opened on first SFTP op)
- Zero or more InteractiveShell instances (for nano/vim/htop driving)
- Zero or more PortForward instances (for local/remote/dynamic forwarding)
- A per-session env map (for get_env/set_env)

AFTC ADAPTATION: Unlike the reference pyPtyCarrier, this module exposes
`remove_if_dead` so the monitor thread can prune a single dead session
without terminating the daemon. See `monitor.py`.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import paramiko

from .errors import RpcError, UNKNOWN_SESSION


# Module-level session registry. Protected by _lock.
_sessions: dict[str, "Session"] = {}
_lock = threading.Lock()
_session_host_keys: dict[str, bytes] = {}
_host_keys_lock = threading.Lock()


class SessionHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    """Require local approval for new host keys and reject changed keys."""

    def __init__(self, allow_new: bool) -> None:
        self.allow_new = allow_new

    def missing_host_key(self, client: paramiko.SSHClient, hostname: str, key: paramiko.PKey) -> None:
        key_bytes = key.asbytes()
        with _host_keys_lock:
            existing = _session_host_keys.get(hostname)
            if existing is not None and existing != key_bytes:
                from .errors import HOST_KEY_CHANGED
                raise RpcError(HOST_KEY_CHANGED, "SSH host key changed.")
            if existing is None and not self.allow_new:
                from .errors import HOST_KEY_UNKNOWN
                raise RpcError(HOST_KEY_UNKNOWN, "SSH host key needs local approval.")
            _session_host_keys[hostname] = key_bytes
        client.get_host_keys().add(hostname, key.get_name(), key)


def new_id() -> str:
    """Generate a new session ID."""
    return f"sshsess-{uuid.uuid4().hex[:12]}"


def create(params: dict) -> "Session":
    """Open a new SSH session and register it. Returns the session."""
    session_id = new_id()
    session = Session(session_id=session_id, params=params)
    session.connect()
    with _lock:
        _sessions[session_id] = session
    return session


def get(session_id: str) -> "Session | None":
    with _lock:
        return _sessions.get(session_id)


def require(session_id: str) -> "Session":
    s = get(session_id)
    if s is None:
        raise RpcError(UNKNOWN_SESSION, f"Unknown session: {session_id!r}")
    return s


def remove(session_id: str) -> None:
    with _lock:
        _sessions.pop(session_id, None)


def list_all() -> list[dict]:
    with _lock:
        return [s.summary() for s in _sessions.values()]


def all_sessions_snapshot() -> list["Session"]:
    """Snapshot of current sessions (for the monitor thread)."""
    with _lock:
        return list(_sessions.values())


# ─── Host parsing ──────────────────────────────────────────────────────────

def _extract_user(host: str) -> str | None:
    """Extract user from 'user@host' format."""
    if "@" in host:
        return host.split("@", 1)[0] or None
    return None


def _extract_host_only(host: str) -> str:
    """Strip user@ prefix and :port suffix from a host spec."""
    h = host
    if "@" in h:
        h = h.split("@", 1)[1]
    # Strip :port (but be careful with IPv6)
    if ":" in h and not h.startswith("["):
        # simple host:port form
        h = h.rsplit(":", 1)[0]
    elif h.startswith("[") and "]:" in h:
        # [ipv6]:port form
        h = h[1:].split("]", 1)[0]
    return h


def _extract_port(host: str, default: int | None = None) -> int | None:
    """Extract port from 'host:port' format."""
    if ":" in host and not host.startswith("["):
        # simple host:port form
        tail = host.rsplit(":", 1)[1]
        try:
            return int(tail)
        except ValueError:
            return default
    if host.startswith("[") and "]:" in host:
        tail = host.split("]:", 1)[1]
        try:
            return int(tail)
        except ValueError:
            return default
    return default


# ─── Session ────────────────────────────────────────────────────────────────

@dataclass
class Session:
    """A single SSH session. Thread-safe."""

    session_id: str
    params: dict
    host: str = ""
    user: str | None = None
    port: int = 22
    _client: paramiko.SSHClient | None = field(default=None, init=False, repr=False)
    _sftp: paramiko.SFTPClient | None = field(default=None, init=False, repr=False)
    _shells: dict[str, Any] = field(default_factory=dict, init=False, repr=False)
    _shells_lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    _forwards: dict[str, Any] = field(default_factory=dict, init=False, repr=False)
    _forwards_lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    _env: dict[str, str] = field(default_factory=dict, init=False, repr=False)
    _env_lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    _closed: bool = field(default=False, init=False, repr=False)
    _connected_at: float = field(default=0.0, init=False, repr=False)
    _last_activity_at: float = field(default=0.0, init=False, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    # Serializes every SFTP operation on this session. Paramiko multiplexes all
    # requests over one channel and its synchronous _read_response() path drops
    # a response that a concurrent thread reads first, wedging both threads in
    # _read_packet() forever; the daemon runs one worker thread per RPC, so ops
    # must not overlap on the shared client. RLock so helpers may nest.
    sftp_lock: threading.RLock = field(default_factory=threading.RLock, init=False, repr=False)

    def __post_init__(self) -> None:
        # Parse host/user/port from params (or from the 'host' field which may
        # already be 'user@host:port').
        raw_host = self.params.get("host", "")
        param_user = self.params.get("user")
        param_port = self.params.get("port")

        self.user = param_user or _extract_user(raw_host)
        self.host = _extract_host_only(raw_host)
        # Only honor explicit port param; ignore a port suffix when one isn't
        # explicitly provided (keep paramiko's default of 22).
        if param_port:
            self.port = int(param_port)
        else:
            parsed_port = _extract_port(raw_host)
            self.port = parsed_port if parsed_port is not None else 22

    # ─── connection lifecycle ───────────────────────────────────────

    def connect(self) -> None:
        """Open the SSH connection. Raises RpcError on failure."""
        client = paramiko.SSHClient()

        # Host keys live only in this carrier process. New keys require a
        # local TypeScript confirmation and changed keys are rejected.
        policy = (self.params.get("strictHostKeyChecking") or "ask").lower()
        if policy == "yes":
            try:
                client.load_system_host_keys()
            except Exception:
                pass
            client.set_missing_host_key_policy(paramiko.RejectPolicy())
        else:
            client.set_missing_host_key_policy(SessionHostKeyPolicy(policy == "accept-new"))

        connect_kwargs: dict[str, Any] = {
            "hostname": self.host,
            "port": self.port,
            "timeout": float(self.params.get("connectTimeoutMs", 30000)) / 1000.0,
            "allow_agent": bool(self.params.get("allowAgent", True)),
            "look_for_keys": bool(self.params.get("lookForKeys", True)),
            "banner_timeout": float(self.params.get("connectTimeoutMs", 30000)) / 1000.0,
            "auth_timeout": float(self.params.get("connectTimeoutMs", 30000)) / 1000.0,
        }

        if self.user:
            connect_kwargs["username"] = self.user

        if self.params.get("password"):
            connect_kwargs["password"] = self.params["password"]

        # Identity file (key auth). Try common key types.
        identity = self.params.get("identityFile")
        if identity:
            passphrase = self.params.get("identityPassphrase")
            loaded = False
            for key_cls in (
                paramiko.Ed25519Key,
                paramiko.RSAKey,
                paramiko.ECDSAKey,
                paramiko.DSSKey,
            ):
                try:
                    if passphrase:
                        pkey = key_cls.from_private_key_file(identity, password=passphrase)
                    else:
                        pkey = key_cls.from_private_key_file(identity)
                    connect_kwargs["pkey"] = pkey
                    loaded = True
                    break
                except paramiko.PasswordRequiredException:
                    # The key needs a passphrase and none was provided.
                    from .errors import KEY_LOAD_FAILED, AUTH_FAILED
                    raise RpcError(
                        KEY_LOAD_FAILED,
                        f"Identity file {identity!r} is encrypted; provide identityPassphrase",
                    )
                except Exception:
                    continue
            if not loaded:
                from .errors import KEY_LOAD_FAILED
                raise RpcError(
                    KEY_LOAD_FAILED,
                    f"Could not load identity file as any known key type: {identity!r}",
                )

        try:
            client.connect(**connect_kwargs)
        except paramiko.AuthenticationException as e:
            from .errors import AUTH_FAILED
            raise RpcError(AUTH_FAILED, f"Authentication failed: {e}")
        except paramiko.SSHException as e:
            from .errors import CONNECTION_FAILED
            raise RpcError(CONNECTION_FAILED, f"SSH error: {e}")
        except (OSError, TimeoutError) as e:
            from .errors import CONNECTION_FAILED
            raise RpcError(CONNECTION_FAILED, f"Connection failed: {e}")

        # Authentication values are needed only while connecting. Do not retain
        # passwords or private-key passphrases in a live session object.
        self.params = {
            key: value for key, value in self.params.items()
            if key not in {"password", "identityPassphrase"}
        }

        with self._lock:
            self._client = client
            self._connected_at = time.time()
            self._last_activity_at = time.time()
            self._closed = False

        # Eagerly open SFTP so the first SFTP op doesn't pay the open cost.
        try:
            self._sftp = client.open_sftp()
        except Exception:
            # Non-fatal; will retry on first SFTP op.
            self._sftp = None

    def close(self) -> None:
        """Close the session and all sub-resources. Idempotent."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            shells = list(self._shells.values())
            forwards = list(self._forwards.values())
            self._shells.clear()
            self._forwards.clear()
            sftp = self._sftp
            client = self._client
            self._sftp = None
            self._client = None

        # Close sub-resources OUTSIDE the lock to avoid deadlock if a close
        # callback re-enters the manager.
        for shell in shells:
            try:
                shell.close()
            except Exception:
                pass
        for fwd in forwards:
            try:
                fwd.close()
            except Exception:
                pass
        if sftp is not None:
            try:
                sftp.close()
            except Exception:
                pass
        if client is not None:
            try:
                client.close()
            except Exception:
                pass

    def is_alive(self) -> bool:
        """Check whether the SSH transport is still active."""
        with self._lock:
            if self._closed or self._client is None:
                return False
            transport = self._client.get_transport()
        return transport is not None and transport.is_active()

    def touch(self) -> None:
        with self._lock:
            self._last_activity_at = time.time()

    def client(self) -> paramiko.SSHClient:
        with self._lock:
            if self._closed or self._client is None:
                raise RpcError(UNKNOWN_SESSION, f"Session {self.session_id!r} is not connected")
            return self._client

    def sftp(self) -> paramiko.SFTPClient:
        """Return an open SFTP client, opening it lazily if needed."""
        with self._lock:
            if self._closed or self._client is None:
                raise RpcError(UNKNOWN_SESSION, f"Session {self.session_id!r} is not connected")
            if self._sftp is None:
                self._sftp = self._client.open_sftp()
            return self._sftp

    # ─── shells ─────────────────────────────────────────────────────

    def add_shell(self, shell: Any) -> str:
        shell_id = f"shell-{uuid.uuid4().hex[:8]}"
        with self._shells_lock:
            self._shells[shell_id] = shell
        return shell_id

    def get_shell(self, shell_id: str) -> Any | None:
        with self._shells_lock:
            return self._shells.get(shell_id)

    def remove_shell(self, shell_id: str) -> None:
        with self._shells_lock:
            self._shells.pop(shell_id, None)

    def list_shells(self) -> list[dict]:
        with self._shells_lock:
            return [
                {"shellId": sid, **s.summary()}
                for sid, s in self._shells.items()
            ]

    # ─── forwards ───────────────────────────────────────────────────

    def add_forward(self, forward: Any) -> str:
        fwd_id = f"fwd-{uuid.uuid4().hex[:8]}"
        with self._forwards_lock:
            self._forwards[fwd_id] = forward
        return fwd_id

    def get_forward(self, forward_id: str) -> Any | None:
        with self._forwards_lock:
            return self._forwards.get(forward_id)

    def remove_forward(self, forward_id: str) -> None:
        with self._forwards_lock:
            self._forwards.pop(forward_id, None)

    def list_forwards(self) -> list[dict]:
        with self._forwards_lock:
            return [
                {"forwardId": fid, **f.summary()}
                for fid, f in self._forwards.items()
            ]

    # ─── env ────────────────────────────────────────────────────────

    def get_env(self, key: str) -> str | None:
        with self._env_lock:
            return self._env.get(key)

    def set_env(self, key: str, value: str) -> None:
        # Light validation: must match POSIX env var name rules.
        if not key or not all(c.isalnum() or c == "_" for c in key) or key[0].isdigit():
            from .errors import INVALID_PARAMS
            raise RpcError(INVALID_PARAMS, f"Invalid env var name: {key!r}")
        with self._env_lock:
            self._env[key] = value

    def env_snapshot(self) -> dict[str, str]:
        with self._env_lock:
            return dict(self._env)

    # ─── summary ────────────────────────────────────────────────────

    def summary(self) -> dict:
        with self._lock:
            connected = not self._closed and self._client is not None
        return {
            "sessionId": self.session_id,
            "host": self.host,
            "user": self.user,
            "port": self.port,
            "connected": connected and self.is_alive(),
            "connectedAt": self._connected_at,
            "lastActivityAt": self._last_activity_at,
            "shellCount": len(self._shells),
            "forwardCount": len(self._forwards),
        }
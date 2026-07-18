"""Port forwarding: local (-L), remote (-R), and dynamic/SOCKS (-D).

All three modes use paramiko's transport.request_port_forward +
open_channel('direct-tcpip') / open_channel('forwarded-tcpip') for clean
SSH-protocol-based forwarding with no PTY involvement.
"""

from __future__ import annotations

import select
import socket
import threading
from typing import Any

import uuid

import paramiko

from .errors import RpcError, UNKNOWN_FORWARD, PORT_IN_USE, CHANNEL_CLOSED
from .session import Session


def _new_forward_id() -> str:
    """Generate an opaque forward id; mirrors the format used by Session.add_forward."""
    return f"fwd-{uuid.uuid4().hex[:8]}"


# ─── Forward base class ────────────────────────────────────────────────────

class PortForward:
    """Base class for all forward types. Subclasses implement _accept_loop."""

    def __init__(self, session: Session, forward_id: str) -> None:
        self.session = session
        self.forward_id = forward_id
        self._stopped = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> dict:
        raise NotImplementedError

    def close(self) -> None:
        self._stopped.set()

    def summary(self) -> dict:
        raise NotImplementedError


# ─── Local forwarding (-L) ─────────────────────────────────────────────────

class LocalForward(PortForward):
    """Forwards connections from a local TCP port through the SSH tunnel
    to a remote host:port. Like `ssh -L localPort:remoteHost:remotePort`.
    """

    def __init__(
        self,
        session: Session,
        forward_id: str,
        local_host: str,
        local_port: int,
        remote_host: str,
        remote_port: int,
    ) -> None:
        super().__init__(session, forward_id)
        self.local_host = local_host
        self.local_port = local_port
        self.remote_host = remote_host
        self.remote_port = remote_port
        self._server: socket.socket | None = None
        self._bound_port: int = 0

    def start(self) -> dict:
        client = self.session.client()
        transport = client.get_transport()
        if transport is None:
            raise RpcError(CHANNEL_CLOSED, "Session transport is not available")
        # Listen on the local port.
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((self.local_host, self.local_port))
        except OSError as e:
            sock.close()
            raise RpcError(PORT_IN_USE, f"Local port {self.local_host}:{self.local_port} is unavailable: {e}")
        sock.listen(5)
        self._bound_port = sock.getsockname()[1]
        self._server = sock

        self._thread = threading.Thread(
            target=self._accept_loop,
            name=f"fwd-local-{self.forward_id}",
            daemon=True,
        )
        self._thread.start()
        return {
            "forwardId": self.forward_id,
            "localHost": self.local_host,
            "localPort": self._bound_port,
            "remoteHost": self.remote_host,
            "remotePort": self.remote_port,
        }

    def _accept_loop(self) -> None:
        transport = self.session.client().get_transport()
        server = self._server
        if server is None or transport is None:
            return
        server.settimeout(1.0)
        while not self._stopped.is_set():
            try:
                local_socket, origin = server.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            try:
                remote_channel = transport.open_channel(
                    "direct-tcpip",
                    (self.remote_host, self.remote_port),
                    origin,
                )
            except Exception:
                try:
                    local_socket.close()
                except OSError:
                    pass
                continue
            threading.Thread(
                target=_pipe_socket_channel,
                args=(remote_channel, local_socket),
                daemon=True,
            ).start()

    def close(self) -> None:
        super().close()
        if self._server is not None:
            try:
                self._server.close()
            except Exception:
                pass
            self._server = None
        if self._thread is not None:
            try:
                self._thread.join(timeout=1.0)
            except Exception:
                pass
            self._thread = None

    def summary(self) -> dict:
        return {
            "type": "local",
            "localHost": self.local_host,
            "localPort": self._bound_port,
            "remoteHost": self.remote_host,
            "remotePort": self.remote_port,
        }


# ─── Remote forwarding (-R) ────────────────────────────────────────────────

class RemoteForward(PortForward):
    """Forwards connections to a remote port through the SSH tunnel to a
    local host:port. Like `ssh -R remotePort:localHost:localPort`.
    """

    def __init__(
        self,
        session: Session,
        forward_id: str,
        remote_port: int,
        local_host: str,
        local_port: int,
    ) -> None:
        super().__init__(session, forward_id)
        self.remote_port = remote_port
        self.local_host = local_host
        self.local_port = local_port

    def start(self) -> dict:
        client = self.session.client()
        transport = client.get_transport()
        if transport is None:
            raise RpcError(CHANNEL_CLOSED, "Session transport is not available")
        try:
            transport.request_port_forward("", self.remote_port)
        except Exception as e:
            raise RpcError(PORT_IN_USE, f"Could not register remote forward on port {self.remote_port}: {e}")
        self._thread = threading.Thread(
            target=self._accept_loop,
            name=f"fwd-remote-{self.forward_id}",
            daemon=True,
        )
        self._thread.start()
        return {
            "forwardId": self.forward_id,
            "remotePort": self.remote_port,
            "localHost": self.local_host,
            "localPort": self.local_port,
        }

    def _accept_loop(self) -> None:
        transport = self.session.client().get_transport()
        if transport is None:
            return
        while not self._stopped.is_set():
            try:
                chan = transport.accept(1.0)
            except Exception:
                continue
            if chan is None:
                continue
            try:
                local_sock = socket.create_connection((self.local_host, self.local_port), timeout=5.0)
            except Exception:
                try:
                    chan.close()
                except Exception:
                    pass
                continue
            threading.Thread(
                target=_pipe_socket_channel,
                args=(chan, local_sock),
                daemon=True,
            ).start()

    def close(self) -> None:
        super().close()
        if self._thread is not None:
            try:
                self._thread.join(timeout=1.0)
            except Exception:
                pass
            self._thread = None

    def summary(self) -> dict:
        return {
            "type": "remote",
            "remotePort": self.remote_port,
            "localHost": self.local_host,
            "localPort": self.local_port,
        }


# ─── Dynamic forwarding / SOCKS (-D) ──────────────────────────────────────

class DynamicForward(PortForward):
    """SOCKS5 proxy on a local port. Each client connection is negotiated as
    SOCKS5 (no auth, CONNECT only) and tunnelled to the requested destination
    through the SSH transport via a direct-tcpip channel. Like `ssh -D`.
    """

    def __init__(
        self,
        session: Session,
        forward_id: str,
        local_host: str,
        local_port: int,
    ) -> None:
        super().__init__(session, forward_id)
        self.local_host = local_host
        self.local_port = local_port
        self._server: socket.socket | None = None
        self._bound_port: int = 0

    def start(self) -> dict:
        client = self.session.client()
        if client.get_transport() is None:
            raise RpcError(CHANNEL_CLOSED, "Session transport is not available")
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((self.local_host, self.local_port))
        except OSError as e:
            sock.close()
            raise RpcError(PORT_IN_USE, f"Local port {self.local_host}:{self.local_port} is unavailable: {e}")
        sock.listen(5)
        self._bound_port = sock.getsockname()[1]
        self._server = sock
        self._thread = threading.Thread(
            target=self._accept_loop,
            name=f"fwd-dynamic-{self.forward_id}",
            daemon=True,
        )
        self._thread.start()
        return {
            "forwardId": self.forward_id,
            "localHost": self.local_host,
            "localPort": self._bound_port,
        }

    def _accept_loop(self) -> None:
        server = self._server
        if server is None:
            return
        server.settimeout(1.0)
        while not self._stopped.is_set():
            try:
                client_sock, origin = server.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            threading.Thread(
                target=self._handle_socks_client,
                args=(client_sock, origin),
                daemon=True,
            ).start()

    def _handle_socks_client(self, client_sock: socket.socket, origin: tuple) -> None:
        try:
            client_sock.settimeout(10.0)
            dest = _socks5_handshake(client_sock)
            if dest is None:
                return
            transport = self.session.client().get_transport()
            if transport is None:
                _socks5_reply(client_sock, 0x01)  # general SOCKS server failure
                return
            try:
                channel = transport.open_channel("direct-tcpip", dest, origin)
            except Exception:
                _socks5_reply(client_sock, 0x05)  # connection refused
                return
            _socks5_reply(client_sock, 0x00)  # succeeded
            client_sock.settimeout(None)
            self._pump_socks(client_sock, channel)
        except Exception:
            pass
        finally:
            try:
                client_sock.close()
            except Exception:
                pass

    def _pump_socks(self, client_sock: socket.socket, channel: paramiko.Channel) -> None:
        # Single-threaded bidirectional pump: the local socket is polled with
        # select() and the channel with recv_ready(), so send and recv happen
        # on one thread (matching a sequential direct-tcpip exchange).
        client_sock.setblocking(False)
        while not self._stopped.is_set():
            try:
                readable, _w, _e = select.select([client_sock], [], [], 0.5)
            except (OSError, ValueError):
                break
            if readable:
                try:
                    data = client_sock.recv(4096)
                except OSError:
                    break
                if not data:
                    break
                try:
                    channel.sendall(data)
                except Exception:
                    break
            if channel.recv_ready():
                try:
                    data = channel.recv(4096)
                except Exception:
                    break
                if not data:
                    break
                try:
                    client_sock.sendall(data)
                except OSError:
                    break
            elif channel.closed:
                break

    def close(self) -> None:
        super().close()
        if self._server is not None:
            try:
                self._server.close()
            except Exception:
                pass
            self._server = None
        if self._thread is not None:
            try:
                self._thread.join(timeout=1.0)
            except Exception:
                pass
            self._thread = None

    def summary(self) -> dict:
        return {
            "type": "dynamic",
            "localHost": self.local_host,
            "localPort": self._bound_port,
        }


def _recv_exact(sock: socket.socket, n: int) -> bytes | None:
    data = b""
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            return None
        data += chunk
    return data


def _socks5_handshake(sock: socket.socket) -> tuple[str, int] | None:
    """Negotiate SOCKS5 no-auth CONNECT and return (dest_host, dest_port), else None."""
    try:
        header = _recv_exact(sock, 2)
        if not header or header[0] != 0x05:
            return None
        if not _recv_exact(sock, header[1]):
            return None
        sock.sendall(b"\x05\x00")  # select no authentication
        req = _recv_exact(sock, 4)
        if not req or req[0] != 0x05:
            return None
        cmd, _rsv, atyp = req[1], req[2], req[3]
        if cmd != 0x01:  # only CONNECT is supported
            _socks5_reply(sock, 0x07)  # command not supported
            return None
        if atyp == 0x01:  # IPv4
            addr = _recv_exact(sock, 4)
            if not addr:
                return None
            dest_host = socket.inet_ntoa(addr)
        elif atyp == 0x03:  # domain name
            length = _recv_exact(sock, 1)
            if not length:
                return None
            name = _recv_exact(sock, length[0])
            if not name:
                return None
            dest_host = name.decode("utf-8", "replace")
        elif atyp == 0x04:  # IPv6
            addr = _recv_exact(sock, 16)
            if not addr:
                return None
            dest_host = socket.inet_ntop(socket.AF_INET6, addr)
        else:
            _socks5_reply(sock, 0x08)  # address type not supported
            return None
        port_bytes = _recv_exact(sock, 2)
        if not port_bytes:
            return None
        return (dest_host, int.from_bytes(port_bytes, "big"))
    except (OSError, socket.timeout):
        return None


def _socks5_reply(sock: socket.socket, rep: int, bound_host: str = "0.0.0.0", bound_port: int = 0) -> None:
    try:
        sock.sendall(
            b"\x05" + bytes([rep]) + b"\x00\x01"
            + socket.inet_aton(bound_host) + bound_port.to_bytes(2, "big")
        )
    except Exception:
        pass


def _pipe_socket_channel(chan: paramiko.Channel, sock: socket.socket) -> None:
    def pipe_in() -> None:
        try:
            while True:
                data = sock.recv(4096)
                if not data:
                    break
                chan.sendall(data)
        except Exception:
            pass
        finally:
            try:
                chan.close()
            except Exception:
                pass

    def pipe_out() -> None:
        try:
            while True:
                data = chan.recv(4096)
                if not data:
                    break
                sock.sendall(data)
        except Exception:
            pass
        finally:
            try:
                sock.close()
            except Exception:
                pass

    threading.Thread(target=pipe_in, daemon=True).start()
    threading.Thread(target=pipe_out, daemon=True).start()


# ─── Module-level helpers ───────────────────────────────────────────────────

def forward_local(
    session: Session,
    local_host: str,
    local_port: int,
    remote_host: str,
    remote_port: int,
) -> str:
    # The forward is registered through Session.add_forward which assigns the
    # canonical id; we attach that id back onto the instance so the host
    # sees a single source of truth.
    fwd = LocalForward(session, _new_forward_id(), local_host, local_port, remote_host, remote_port)
    fwd.start()
    fwd.forward_id = session.add_forward(fwd)
    return fwd.forward_id


def forward_remote(
    session: Session,
    remote_port: int,
    local_host: str,
    local_port: int,
) -> str:
    fwd = RemoteForward(session, _new_forward_id(), remote_port, local_host, local_port)
    fwd.start()
    fwd.forward_id = session.add_forward(fwd)
    return fwd.forward_id


def forward_dynamic(session: Session, local_host: str, local_port: int) -> str:
    fwd = DynamicForward(session, _new_forward_id(), local_host, local_port)
    fwd.start()
    fwd.forward_id = session.add_forward(fwd)
    return fwd.forward_id


def cancel_forward(session: Session, forward_id: str) -> None:
    fwd = session.get_forward(forward_id)
    if fwd is None:
        raise RpcError(UNKNOWN_FORWARD, f"Unknown forward: {forward_id!r}")
    fwd.close()
    session.remove_forward(forward_id)
"""aftc_ssh_carrier - AFTC-owned JSON-RPC SSH sidecar.

A long-running daemon that:
- Speaks JSON-RPC over stdin/stdout (line-delimited JSON).
- Manages multiple concurrent SSH sessions via paramiko.
- Handles exec, SFTP, interactive editors, port forwarding and env.
- Keeps running when a single connection dies - the AFTC contract
  documented at documentation.md requires "one connection loss closes
  only that connection". The host detects EOF and respawns only when
  no sessions remain.
- Designed to be spawned on-demand by the AFTC TypeScript host via
  ProcessController (kind="ssh").

Lifecycle (from the host's perspective):
1. Host spawns `<venv>/.../python -m aftc_ssh_carrier`.
2. Daemon writes `{"ready": true, "version": ..., "pid": ...}` to stdout.
3. Host sends JSON-RPC requests (one per line) on stdin.
4. Daemon writes JSON-RPC responses (one per line) on stdout.
5. On `shutdown` method, EOF on stdin, SIGTERM/SIGINT or fatal protocol
   error, the daemon exits cleanly (code 0).
6. On a single SSH connection loss the daemon emits a `session_lost`
   notification and continues serving other sessions.

See README.md for the full JSON-RPC method list and capability surface.
"""

__version__ = "0.1.0"

__all__ = ["__version__"]
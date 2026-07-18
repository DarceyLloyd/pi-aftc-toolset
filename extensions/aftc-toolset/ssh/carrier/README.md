# AFTC SSH carrier

`aftc_ssh_carrier` is the packaged, uv-locked Python process used by the SSH extension. It provides multiple SSH sessions through line-delimited JSON-RPC over local standard input and output.

It opens no local HTTP service or listening socket.

`run` accepts optional `stdinText` only as UTF-8 text up to 64 KiB. The
TypeScript model tool exposes the same bound and documents that it is never a
credential channel.

Command standard output and standard error are individually capped at 256 KiB;
the response reports `truncated: true` when either stream exceeds that bound.

SFTP upload and download accept regular files or directory trees. Symlinks are
never followed or recreated; empty directories and binary files are supported.
Every SFTP operation holds a per-session lock for its whole duration because
paramiko's synchronous response reader is unsafe for concurrent threads
sharing one SFTPClient; `cancel_transfer` never takes that lock.
Transfers run in fixed chunks so a concurrent `cancel_transfer` RPC (with the
transfer's opaque id) can abort a large transfer; the temporary file is removed
on cancellation or failure, then the destination is replaced atomically where
the filesystem supports it. While a transfer is in flight the carrier emits
`transfer_progress` notifications (opaque transfer id, bytes, total) that the
host can surface as live progress. An opt-in `preserve` flag restores remote mtime/atime
and permission bits on upload, and local mtime/atime (plus permission bits on
POSIX hosts) on download; it is off by default.

## Runtime

The TypeScript host starts this package with:

```text
uv run --locked --project <carrier-dir> python -m aftc_ssh_carrier
```

It uses `uv.exe` on Windows and `uv` on Linux and macOS. The host starts the process with argument arrays and no shell.

### Prerequisites and recovery

The carrier needs Python 3 and uv. Run `/aftc-install` from the toolset to install and verify them. It probes for a Python 3 interpreter (`py`/`python` on Windows, `python3`/`python` elsewhere) and reports platform-specific recovery guidance when Node, Python, or uv is missing, without exposing saved connection data.

## Protocol

One JSON object is sent per line:

```text
host -> carrier: {"id":1,"method":"connect","params":{...}}
carrier -> host: {"id":1,"result":{"sessionId":"..."}}
carrier -> host: {"id":1,"error":{"code":-32602,"message":"..."}}
carrier -> host: {"notify":"session_lost","sessionId":"..."}
```

The carrier emits one ready frame at startup. The host shuts it down with the `shutdown` method or by closing standard input.

## Lifecycle and idle self-exit

The daemon exits cleanly (code 0) on the `shutdown` method, SIGTERM/SIGINT,
stdin EOF (host pipe closed), or the idle watchdog. The idle watchdog is a
TS-independent backstop: when stdin has been quiet longer than the timeout AND
there are no active sessions, shells, forwards, or in-flight transfers, the
daemon sets its shutdown reason to `idle` and tears down through the same path
as stdin EOF. It covers a wedged or killed host that the TypeScript-side
reaper cannot reach.

The timeout defaults to 600 seconds (10 minutes) and is read once at startup
from `AFTC_SSH_IDLE_TIMEOUT_SEC`. Tests pass a short value (for example 15) so
production never has to be edited back and forth; the production default stays
600 regardless of any test run. A non-positive value disables the watchdog.

## Capabilities

- SSH connections and non-interactive commands
- SFTP transfer and remote file operations
- Interactive PTY shells with a bounded retained-output buffer and truncation metadata
- In-memory connection-loss notifications
- Local (-L), remote (-R), and dynamic SOCKS5 (-D) forwarding

All three forwarding modes are exercised end-to-end by the Docker fixture test (an HTTP request through each tunnel, `cancel_forward`, and cleanup). Dynamic SOCKS5 negotiates RFC 1928 no-auth CONNECT and supports IPv4, domain, and IPv6 destinations. Forwarding remains unavailable through extension commands and tools until the local-user authorization surface is added; the carrier API is ready.

## Security

- Connection credentials arrive only in a one-time `connect` request.
- Passwords and private-key passphrases are removed from the session object after authentication.
- Host keys are not written to disk by the carrier.
- Carrier error frames use generic messages while preserving only their error codes for the TypeScript host.
- The TypeScript host redacts and bounds all carrier-facing output before it reaches Pi.

## Installation

```text
uv sync --locked
```

## Tests

```text
uv run --locked pytest tests/
```

The daemon, key, and connection-monitor tests do not require an SSH server. Run the toolset Docker smoke test from the package root:

```text
node tests/ssh-replacement/ssh-replacement.mjs
```

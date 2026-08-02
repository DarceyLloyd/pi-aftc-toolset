# SSH Feature — Technical Documentation

Connect to remote machines over SSH from inside pi. Run commands, open
interactive shells (Nano, Vi, htop, tmux), transfer files, manage remote files.
Runs a packaged Paramiko carrier as a local process communicating via JSON-RPC
over stdin/stdout. No listening sockets, no HTTP, no GUI bridge.

---

## Architecture

```
extensions/aftc-toolset/ssh/
├── index.ts                    # Registers commands + model tools; owns session manager
├── session.ts                  # In-memory session manager; proxies to carrier
├── carrier.ts                  # Starts/stops the Python carrier; JSON-RPC client
├── connection-store.ts         # Persists saved connection metadata (ssh.json)
├── connection-form.ts          # Collects local-only connection/credential input
├── connection-form-overlay.ts  # Maps form onto AFTC UI (showForm/showMenu)
├── confirmation-overlay.ts     # Destructive-action confirms (showConfirm wrapper)
├── picker.ts                   # Connection/session pickers (showMenu)
├── redaction.ts                # Removes connection metadata from output
├── terminal-overlay.ts         # Full-screen interactive terminal (/ssh-shell)
├── connection-manager/         # /ssh-cm full-screen manager + new-connection dialog
└── carrier/                    # Packaged Python Paramiko carrier (uv-locked)
```

---

## Security Model (BINDING)

**The AI model NEVER sees connection details.** This is the core design principle.

- Model tools receive opaque session/shell ids only.
- No host, user, port, password, key path, passphrase, or fingerprint ever
  reaches model-visible context.
- The model can connect/reconnect by saved name and disconnect by opaque id.
  It CANNOT create, edit, or delete connections.
- Credentials are held in memory for ONE connection attempt, then cleared.
- All output is bounded and redacted before reaching the model.
- Remote writes/mkdir/remove from model tools require local-user confirmation.
- Saved passwords (optional, user-approved) are covered by the redaction layer.

---

## Carrier Lifecycle

The carrier is a Python process (Paramiko) managed by `carrier.ts`:

```
idle → (first use) → ready → (last session disconnects) → idle
                  → (crash) → terminated → (explicit reset) → idle
```

- **Lazy start:** spawns on first SSH use, never in the factory.
- **Self-cleaning:** when last session disconnects, a 30s grace timer stops it.
- **Crash safety:** on unexpected exit, enters `terminated` state, rejects all
  requests. Never silently restarts. Caller must `reset()` before reconnecting.
- **Orphan prevention:** child self-exits on stdin EOF (pi crash). Idle watchdog
  (10min default, `AFTC_SSH_IDLE_TIMEOUT_SEC` override) is the last resort.
- **Spawn:** `node:child_process` argument arrays, no shell. `uv.exe` on Windows,
  `uv` elsewhere. Runs `uv sync --locked` against the packaged carrier.

---

## Session Management (`session.ts`)

- Maps carrier session ids to user-visible saved connection names.
- Tracks the selected session for local commands (`/ssh-shell`, transfers).
- Proxies commands, PTY, transfers, and file ops to the carrier.
- Returns bounded results with separate stdout/stderr/exit-code/truncation.
- Clears credentials after each auth attempt (including host-key approval retry).
- On carrier termination: clears ALL active sessions (no stale state).
- `getStatus()` returns `{ connected, carrierState, sessions }` — single source
  for `/ssh-status` and `ssh_status`.

---

## Commands

| Command | Action |
| --- | --- |
| `/ssh-cm` | Full-screen connection manager (add/edit/delete) |
| `/ssh-connections` | List saved connection names |
| `/ssh-connect [name]` | Connect to a saved connection |
| `/ssh-auto-accept-session-on/off` | Toggle auto-approve for NEW host keys |
| `/ssh-status` | Show connected/not-connected |
| `/ssh-select [id]` | Choose active session for local commands |
| `/ssh-shell` | Full-screen interactive terminal (Ctrl+] to exit) |
| `/ssh-close-shell <id>` | Close an interactive shell |
| `/ssh-interrupt <id>` | Send Ctrl+C/Ctrl+D to a shell |
| `/ssh-upload <local> <remote>` | Upload file (`--preserve` keeps attrs) |
| `/ssh-download <remote> <local>` | Download file (`--preserve` keeps attrs) |
| `/ssh-rename <from> <to>` | Rename remote path (confirmed) |
| `/ssh-disconnect [id]` | Disconnect a session |
| `/ssh-help` | Show workflow reference |

---

## Model Tools

**Connection surface (the ONLY connection-level tools):**
- `ssh_status` — show connected/not-connected + session list
- `ssh_connect(name)` — connect/reconnect a saved server by name (idempotent)
- `ssh_disconnect(id)` — close by opaque id

**Command execution:**
- `ssh_run(id, command, stdinText?)` — non-interactive command with bounded stdin

**Interactive shells:**
- `ssh_open_shell(id)` — open PTY shell, returns shell id
- `ssh_send_keys(id, shellId, keys[])` — send text/named keys
- `ssh_paste(id, shellId, text)` — paste text
- `ssh_resize(id, shellId, cols, rows)` — resize terminal
- `ssh_peek(id, shellId)` — read bounded output
- `ssh_interrupt(id, shellId)` — send Ctrl+C/Ctrl+D
- `ssh_close(id, shellId)` — close shell

**File operations (destructive ones require local confirmation):**
- `ssh_upload`, `ssh_download` — transfers with overwrite approval
- `ssh_list_dir`, `ssh_stat`, `ssh_read_file` — inspection
- `ssh_write_file`, `ssh_mkdir`, `ssh_rename`, `ssh_remove` — mutation (confirmed)

Every tool: has `promptSnippet`, names itself in `promptGuidelines`, truncates
output, strips leading `@` from paths, throws on error.

---

## Connection Store (`ssh.json`)

Saved in the persistent OS data dir. Contains ONLY non-secret metadata:
name, username, host, port, timeout, optional key path, optional saved password.
Never shipped. Never exposed to the model. Managed exclusively through `/ssh-cm`.

---

## Redaction (`redaction.ts`)

Registers active connection metadata (host, user, port, paths) as redaction
values. All command output, file content, and carrier errors pass through
redaction before reaching the model or TUI display. The boundary survives
connection rename/removal and is cleared on disconnect.

### Tradeoff: verbatim substring matching

The redaction layer matches the saved connection metadata VERBATIM
(case-sensitive exact substring). This is a deliberate safety-first
choice: a substring that happens to be a common English word (e.g.
a username `admin`, a host `mail`) will be redacted EVERYWHERE it
appears in the carrier output. A remote command that prints
"administrator" will be mangled to `[redacted]istrator`; a `cat /etc/hosts`
listing that mentions `mail` alongside the real `mail` host will have
that entry redacted.

If this is a problem in practice, the saved metadata can be made
unique (e.g. username `admin_user`, host `mail-prod-01`) at the cost
of memorability. The redaction is a guard, not a parser — it errs
on the side of over-redaction.

---

## Tests

SSH has extensive test coverage. Key tests:
- `ssh-module-check` — module loads and registers correctly
- `ssh-carrier-check` / `ssh-carrier-ready-check` / `ssh-carrier-lifecycle-check` — carrier lifecycle
- `ssh-redaction-check` — redaction correctness
- `ssh-connection-form-check` / `ssh-connection-form-overlay-check` — form validation
- `ssh-confirmation-overlay-check` — confirm dialogs
- `ssh-replacement` — Docker-based end-to-end (commands, SFTP, forwarding, PTY)
- `pi-linux-ssh-verify` — two-container Linux verification (no provider allowance)
- `ssh-idle-self-exit-check` / `ssh-idle-connection-lost-check` — cleanup behaviour

All tests have mandatory timeouts (see AGENTS.md test rules).

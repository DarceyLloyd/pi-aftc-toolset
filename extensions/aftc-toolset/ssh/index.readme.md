# index.ts

SSH feature module registered by the toolset orchestrator.

## Responsibilities

- Registers local SSH commands and model tools.
- Keeps the session manager in this module closure.
- Requires the local user to authorize a connection before model tools use it.
- Clears active SSH resources during Pi session shutdown.

## Credential boundary

- `/ssh-connect` collects a password only for the current connection attempt.
- Creating a connection with an existing saved name requires local replacement confirmation.
- Saved connection records may hold an optional user-approved local-only
  password; it is never exposed to model tools or rendered status and is
  always covered by the redaction layer.
- `ssh_connect(<name>)` connects or reconnects a saved server by name. It is
  idempotent (returns the existing opaque id if already connected) and collects
  credentials through the same local overlay as `/ssh-connect`; it never
  accepts host, user, port, password, key path, or passphrase and never creates,
  edits, or deletes a connection. It throws for an unknown name and fails
  safely in headless mode.
- `ssh_disconnect(<id>)` closes a session by opaque id; a stale or repeated id
  throws a model-friendly not-connected error.
- Other model tools require an opaque active-session id and continue to use the
  active session after its saved record is renamed or removed.
- Remote writes, directory creation, and removal from model tools require a
  local confirmation dialog.
- Local command dialogs redact active connection metadata from remote directory
  listings, metadata, and file content before rendering.

## Session lifecycle and status

- `getStatus()` is the single source for `/ssh-status` and `ssh_status`; it
  returns `{ connected, carrierState, sessions }`. The model tool formats it
  with `formatSshStatus()` (`Connected` + session list, or
  `Not connected - <reason>`); the `/ssh-status` command shows a one-line
  warning notification (`SSH Status: Connected to <names>` /
  `SSH Status: Not connected`), not a modal.
- The carrier lazy-starts on first use. When the last session disconnects or is
  lost, a short TS-side reaper grace window stops it; a pi crash closes the
  pipe and the sidecar self-exits on stdin EOF; a TS-independent idle watchdog
  (10-minute default, `AFTC_SSH_IDLE_TIMEOUT_SEC` override) is the last-resort
  backstop. The next connect resets a terminated carrier and relaunches it.

## Model tools

- Connection surface: `ssh_status`, `ssh_connect` (connect/reconnect by saved
  name), and `ssh_disconnect` (close by opaque id). These are the only
  connection-level model tools; none can create, edit, or delete a connection.
- Session commands with bounded optional standard input, PTY input, transfers,
  directory listing, file reads, and file metadata.
- Remote file writes, directory creation, and removal are confirmation-gated.
- Every tool carries a `promptSnippet`, names its tool in its `promptGuidelines`,
  adopts Pi's `truncateHead`/`truncateTail` with a local full-output file, strips
  a leading `@` from paths, and throws on error.

## Commands

- `/ssh-connection-manager` (alias `/ssh-cm`) — full-screen manager for
  saved connections: add, edit (rename included), and delete from the
  bottom options row.
- `/ssh-connections`
- `/ssh-connect [connection-name]`
- `/ssh-auto-accept-session-on` / `/ssh-auto-accept-session-off` — toggle
  the saved preference that auto-approves NEW host keys (changed keys are
  still rejected regardless).
- `/ssh-status`
- `/ssh-select [session-id]`
- `/ssh-disconnect [session-id]`
- `/ssh-shell`
- `/ssh-close-shell <shell-id>`
- `/ssh-interrupt <shell-id>`
- `/ssh-help`
- `/ssh-upload <local-path> <remote-path>`
- `/ssh-download <remote-path> <local-path>`
- `/ssh-rename <source-path> <destination-path>`

Local transfer commands support quoted paths and confirm before they replace an existing target. `/ssh-shell` opens a full-screen interactive terminal takeover in TUI mode (virtual screen: `ui/terminal-screen.ts`). Ctrl+] closes the terminal locally without forwarding the chord to the remote host.

Connection add/edit/delete lives in the connection manager only — the old
`/ssh-edit-connection`, `/ssh-rename-connection`, and `/ssh-forget` commands
were retired into it. Remote file work, non-interactive commands, and port
forwarding have no user commands; the model tools cover file work and
commands, and forwarding is not currently exposed (the carrier capability
remains tested).

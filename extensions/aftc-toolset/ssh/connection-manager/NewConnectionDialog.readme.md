# NewConnectionDialog.ts

New-connection flow for the SSH connection manager's "Add new
connection" option. The dialog itself is a thin wrapper over the AFTC UI
suite's `showForm()` — a GRUB-style full-screen takeover with the
toolkit's active-field contract (accent `❯` label, boxed input with
accent borders on a full-width dark-orange selection bar, the only
typing cursor on screen; inactive fields show plain accent values inside
`#555555` borders).

## Exports

- `NewConnectionValues` — validated result shape (name, username, host,
  port, connectTimeoutMs, optional identityFile, optional password).
- `showNewConnectionDialog(ctx, initial?)` — opens the form; resolves
  with validated values or null on cancel. TUI-only.
- `runNewConnectionFlow(ctx)` — dialog + confirms + save + notify.
  Returns the saved `SshConnection`, or null when cancelled.

## Contract

- Seven fields: connection name, username, host (all `required`), port
  (`int`, 1–65535, empty → 22), timeout seconds (`int`, 1–300, empty →
  30), private-key path (optional), password (optional). The bottom
  action is `[ SAVE CONNECTION ]`.
- Tab / Shift+Tab cycle focus (wrapping) through the fields and the
  action. Enter inside a field advances focus; Enter on SAVE validates.
  Escape cancels (resolves null).
- Validation runs in `AftcForm`: required fields report
  `A <field> is required.`; numeric fields report range errors; focus
  jumps to the offending field and the dialog stays open.
- Password is collected verbatim (whitespace preserved) and masked with
  bullets in the form (the `password` field type); only a completely
  empty field counts as "no password". It is saved with the connection
  (user-approved design; local-only ssh.json) and covered by the
  redaction layer.
- Empty password flow in `runNewConnectionFlow`: a Yes/No modal
  (`confirmOverlay` with title "You didn't enter a password?", body
  "Are you sure?", arrows + Enter). Only Yes proceeds to save; No
  re-opens the dialog with the entered values preserved (except the
  password field, which was empty by definition).
- A name collision triggers the replace-saved-connection confirm before
  saving; declining re-opens the dialog.

## Privacy

- The saved password lives only in the local ssh.json store and in the
  in-memory connection object. It is never logged, rendered, or exposed
  to model tools; `redactSshText` strips it from any text leaving the
  SSH module.

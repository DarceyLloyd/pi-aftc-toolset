# ConnectionManager.ts

Full-screen SSH connection manager opened via `/ssh-connection-manager`
(alias `/ssh-cm`). Both commands are registered by `createConnectionManager(pi)`
at the bottom of the file and wired into pi by the SSH module
(`ssh/index.ts`).

## Exports

- `ConnectionManagerScreen` — the full-screen component class
  (`Component + Focusable`).
- `openConnectionManager(ctx)` — TUI guard + `ctx.ui.custom(...)` call.
  Resolves when the user exits. Notifies and no-ops outside the TUI.
- `createConnectionManager(pi)` — registers `/ssh-connection-manager`
  and `/ssh-cm` (two-registration alias pattern, matching stfu.ts).

## Contract

- Opens as a GRUB-style full-screen takeover built on the shared AFTC UI
  toolkit (`ui/aftcUi.ts`): `overlay: true` at 100% width / height,
  every terminal cell painted black, a centred `#555555`-bordered panel,
  `#fca02f` accents, and a dark-orange selection bar on the active row.
  Escape (or Ctrl+C) closes it via `done()` and the pi prompt is
  restored. Plain `ctx.ui.custom()` without `overlay: true` only
  replaces the input editor — that mode is deliberately not used.
- Lists every saved connection from the connection store. Each row shows
  the saved name and a `username@host[:port]` description; no password,
  key path, or fingerprint is ever emitted.
- Exactly one element looks active at a time: the focused list row or
  the focused bottom-row option carries the full-width selection bar;
  the other renders plain.
- Tab / Shift+Tab cycles focus. With connections: list <-> options row.
  Without connections: options row <-> nothing (Tab de-selects the
  option). The list highlight only shows while the list owns focus.
- Arrow keys navigate the list; PageUp/PageDown jump by the visible
  viewport; Home/End jump to edges. Up-arrow wraps at the top, Down-arrow
  wraps at the bottom (matches `/cd` behaviour); PageUp/PageDown clamp.
- The bottom options row holds "[ Add new connection ]", "[ Edit ]",
  and "[ Delete ]" (Edit/Delete only appear when a connection exists).
  Left/Right moves the focused option; Enter activates it. Enter on a
  list row is intentionally NOT handled — actions go through the row.
  The screen reports WHAT was chosen (`{ kind: "add" | "edit" | "delete"
  | "cancelled" }`); `openConnectionManager` owns the follow-up and then
  re-opens a freshly-built manager:
  - add: the manager's own new-connection dialog (NewConnectionDialog.ts:
    Tab-cycled fields + SAVE CONNECTION action, inline validation,
    empty-password Yes/No confirm, name-collision confirm) → save.
  - edit: the shared edit screen (`editConnectionSettings` in
    connection-form.ts) pre-filled with the selected record → save. A
    saved password is preserved (the edit screen never collects one);
    renaming through the name field removes the old record, with a
    replace confirm on a name collision.
  - delete: an Are-you-sure confirm (safe option highlighted by default)
    → remove the saved record. A live session started from the deleted
    record is left running; the manager edits saved records, not
    sessions.
- First row is highlighted on open. The viewport scrolls when the list
  exceeds the visible cap: `min(MAX_VISIBLE_ROWS (20), terminalRows -
  CHROME_LINES)` so the panel never overflows short terminals.
- Empty state renders a hint pointing at the Add option.

## Privacy

- Only reads `getSshConnections()` (non-secret metadata).
- No credentials are read, written, or logged.

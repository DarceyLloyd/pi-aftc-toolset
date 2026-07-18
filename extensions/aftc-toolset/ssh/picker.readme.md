# picker.ts

Overlay selector for local SSH connection records.

## Responsibilities

- Lists saved connection names only (connect-only; creating connections lives in the manager, `/ssh-cm`).
- Lists active sessions using saved names and opaque ids only.
- Keeps endpoint and authentication fields out of picker rows.
- Both pickers run on the AFTC UI toolkit's `showMenu()` — a GRUB-style
  full-screen takeover with /cd-style navigation (arrows wrap,
  PgUp/PgDn page, Home/End jump to edges, Enter select, Esc cancel).

## Public API

- `pickConnection(ctx)` returns a local saved record, `"new"`, or `null`.
- `pickSession(ctx, sessions)` returns a selected opaque session id or `null`.

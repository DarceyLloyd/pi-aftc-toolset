# connection-store.ts

Local persistent storage for named SSH connection settings.

## Storage

- Records are stored at `.pi-aftc-toolset/data/ssh.json`.
- Each record contains its display name, username, host, optional port, optional timeout, optional private-key path, and an optional saved password.
- The file also holds one preference: `ssh_session_auto_accept` (default
  false). When true, NEW host keys are trusted without the local approval
  dialog; changed keys are still rejected. Toggled by
  `/ssh-auto-accept-session-on` and `/ssh-auto-accept-session-off`.
  Files written before this preference existed are migrated on first read:
  the entry is added, defaulting to false.
- Saved passwords are an explicit user-approved design decision (see connection-manager/NewConnectionDialog.readme.md). They are local-only: never logged, rendered, or exposed to model tools, and always covered by the redaction layer.
- Private-key passphrases, host-key decisions, active session ids, terminal output, and transfer history are never persisted.
- On read, unknown fields written by older versions are removed immediately.
- Writes use a temporary file and rename so a failed write does not leave partial JSON.

## Public API

- `getSshConnections()` returns copied records for local SSH code.
- `findSshConnection(name)` returns one copied record.
- `saveSshConnection(connection)` adds or replaces a record by name.
- `removeSshConnection(name)` removes one record.
- `getSshSessionAutoAccept()` reads the new-host-key auto-accept preference.
- `setSshSessionAutoAccept(value)` persists it.

## Security

Only local SSH modules may read this store. Model tools and rendered SSH status expose connection names and opaque session ids, never endpoint or credential fields.

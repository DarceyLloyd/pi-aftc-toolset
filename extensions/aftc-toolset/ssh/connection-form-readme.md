# connection-form.ts

Local connection input helpers used only by the SSH command flow.

## Public API

- `createSavedConnectionRequest(ctx, connection)` collects fresh credentials for a saved connection.
- `editConnectionSettings(ctx, connection)` edits non-secret local connection settings without requesting credentials. Used by the connection manager's [ Edit ] action; the manager preserves any saved password and handles renames (old record removed, collision confirmed) around it.

New connections are created only by the connection manager (`/ssh-cm`), not
through `/ssh-connect`.

## Data handling

- Connection records contain the local display name, username, host, optional port, timeout, and private-key path.
- Passwords and private-key passphrases exist only in `SshConnectRequest.credentials` for one connection attempt.
- Saved connections always prompt for their authentication value again.
- Credentials are never written to `ssh.json`, `state.json`, session history, logs, or rendered output.
- Passwords and passphrases preserve their exact input values, including leading or trailing whitespace.

The TUI form (`connection-form-overlay.ts`) runs on the AFTC UI suite:
`connectionFormOverlay` maps to `showForm()` (auth method as a choice
field) and `authMethodOverlay` maps to `showMenu()`. Outside the TUI
both fall back to the per-field prompts in this module.

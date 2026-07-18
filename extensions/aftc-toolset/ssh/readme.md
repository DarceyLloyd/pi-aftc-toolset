# SSH module

This folder contains the local SSH feature used by the toolset extension.

## Module layout

- `index.ts` registers SSH commands and model tools.
- `connection-form.ts` collects local-only connection and credential input.
- `connection-form-overlay.ts` maps the new / edit connection form onto
  the AFTC UI suite (`showForm` with the auth method as a choice field;
  `showMenu` for the standalone auth-method pick). Outside the TUI both
  fall back to the per-field prompts in `connection-form.ts`.
- `confirmation-overlay.ts` provides `confirmOverlay()` for every destructive
  SSH prompt — a thin wrapper over the AFTC UI suite's `showConfirm()`
  (GRUB-style takeover, safe option highlighted by default, non-TUI
  fallback to `ctx.ui.confirm`).
- `connection-store.ts` persists non-secret saved connection metadata.
- `picker.ts` provides connection and active-session pickers on the AFTC
  UI suite's `showMenu()`.
- `session.ts` manages in-memory active sessions and carrier requests.
- `carrier.ts` starts the packaged local stdio carrier.
- `terminal-overlay.ts` provides the full-screen interactive terminal
  takeover used by `/ssh-shell` (virtual screen: `ui/terminal-screen.ts`).
- `connection-manager/` contains the full-screen connection manager
  (`/ssh-connection-manager`, alias `/ssh-cm`) and its new-connection
  dialog.
- `redaction.ts` removes connection metadata from output.
- `carrier/` contains the uv-locked Paramiko carrier source.

Each TypeScript module has a sibling companion README with its contract.

## Validation

Run the focused SSH checks from the package root:

```powershell
node tests/install-check/install-check.mjs
node tests/install-platform-uv-check/install-platform-uv-check.mjs
node tests/ssh-redaction-check/ssh-redaction-check.mjs
node tests/ssh-confirmation-overlay-check/ssh-confirmation-overlay-check.mjs
node tests/ssh-connection-form-overlay-check/ssh-connection-form-overlay-check.mjs
node tests/ssh-connection-form-check/ssh-connection-form-check.mjs
node tests/aftc-ui-check/aftc-ui-check.mjs
node tests/ssh-new-connection-dialog-check/ssh-new-connection-dialog-check.mjs
node tests/ssh-module-check/ssh-module-check.mjs
node tests/ssh-status-reaper-check/ssh-status-reaper-check.mjs
node tests/ssh-connect-headless-check/ssh-connect-headless-check.mjs
node tests/ssh-carrier-check/ssh-carrier-check.mjs
node tests/ssh-carrier-ready-check/ssh-carrier-ready-check.mjs
node tests/ssh-carrier-lifecycle-check/ssh-carrier-lifecycle-check.mjs
node tests/ssh-local-path-check/ssh-local-path-check.mjs
node tests/ssh-idle-self-exit-check/ssh-idle-self-exit-check.mjs
node tests/ssh-idle-connection-lost-check/ssh-idle-connection-lost-check.mjs
node tests/ssh-nano-keys-check/ssh-nano-keys-check.mjs
node tests/ssh-terminal-screen-check/ssh-terminal-screen-check.mjs
node tests/ssh-replacement/ssh-replacement.mjs
node tests/npm-package-check/npm-package-check.mjs
node tests/allowance-check/allowance-check.mjs
```

The Docker SSH fixture test covers commands, SFTP, local forwarding, and PTY behavior with disposable credentials.

## Linux Pi integration

Run the disposable Linux Pi integration check with:

```powershell
node tests/pi-linux-integration/pi-linux-integration.mjs
```

The container runs Pi as user `pi`. Its global configuration directory is
`/home/pi/.pi/agent/`, and the copied package path is
`/opt/pi-aftc-toolset`.

The check transiently copies the local Pi `auth.json`, invokes Pi's
`/aftc-install` slash command, verifies `/ssh-status`, runs one live prompt,
and removes the container with its credentials. The prompt consumes provider
allowance.

For SSH-focused Linux verification without a live prompt, run the dedicated
two-container check (pi-client + ssh-target on one network):

```powershell
node tests/pi-linux-ssh-verify/pi-linux-ssh-verify.mjs
```

It runs `/aftc-install`, the non-Docker SSH unit tests, the carrier `pytest`,
and the end-to-end tests with the client's carrier connecting to the
`ssh-target` service, then tears both containers down. No provider allowance is
consumed.

## Package validation

`npm-package-check` verifies that the published package includes carrier source
and lock files while excluding credentials, saved connections, retired code,
caches, and virtual environments.

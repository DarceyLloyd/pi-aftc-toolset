# tests/

One folder per check: `tests/<test-name>/<test-name>.mjs` plus its own
README and any fixtures/helpers. Every script registers a global
watchdog timeout near the top (see `.dev/dev_guide.md` — non-negotiable).

## How they are built

- Plain Node.js ESM scripts; no test framework, no network, no TUI.
- Extension TypeScript is loaded through the same `jiti` runtime pi
  uses, resolved from the global `@earendil-works/pi-coding-agent`
  install (`PI_CODING_AGENT_PATH` overrides the location).
- Pi APIs are exercised through mock `ExtensionAPI` / `ctx` objects;
  overlay components are driven headlessly via their `handleInput`.
- Tests resolve paths from the script location, never `process.cwd()`.
- Local Node checks (15s–30s watchdogs) need no Docker; the SSH
  end-to-end checks use a disposable Docker fixture; the Linux gates
  use Docker Compose.

## The suites

| Suite | Class | Covers |
| --- | --- | --- |
| `allowance-check` | 15s local | Footer line-5 allowance providers, Codex regression. |
| `install-check` | 15s local | `/aftc-install` redaction, recovery guidance, concurrency, and the intelligent session-start dependency warning. |
| `install-platform-uv-check` | 15s local | Platform-native uv resolution. |
| `npm-package-check` | 15s local | Published package contents (carrier source included; credentials/venv excluded). |
| `ssh-carrier-check` | 60s local | Carrier ready handshake, terminated state, redaction. |
| `ssh-carrier-lifecycle-check` | 30s local (fake carrier) | Protocol, lifecycle, timeout, cancellation, crash, process-tree. |
| `ssh-carrier-ready-check` | 60s local | Installed carrier ready handshake end-to-end. |
| `ssh-confirmation-overlay-check` | 30s local | `confirmOverlay` two-button semantics. |
| `ssh-connect-headless-check` | 30s local | `ssh_connect` fails safely headless; unknown names throw. |
| `ssh-connection-form-check` | 30s local | Credential whitespace preservation. |
| `ssh-connection-form-overlay-check` | 30s local | Connection form overlay fields/validation. |
| `ssh-module-check` | 30s local | Command/tool registration, redaction, safe errors, destructive approvals. |
| `ssh-auto-accept-check` | 30s local | Auto-accept store persistence + host-key dialog skip/refuse flow. |
| `ssh-new-connection-dialog-check` | 30s local | Connection manager dialog: focus cycle, validation, password preservation, empty-password confirm, save flow (store restored after). |
| `ssh-redaction-check` | 30s local | Redaction of connection metadata and secrets. |
| `ssh-status-reaper-check` | 30s local (fake carrier) | Status surface, zero-sessions reaper, model boundary, prompt compliance. |
| `ssh-local-path-check` | Docker | Upload/download path handling. |
| `ssh-idle-self-exit-check` | Docker | Sidecar idle self-exit + reconnect. |
| `ssh-idle-connection-lost-check` | Docker | Monitor prunes a dropped session; idle exit. |
| `ssh-nano-keys-check` | Docker | Drives nano through the PTY shell tools. |
| `ssh-terminal-screen-check` | 20s local | VT100 virtual screen: SGR colours, cursor addressing, erase, scroll, alt-screen, split sequences. |
| `ssh-replacement` | Docker (600s) | Commands, SFTP, forwarding, PTY against a disposable SSH fixture. |
| `pi-linux-ssh-verify` | Docker Compose (1500s) | Full Linux gate: `/aftc-install`, unit suites, carrier pytest, client→target end-to-end. No provider allowance consumed. |
| `pi-linux-integration` | Docker Compose (1500s) | Live-prompt Linux integration. Consumes provider allowance; copies local `auth.json` transiently. |

Run any suite directly, e.g.:

```powershell
node tests/ssh-module-check/ssh-module-check.mjs
```

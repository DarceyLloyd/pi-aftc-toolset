# tests/

One folder per check: `tests/<test-name>/<test-name>.mjs` plus its own
README and any fixtures/helpers. Every script registers a global
watchdog timeout near the top (see `AGENTS.md` — non-negotiable).

## Philosophy

- Not everything can be tested: TUI visuals, live provider behaviour,
  and pi's own rendering are verified manually by the user, not by
  automation. Some modules have no test folder — that is deliberate,
  not a gap.
- Every test must VERIFY behaviour. When touching a test, ask: does
  this actually assert something meaningful? A test that only exercises
  code without checking outcomes (coverage theatre) should be pruned,
  not kept.

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
| `help-registry-check` | 20s local | Help registry sync: every registerCommand covered by an entry, every entry real, no duplicates. |
| `allowance-check` | 15s local | Footer line-5 allowance providers, Codex regression. |
| `keys-check` | 20s local | Shortcuts: alt+c clear, alt+n newline at caret. |
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
| `usage-report-check` | 30s local | `/usage-report` tabbed HTML shell, JSON round-trip, client-JS syntax, projection math invariants. |
| `intros-check` | 30s local | Intro factory: WarGames raw ANSI takeover starts on session_start (alt screen), restores pi on shutdown, commandless registration. |
| `qwencloud-check` | 30s local | QwenCloud providers: heuristics, catalog parsing, registration shape, live refresh, offline/env fallbacks, oauth login flow. |
| `pi-linux-ssh-verify` | Docker Compose (1500s) | Full Linux gate: `/aftc-install`, unit suites, carrier pytest, client→target end-to-end. No provider allowance consumed. |
| `pi-linux-integration` | Docker Compose (1500s) | Live-prompt Linux integration. Consumes provider allowance; copies local `auth.json` transiently. |

Run any suite directly, e.g.:

```powershell
node tests/ssh-module-check/ssh-module-check.mjs
```

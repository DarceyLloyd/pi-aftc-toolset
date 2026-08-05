# debug-log.ts — /aftc-debug-log-on, /aftc-debug-log-off

Toggles the `debugLoggingEnabled` preference (config.json, default `false`) —
the gate on `aftcConsole.log()` stdout diagnostics.

## Why

pi echoes extension `console.log` output into the TUI, so every module's
"loaded — …" line (and other routine diagnostics) cluttered the user's console
on startup. The flag keeps the default experience clean while preserving the
diagnostics for when something needs investigating.

## Contract

- `aftcConsole.log(text)` prints ONLY when `debugLoggingEnabled` is true.
  Use it for: load messages, detection/state diagnostics, anything routine.
- Error/warning diagnostics NEVER go through `aftcConsole.log` — keep them on
  raw `console.log("[aftc-toolset] …")` so a real failure is always reported,
  flag or no flag.
- The preference is read fresh from disk on every `log()` call (the standard
  no-cache config rule), so toggling takes effect immediately, no reload.
- Commands: `/aftc-debug-log-on` / `/aftc-debug-log-off` — set the flag and
  report the new state (emphasis line in the TUI, stdout line headless).

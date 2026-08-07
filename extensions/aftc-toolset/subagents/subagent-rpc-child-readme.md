# subagents/subagent-rpc-child.ts — readme

ONE supervised `pi --mode rpc` child process + the custom strict-LF
JSONL reader. The transport the sub-agent supervisor builds its lifecycle
guarantees on (design section 4).

## Why not pi's shipped RpcClient

Verified against `dist/modes/rpc/rpc-client.js`: it writes child
stderr straight to the parent TTY, spawns without `detached` (no
process group, so tree kill is impossible — invariant 6), uses a racy
fixed 100ms readiness sleep, and defaults `cliPath` to the relative
`dist/cli.js` (breaks under bin shims/Bun). We reuse the framing idea
conceptually and own the process model.

## Exports

- `SubAgentJsonLineReader` — strict-LF framing (invariant 11). Splits
  on `\n` BYTES only (Node `readline` is non-compliant — it also splits
  on U+2028/U+2029, valid inside JSON strings), strips one trailing
  `\r` per record (CRLF accepted), and decodes UTF-8 only for complete
  lines so multibyte sequences split across chunk boundaries survive.
  Malformed lines are reported via `onError` and skipped, never fatal.
- `resolvePiEntry()` — spawn entry: prefer the same pi entry script the
  parent uses (`process.argv[1]`) under `process.execPath`; PATH
  fallback (`pi` / `pi.cmd`). Never hardcode `dist/cli.js`.
- `buildSubAgentChildArgs(spec)` — pure argv builder for the controlled
  startup: `--mode rpc`, `--no-extensions` + explicit `-e
  child-runtime.ts`, `--no-prompt-templates --no-themes --no-skills
  --no-approve`, resolved `--model` (+ `--thinking`), `--tools`
  comma-allowlist — `report_result` is ALWAYS appended (the flag
  filters extension tools too), `--skill` paths, `--no-context-files`
  only for `context_files: none`, `--session-dir <run dir>` or
  `--no-session`.
- `killSubAgentProcessTree(pid, force)` — POSIX signals the negative
  pid (the detached process group) with SIGTERM/SIGKILL; Windows uses
  `taskkill /pid <pid> /T [/F]`. Never throws.
- `spawnSubAgentChild(options): SubAgentChild` — detached spawn,
  `windowsHide`, env scrubbed of every `PI_SESSION_*` variable (the
  child can never impersonate the parent session), stdout routed
  through the reader, stderr captured per line (fed to the stall
  watchdog; NEVER echoed to the parent TUI). The handle exposes:
  `pid`, `exited`, `sendCommand`, `request` (id-correlated response
  with timeout — readiness is a real `get_state` request, a SIGNAL,
  never a sleep), `closeStdin` (the graceful ladder rung), `killTree`,
  `dispose`.
- Test seam: `entryOverride` swaps the pi entry for the scripted fake
  child harness.

## Rules this module exists to keep

- Invariant 6: no child tree survives abort/timeout/reload/shutdown —
  the detached group + tree kill make that enforceable.
- Invariant 11: JSONL framing correctness under hostile chunking.
- Invariant 16: a spawn/readiness failure is reported once; the caller
  never retries through a second execution path.

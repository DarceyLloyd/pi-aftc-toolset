# replay.ts

Save-and-replay slash commands. Save a prompt string once with
`/save-replay-prompt`, then re-execute it any time with `/replay`.

## What it does

Registers two slash commands that together let you save a prompt and
re-send it as a fresh user message:

- **`/save-replay-prompt <text>`** — saves `<text>` (everything after
  the command name) to `.pi-aftc-toolset/data/replay.json`. Trims
  surrounding whitespace. Re-saves overwrite the previous value.
  Single-line only — slash-command input is a single args string.
- **`/replay`** — reads the saved prompt and sends it through
  `pi.sendUserMessage(...)`, which triggers a fresh agent turn.
  When the agent is idle the turn fires immediately. When the agent
  is busy (currently streaming or running tools) the prompt is queued
  with `deliverAs: "followUp"` so the in-flight turn is NOT
  interrupted.
- **`/r`** — short alias for `/replay`. Identical behaviour, fewer
  keystrokes. Registered as a separate command so it shows up in
  autocomplete and `/aftc-help` next to `/replay`.

## Why this exists

Many real workflows involve running the same prompt repeatedly:

- Re-running a long-running build/test cycle
- Re-issuing a complex prompt after a context reset
- Re-running a check after fixing a bug
- Repeated `/cache-profile` style diagnostics

Typing it out each time is error-prone. Saving once and replaying is
faster, less mistake-prone, and gives you a chance to confirm what
you are about to send.

## Storage

- File: `.pi-aftc-toolset/data/replay.json`
- Shape: `{ "prompt": string, "savedAt": number }`
- Created on first `/save-replay-prompt` (atomic write, tmp + rename).
- Survives `/reload`, `/new`, session resume, and machine reboot.
- Gitignored — extension-owned runtime state, never committed.
- Separate file from `state.json` (which holds user preferences).
  Different concerns, different lifecycles, easier to clear
  independently.

## Behaviour matrix

| Saved? | Agent state | `/replay` (and `/r`) result |
|---|---|---|
| No  | Idle   | Notification: "No saved replay prompt — use /save-replay-prompt <text> first." (warning) |
| No  | Busy   | Same warning notification |
| Yes | Idle   | `pi.sendUserMessage(prompt)` (immediate new turn) + notify `Replaying: <preview>` |
| Yes | Busy   | `pi.sendUserMessage(prompt, { deliverAs: "followUp" })` + notify `Replaying (queued as follow-up): <preview>` |
| Yes | Headless (RPC / `-p`) | Same send behaviour; logged to stdout with `[aftc-toolset]` prefix (names the actual command fired) instead of notify |

`ctx.hasUI` gates notifications; `console.log` is the headless fallback.

## Why `followUp` while busy, not `steer`

`steer` injects mid-turn and interrupts the current assistant
response — bad for a replay, because the user almost certainly does
not want to lose in-flight work. `followUp` queues the replay until
the current turn finishes. Users who DO want to interrupt first can
hit `/aftc-stop` (or `/stfu`), then `/replay`.

## Why not a keyboard shortcut

The user asked for slash commands explicitly. Slash commands are
discoverable via `/aftc-help`, autocomplete, and survive being typed
in a hurry without the user remembering a chord.

## Why this module exists separately from `core.ts`

Per rules.md §1.4 — one feature per file. The save/replay feature is
an independent user-facing capability with no relationship to cache
diagnostics. It lives in its own file so the orchestrator can wire
it in independently and the per-file contract stays small and
focused.

## Events subscribed

None. The module only registers commands — no `pi.on(...)` handlers,
no shared state, no background resources. The disk file IS the state.

## Public factory

```typescript
export function createReplay(pi: ExtensionAPI): void
```

Returns void — the module is self-contained and stateless. The
orchestrator (`index.ts`) calls this once at startup; the rest of
the lifecycle is per-command-handler invocation.

## Commands registered (3)

- **`/save-replay-prompt <text>`** — save text as a replay prompt.
  Whitespace-trimmed. Empty args are silently rejected with a
  headless log.
- **`/replay`** — re-execute the saved prompt as a fresh user
  message. Falls back to a warning notification when no prompt is
  saved.
- **`/r`** — short alias for `/replay`. Same handler, same
  behaviour. Registered separately so it shows up in autocomplete.

## Failure modes

- **No saved prompt** — handled. `/replay` notifies "No saved replay
  prompt — use /save-replay-prompt <text> first." (warning) in TUI
  mode; logs the same to stdout in headless mode.
- **Empty args to `/save-replay-prompt`** — handled. Trimmed input
  is checked; whitespace-only or missing args log "no text provided"
  and return without touching the file.
- **Corrupt `replay.json`** — handled. `loadReplay` returns `null`
  on any read/parse failure; `/replay` then behaves as if no prompt
  was saved. The user can simply re-save.
- **Disk write failure** — handled. `saveReplay` logs the error and
  returns; the in-memory state is not affected because there is no
  in-memory state. The next `/replay` will still notify "no saved
  prompt" until the user re-tries.
- **`ctx.isIdle` missing on older pi versions** — guarded by
  `ctx.isIdle ? ctx.isIdle() : true`. Falls back to assuming idle,
  which means plain `sendUserMessage` (the simplest path). Older pi
  versions that lack `isIdle` are also unlikely to throw on plain
  send.
- **Headless / RPC mode** — `ctx.hasUI` is `false`. Notifications are
  skipped; both commands log via `console.log` with the `[aftc-toolset]`
  prefix (rules.md §5.10).

## Test

`tests/replay-check/replay-check.cjs` covers:

1. `/save-replay-prompt`, `/replay`, and `/r` all register.
2. Empty args to `/save-replay-prompt` do not write the file.
3. Non-empty args write the file with the trimmed prompt + a
   `savedAt` timestamp.
4. The file persists across a simulated "restart" (re-load).
5. `/replay` (and `/r`) with no saved prompt notifies the user
   (does NOT call `sendUserMessage`).
6. `/replay` (and `/r`) while idle calls `pi.sendUserMessage(prompt)`
   exactly once with no options.
7. `/replay` (and `/r`) while busy calls `pi.sendUserMessage(prompt,
   { deliverAs: "followUp" })`.
8. Headless mode skips `notify` and logs to stdout (names the actual
   command fired: `/replay` vs `/r`).

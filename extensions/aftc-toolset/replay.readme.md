# replay.ts — Save & Replay Prompt

Save a prompt string and re-execute it later as a fresh user message.

## Commands

| Command | What it does |
| --- | --- |
| `/save-replay-prompt <text>` | Save `<text>` as the replay prompt (trims whitespace) |
| `/replay` | Re-send the saved prompt as a fresh user message |
| `/r` | Short alias for `/replay` |

## Storage

The saved prompt is stored in `config.json` as the `replayPrompt` preference
(via `getPreference`/`setPreference`). Persists across /reload, /new, session
resume, and machine reboot.

**Migration:** a one-time migration reads any legacy `replay.json` (the old
storage location), copies the value to `config.json`, and deletes the file.

## Behaviour matrix

| State | `/replay` or `/r` |
| --- | --- |
| No saved prompt | Warning notification (or headless log) |
| Saved prompt + agent idle | `pi.sendUserMessage(prompt)` — fires a new turn immediately |
| Saved prompt + agent busy | `pi.sendUserMessage(prompt, { deliverAs: "followUp" })` — queued until the agent finishes |

## Visual confirmation

`/save-replay-prompt` appends a custom message (`aftc-replay-saved`) to the
transcript as visual confirmation. A `context` event filter removes it from
the LLM-bound messages so the model never sees it.

## Failure modes

- Empty/whitespace-only args to `/save-replay-prompt`: rejected (headless log only).
- Missing/corrupt legacy `replay.json`: migration ignores it, deletes the file.
- `config.json` write failure: `setPreference` is best-effort (logged, never crashes).

## Architecture

Self-contained feature module. Imports `config` (preferences) and `paths`
(getDataDir for migration). No cross-module imports. Wired by the
orchestrator via `createReplay(pi)`.

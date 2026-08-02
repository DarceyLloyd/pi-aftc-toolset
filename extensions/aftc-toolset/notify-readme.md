# notify.ts -- Audio Notification

Plays an MP3 sound to alert the user when:

1. **Task completed** -- `agent_settled` fires and the task duration
   exceeds a configurable threshold (default 30 s).
2. **AI asks a question** -- the `ask_user_question` tool is called
   (plays immediately, regardless of duration).
3. **Error** -- the agent ends with a provider/network error
   (`stopReason === "error"`; retries exhausted or non-retryable).
4. **Aborted** -- the user aborts the agent (`stopReason === "aborted"`).
5. **Context-window usage crosses 25% / 50% / 75%** -- checked on each
   assistant `message_end` via `ctx.getContextUsage().percent`. A
   threshold fires once on the upward crossing and re-arms when usage
   drops back below it (e.g. after compaction).

The AI model is completely unaware of this feature. No model tool, no
prompt snippet, no prompt guidelines. Detection is pure TypeScript-side
event handling.

## Slash commands

| Command | What it does |
| --- | --- |
| `/aftc-audio-notifications` | MP3 picker for all 8 categories (live preview on highlight). Alias: `/aftc-notifications` |
| `/aftc-notify-time [sec]` | Show or set the task-duration threshold (0 = disabled) |

## Config (config.json)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `notifyEnabled` | boolean | `false` | Feature on/off. OFF by default: nothing plays until enabled in `/aftc-audio-notifications`. Migration sets it `true` only for users who already had sounds configured (their setup is never silenced) |
| `notifySoundQuestion` | string | `"voc_question_07.mp3"` | Filename in `data/aftc-audio-notifications/question/` or empty for none |
| `notifySoundTaskComplete` | string | `"voc_task_complete_07.mp3"` | Filename in `data/aftc-audio-notifications/task-complete/` or empty for none |
| `notifySoundError` | string | `"voc_we_got_a_problem_01.mp3"` | Filename in `data/aftc-audio-notifications/error/` or empty for none |
| `notifySoundAborted` | string | `""` | Filename in `data/aftc-audio-notifications/aborted/` or empty for none |
| `notifySoundStartup` | string | `"xp.mp3"` | Filename in `data/aftc-audio-notifications/startup/` or empty for none |
| `notifySoundContext25` | string | `""` | Filename in `data/aftc-audio-notifications/context-window/25/` or empty for none |
| `notifySoundContext50` | string | `""` | Filename in `data/aftc-audio-notifications/context-window/50/` or empty for none |
| `notifySoundContext75` | string | `""` | Filename in `data/aftc-audio-notifications/context-window/75/` or empty for none |
| `notifyTimeSec` | number | `1` | Seconds before completion sound (0 = off) |

Existing `config.json` values are NEVER overwritten: the write-back migration
only adds missing keys. Users who already picked sounds keep their choices.

## Playback

Uses a bundled miniaudio-based binary (`bin/play_sound-<platform>`).
miniaudio is MIT-0 / Unlicense -- zero distribution obligations.
The binary is spawned detached with `windowsHide: true`, no stdio,
and `child.unref()`. It self-exits when playback finishes.

## Audio files

MP3 files live in `extensions/aftc-toolset/data/aftc-audio-notifications/<category>/`. The user
adds their own MP3s there. The picker lists only `.mp3` files, sorted,
with a synthetic NONE entry at index 0. Labels are prettified for
display: the `.mp3` extension is dropped and `-` / `_` become spaces
(the stored value stays the real filename).

Folders: `question/`, `task-complete/`, `error/`, `aborted/`, `startup/`,
`context-window/25/`, `context-window/50/`, `context-window/75/`.

## Context-window thresholds

The three context thresholds (25%, 50%, 75%) are checked on every assistant
`message_end` using pi's own `ctx.getContextUsage().percent` (the same
estimate the footer widget shows). Semantics:

- A threshold **fires once on the upward crossing** and then stays silent
  while usage remains above it.
- It **re-arms when usage drops back below** the threshold (e.g. after a
  compaction), so the next upward crossing fires again.
- When one message crosses several thresholds at once (a 20% -> 80% jump),
  only the **highest** newly-crossed threshold plays, but every crossed
  threshold is marked so none of them re-fires while usage stays above.
- All threshold state resets on `session_start`.

## Binaries

| File | Platform |
| --- | --- |
| `bin/play_sound-win-x64.exe` | Windows x64 |
| `bin/play_sound-linux-x64` | Linux x64 |
| `bin/play_sound-macos-x64` | macOS Intel |
| `bin/play_sound-macos-arm64` | macOS Apple Silicon |

Source: `bin/src/play_sound.c` + `bin/src/miniaudio.h`.

## Events used

- `agent_start` -- records task start timestamp (first in a sequence).
- `tool_call` -- detects `ask_user_question` and plays immediately.
- `message_end` -- tracks the last assistant message's `stopReason` and
  runs the context-window threshold check.
- `agent_settled` -- decides which sound: error/aborted play immediately;
  normal completion respects the time threshold.

## Error/abort detection

There is no dedicated error event in pi's extension API. Detection uses:
- `message_end` (role assistant): capture `stopReason` + `errorMessage`.
- `agent_settled`: check the tracked `stopReason`:
  - `"error"` = provider/network failure (retries exhausted or non-retryable)
  - `"aborted"` = user cancelled (Escape or /aftc-stop)
  - `"stop"` / `"toolUse"` = normal completion

Error and aborted sounds play immediately (no time threshold).

## Architecture

Self-contained feature module. Imports only `config` (preferences) and
`ui/aftc-ui` (showMenu). No cross-module imports. Wired by the
orchestrator via `createNotify(pi)`.

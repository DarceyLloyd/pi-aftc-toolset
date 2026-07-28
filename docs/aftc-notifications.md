# Audio Notifications — Technical Documentation

Plays an MP3 sound to alert the user when something needs attention.
The AI model is completely unaware of this feature — no model tool, no
prompt snippet, no prompt guidelines. Detection is pure TypeScript-side
event handling.

---

## When sounds play

| Trigger | Event used | Condition |
| --- | --- | --- |
| AI asks a question | `tool_call` (ask_user_question) | Immediately, no threshold |
| Task completes | `agent_settled` | Duration >= threshold (default 30s) |
| Provider/network error | `agent_settled` | `stopReason === "error"`, immediate |
| User aborts | `agent_settled` | `stopReason === "aborted"`, immediate |
| Session starts | `session_start` | `reason === "startup"` or `"new"` |

**Error/abort detection:** there is no error event in pi. Track `stopReason`
from `message_end` (assistant messages), then check it at `agent_settled`.

---

## Architecture

```
extensions/aftc-toolset/
├── notify.ts                   # Feature module: events, playback, commands, menu
├── notify-readme.md            # Companion doc
├── bin/
│   ├── play_sound-win-x64.exe  # Windows x64 player
│   ├── play_sound-linux-x64    # Linux x64 player
│   ├── play_sound-macos-x64    # macOS Intel player
│   ├── play_sound-macos-arm64  # macOS Apple Silicon player
│   └── src/                    # C source (miniaudio, MIT-0)
└── data/aftc-audio-notifications/
    ├── question/*.mp3          # Sounds for "AI asks a question"
    ├── task-complete/*.mp3     # Sounds for "task done"
    ├── error/*.mp3             # Sounds for "error"
    ├── aborted/*.mp3           # Sounds for "user aborted"
    └── startup/*.mp3           # Sounds for "session start"
```

Self-contained module. Imports only `config` (preferences) and `ui/aftc-ui`
(showMenu). Wired by the orchestrator via `createNotify(pi)`.

---

## Playback

Uses a bundled miniaudio-based binary (public domain / MIT-0, zero distribution
obligations). Spawned detached: no window, no blocking, self-exits when done.

```typescript
spawn(bin, [audioFilePath], { detached: true, stdio: "ignore", windowsHide: true });
child.unref();
```

**Preview playback** (picker browsing): kills the previous preview before
starting the next so sounds don't overlap during navigation.

---

## Commands

| Command | Action |
| --- | --- |
| `/aftc-audio-notifications` | Open sound picker menu (alias `/aftc-notifications`) |
| `/aftc-notify-time [sec]` | Show or set task-duration threshold (0 = disabled) |

---

## Config menu (`/aftc-audio-notifications`)

Settings-hub style menu (AFTC UI `showMenu`). Each row shows its current sound
in an aligned column. Selecting a row opens a sound picker for that category:

```
Notification sounds
├── Enabled ......................... | Yes/No   [on/off; OFF by default; Enter toggles, selection preserved]
├── Choose sound for startup ........ | <current or NONE>
├── Choose sound for question ....... | <current or NONE>
├── Choose sound for task complete .. | <current or NONE>
├── Choose sound for error .......... | <current or NONE>
├── Choose sound for aborted ........ | <current or NONE>
└── Open notification sounds dir .... [opens OS file manager]
```

Sound picker per category:
- Lists all `.mp3` files in the category folder (sorted, prettified labels)
- Synthetic `NONE` entry at index 0
- Current sound marked with `(current)` and pre-selected via `initialIndex`
- **Live preview on highlight** (`onHighlight` plays the sound)
- Enter selects, Esc goes back to the hub

Selection preserved across re-renders (hub menu tracks `selectedIndex`).

---

## Config preferences

| Key | Type | Default | Purpose |
| --- | --- | --- | --- |
| `notifyEnabled` | bool | `false` | Master on/off — nothing plays until enabled; migration preserves existing users' setups (enabled if sounds already configured) |
| `notifySoundQuestion` | string | `"voc_question_07.mp3"` | Filename in `question/` or empty |
| `notifySoundTaskComplete` | string | `"voc_task_complete_07.mp3"` | Filename in `task-complete/` or empty |
| `notifySoundError` | string | `"voc_we_got_a_problem_01.mp3"` | Filename in `error/` or empty |
| `notifySoundAborted` | string | `""` | Filename in `aborted/` or empty |
| `notifySoundStartup` | string | `"xp.mp3"` | Filename in `startup/` or empty |
| `notifyTimeSec` | number | `1` | Min task duration (s) before completion sound; 0 = off |

Preferences store a bare FILENAME only. Resolved at runtime:
`path.join(getAudioDir(), <category>, filename)`. `getAudioDir()` is
package-relative (`__dirname/data/aftc-audio-notifications`).

---

## Events subscribed

| Event | Purpose |
| --- | --- |
| `session_start` | Play startup sound on fresh session |
| `agent_start` | Record task start timestamp (first in a sequence only) |
| `tool_call` | Detect `ask_user_question`, play question sound immediately |
| `message_end` | Track last assistant `stopReason` |
| `agent_settled` | Decide which sound: error/aborted immediate; task respects threshold |

---

## Key design decisions

- **Model-unaware:** no tool, no snippet, no guidelines. Pure event handling.
- **Question plays immediately:** the agent blocks waiting for user input, so
  `agent_settled` won't fire until the user answers.
- **First `agent_start` only:** retries fire additional `agent_start` events
  before the single `agent_settled`. Only the first records the timestamp.
- **Question suppresses task sound:** if a question played this run, the
  completion sound is skipped (avoid double notification).
- **Fire-and-forget playback:** detached spawn, no stdio, unref. Errors logged
  and swallowed. Never blocks pi.
- **Audio files ship in the package** (read directly from `data/` at runtime,
  NOT copied to the OS data dir). Users add their own MP3s to the folders.
- **Dev tooling** (`*.py`, `*.bat` audio processors in the data folder) is
  excluded from npm via `.npmignore`.

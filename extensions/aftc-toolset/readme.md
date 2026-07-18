# extensions/aftc-toolset/

The single pi extension that powers pi-aftc-toolset. One orchestrator
(`index.ts`) wires together self-contained feature modules - one per
TS file. Every file in this folder has a sibling `<name>.readme.md`
that explains what the file does, the events it listens for, and the
commands/shortcuts/tools it registers. See `.dev/dev_guide.md`.

## File map

| File | What it does |
| --- | --- |
| `index.ts` | Default-export orchestrator. Instantiates every module and wires core.ts's data provider into footer-widget.ts. |
| `core.ts` | Cache / token / cost accumulators, prefix-shape tracker, context-window timer, and the cache + timer commands. Returns a `FooterDataProvider` for the widget. |
| `footer-widget.ts` | The cache dashboard rendered as a `setWidget` below the editor (4 base lines + a conditional 5th allowance line). Owns the 1Hz ticker, show/hide lifecycle, and `/aftc-footer` toggle. |
| `allowance.ts` | Subscription allowance data for the footer's 5th line (5h + weekly used % + reset). Fetches `openai-codex` / `minimax` / `zai` usage endpoints and reads `anthropic` subscription headers; returns an `AllowanceProvider`. See `allowance.readme.md`. |
| `usage-report.ts` | `/usage-report` (writes + opens `report.html`) and `/usage-clear`. Reads from the SQLite DB. |
| `usage-recording.ts` | Per-turn SQLite recording. Implements the `TurnRecorder` interface that core.ts calls on every `message_end`. |
| `install.ts` | `/aftc-install` - runs `npm install` for `better-sqlite3` and locked uv sync for the packaged SSH carrier. |
| `help.ts` | `/aftc-help` - static command/shortcut list rendered via `ctx.ui.select`. |
| `ssh/` | Packaged Paramiko carrier plus local sessions, connection flow, picker, SSH commands, and model tools for commands, PTYs, transfers, and remote file operations. |
| `response.ts` | Full-width themed divider above every assistant reply. Toggled by `/aftc-response-divider`. |
| `intro.ts` | AFTC startup wordmark animation. Toggle it with `/aftc-intro-stop` and `/aftc-intro-on`; the setting persists across sessions. |
| `input-clear.ts` | `alt+c` keyboard shortcut - clears the input editor. |
| `stfu.ts` | `/aftc-stop` and `/stfu` slash commands - emergency abort of the current agent operation (escape a runaway thinking loop). |
| `theme.ts` | `/theme` slash command - shortcut to pi's theme picker. Lists all discovered themes, lets the user pick one, and switches the active theme. |
| `cd.ts` | `/cd` slash command - switch to a fresh Pi session in another directory. Interactive directory-picker overlay, or one-shot path arg (`~`, absolute, relative). Cleans up empty sessions on shutdown. |
| `dir.ts` | `/dir` and `/ls` slash commands - print the current directory name and run a platform-native directory listing (`dir` on Windows, `ls -la` on macOS/Linux). |
| `cwd.ts` | `/cwd` slash command - show the current working directory as an inline card (same style as `/dir`). |
| `replay.ts` | `/save-replay-prompt` and `/replay` slash commands - save a prompt string to `replay.json` and re-send it as a fresh user message (queued as follow-up when busy). |
| `db.ts` | Shared better-sqlite3 connection. Lazy-opens the DB; returns `null` if the native binding isn't installed. |
| `config.ts` | Persistent configuration module. Owns `config.json` (footer timeframe, footer on/off, response divider on/off, intro animation on/off). Creates the file with defaults on first use; only updates it when a preference changes. Never committed or shipped — the whole `.pi-aftc-toolset/` dir is ignored. |
| `paths.ts` | Resolves the package root and runtime data directory. |
| `types.ts` | Shared `TurnRecord` / `TurnRecorder` / `FooterDataProvider` interfaces so cross-module wiring is type-safe without module imports. |
| `info.md` | ANSI color reference + theme color tokens cheat sheet. Not a per-file README - it's a general reference. |

## Layout principle

- One feature per file.
- The entry extension (`index.ts`) is the orchestrator.
- Feature modules do **not** import each other. Communication flows through the orchestrator via method calls on the instances (dependency injection) or through structural interfaces declared in `types.ts`.

## Tests

Tests for this extension live under `tests/`. See `tests/readme.md`.

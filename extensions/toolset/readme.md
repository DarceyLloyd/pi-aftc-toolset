# extensions/toolset/

The single pi extension that powers pi-aftc-toolset. One orchestrator
(`index.ts`) wires together self-contained feature modules - one per
TS file. Every file in this folder has a sibling `<name>.readme.md`
that explains what the file does, the events it listens for, and the
commands/shortcuts/tools it registers. See `rules.md` §12.

## File map

| File | What it does |
| --- | --- |
| `index.ts` | Default-export orchestrator. Instantiates every module and wires core.ts's data provider into footer-widget.ts. |
| `core.ts` | Cache / token / cost accumulators, prefix-shape tracker, context-window timer, and the cache + timer commands. Returns a `FooterDataProvider` for the widget. |
| `footer-widget.ts` | The four-line cache dashboard rendered as a `setWidget` below the editor. Owns the 1Hz ticker, show/hide lifecycle, and `/aftc-footer` toggle. |
| `usage-report.ts` | `/usage-report` (writes + opens `report.html`) and `/usage-clear`. Reads from the SQLite DB. |
| `usage-recording.ts` | Per-turn SQLite recording. Implements the `TurnRecorder` interface that core.ts calls on every `message_end`. |
| `install.ts` | `/aftc-install` - runs `npm install` for `better-sqlite3` and `uv sync` for the Python SSH GUI. |
| `help.ts` | `/aftc-help` - static command/shortcut list rendered via `ctx.ui.select`. |
| `ssh.ts` | Five AI-callable SSH tools (`ssh_status`, `ssh_connect`, `ssh_run`, `ssh_peek`, `ssh_interrupt`) and five matching slash commands. |
| `response.ts` | Full-width themed divider above every assistant reply. Toggled by `/aftc-response-divider`. |
| `input-clear.ts` | `alt+c` keyboard shortcut - clears the input editor. |
| `stfu.ts` | `/aftc-stop` and `/stfu` slash commands - emergency abort of the current agent operation (escape a runaway thinking loop). |
| `theme.ts` | `/theme` slash command - shortcut to pi's theme picker. Lists all discovered themes, lets the user pick one, and switches the active theme. |
| `cd.ts` | `/cd` slash command - switch to a fresh Pi session in another directory. Interactive directory-picker overlay, or one-shot path arg (`~`, absolute, relative). Cleans up empty sessions on shutdown. |
| `dir.ts` | `/dir` and `/ls` slash commands - print the current directory name and run a platform-native directory listing (`dir` on Windows, `ls -la` on macOS/Linux). |
| `cwd.ts` | `/cwd` slash command - show the current working directory as an inline card (same style as `/dir`). |
| `db.ts` | Shared better-sqlite3 connection. Lazy-opens the DB; returns `null` if the native binding isn't installed. |
| `state.ts` | Persistent state module. Owns `state.json` (cross-session user preferences: footer timeframe, footer on/off, response divider on/off). Creates the file with defaults on first write; only updates it when a preference actually changes. No per-session resumption state. |
| `paths.ts` | Resolves the package root, runtime data dir, and the bundled Python GUI dir. |
| `types.ts` | Shared `TurnRecord` / `TurnRecorder` / `FooterDataProvider` interfaces so cross-module wiring is type-safe without module imports. |
| `info.md` | ANSI color reference + theme color tokens cheat sheet. Not a per-file README - it's a general reference. |

## Layout principle (rules.md §1.4 + §1.5)

- One feature per file.
- The entry extension (`index.ts`) is the orchestrator.
- Feature modules do **not** import each other. Communication flows through the orchestrator via method calls on the instances (dependency injection) or through structural interfaces declared in `types.ts`.

## Tests

Tests for this extension live under `tests/`. See `tests/readme.md`.

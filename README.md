# pi-aftc-toolset

[![GitHub release](https://img.shields.io/github/v/release/DarceyLloyd/pi-aftc-toolset)](https://github.com/DarceyLloyd/pi-aftc-toolset/releases/latest)
[![npm](https://img.shields.io/npm/v/pi-aftc-toolset)](https://www.npmjs.com/package/pi-aftc-toolset)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A productivity toolset for the [pi](https://pi.dev) CLI coding agent.

`pi-aftc-toolset` is a collection of tools for pi - from my point of view, essentials to assist with what I do on a daily basis and to get the most out of AI models.

---

## What's new in v1.6.0

- **`/cwd`** - new slash command that prints the current working directory as an inline card in the conversation transcript (same style as `/dir`).
- **`/cd` picker rewrite** - synthetic `./` current-folder entry at the top of the listing, selection always resets to the top, and the preserve-vs-fresh prompt is gone (`/cd` always starts a fresh session; resume via pi's built-in `/session`).
- **`/dir`, `/ls`** now registered in the `/aftc-help` output.
- Two new behavioural test harnesses (`cd-no-preserve`, `cd-picker-top`), 51 new assertions.

---

## Install

### Option 1 - npm (recommended)

```bash
pi install npm:pi-aftc-toolset
```

Then in pi:

```text
/reload
```

> **Runtime dependencies:** `pi install` does not always install native runtime deps. If SQLite or SSH features are unavailable, run `/aftc-install` (see [Dependency installer](#dependency-installer)).

### Option 2 - GitHub

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset
```

Then in pi:

```text
/aftc-install     # installs better-sqlite3 + Python GUI deps
/reload
```

> **GitHub installs require `/aftc-install`.** GitHub installs skip the npm post-install hook, so native dependencies (better-sqlite3, the bundled Python SSH GUI) are not installed automatically. Run `/aftc-install` once after the first install, then `/reload`.

---

## Slash Commands

Run `/aftc-help` inside pi for the same list grouped by category.

### General

| Command | What it does |
| --- | --- |
| `/aftc-help` | Grouped command/shortcut reference |
| `/aftc-install` | Install runtime deps (SQLite + Python SSH GUI) |
| `/aftc-response-divider` | Toggle the themed divider above each assistant reply |
| `/cls` | Clear the terminal |
| `/theme` | Open a theme picker (arrow keys, page jumps, pre-selects active theme) |

### Interrupt

| Command | What it does |
| --- | --- |
| `/aftc-stop` | Abort the current agent operation |
| `/stfu` | Short alias for `/aftc-stop` |

### Navigation

| Command | What it does |
| --- | --- |
| `/cd [path]` | Switch directory (interactive picker or one-shot path). Always starts a fresh session. |
| `/cd-set-max-depth [2-10]` | Set the `/cd` picker listing depth (default 3) |
| `/dir` (alias `/ls`) | Show the current directory name + platform-native listing |
| `/cwd` | Show the current working directory as an inline card |

### Footer, cache, timing

| Command | What it does |
| --- | --- |
| `/aftc-footer` | Toggle the four-line cache/timing/cost footer widget |
| `/aftc-footer-report-timeframe` | Set the footer AVG-window (Today, 3h, 6h, 24h, 2d, 3d, 7d, 28d) |
| `/cache-profile` | Per-tool token costs, prefix shape, churn analysis |
| `/cache-stats` | Current-context cache diagnostics + cost rate |
| `/cache-reset` | Zero accumulators and timer (debugging) |

### SSH

| Command | What it does |
| --- | --- |
| `/ssh-gui` | Launch the local PyQt6 SSH GUI |
| `/ssh-connect` | Connect to `user@host[:port]` (use the GUI for credentials) |
| `/ssh-run` | Run a one-shot command on the connected server |
| `/ssh-status` | Show GUI running state + connection status |
| `/ssh-disconnect` | Disconnect the active SSH session (use the GUI) |

### Usage

| Command | What it does |
| --- | --- |
| `/usage-report` | Write + open `report.html` (ALPHA) |
| `/usage-clear` | Delete all SQLite rows (with confirmation) |

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+C` | Clear the input editor |
| `Ctrl+T` | Toggle thinking blocks (pi built-in) |

### Bundled themes

- **cache-viz** - cache-focused green/cyan colour scheme.
- **aftc-orange-viz** - orange-accented variant of the sea-shells palette (the AFTC default).

Switch themes with `/theme`.

---

## Feature Guides

Detailed how-tos for each feature. See [Slash Commands](#slash-commands) above for the command list itself.

### Footer widget

A four-line diagnostic panel (not pi's footer), so it composes alongside other footer/status-bar extensions instead of replacing them. Updates live from pi events and a 1 Hz session sampler.

**Line layout:**

| Line | Shows |
| --- | --- |
| 1 | Model, thinking level, latest-turn cache hit rate, session-average hit rate, trend arrow, context window, IO token totals, last-turn cache split |
| 2 | Last-turn cost, session total cost, user-prompt count, total model calls, context time, burn rate |
| 3 | Active tool count / token estimate, skills `used/available`, thinking time, response time |
| 4 | AVG-window aggregates from SQLite (cost, prompts/turns, average cache hit rate, average thinking / response time) |

Line 4's time window is configurable - see `/aftc-footer-report-timeframe`. Defaults to Today; persisted across `/reload`, `/new`, and fresh pi startup (stored in `.pi-aftc-toolset/data/state.json`). Refreshed at most every 10 s from SQLite.

**Cache hit rate:** `cacheRead / (cacheRead + input)`.

- `Cache Turn` - latest assistant turn only.
- `AVG` - whole-session average.

**Prefix churn** is tracked in `core.ts` and surfaced by `/cache-profile` and `/cache-stats`. When the system prompt or tool schema changes between turns, `/cache-stats` shows the churn reason in the *Cache prefix shape* section.

**Session clock:** wall-clock elapsed since the first user prompt of the current session. In-memory only; cleared on every `session_start`, `/cache-reset`, `/reload`. Cost rate displayed as `$X.XX/hr · $X.XXX/min`.

---

### SSH remote terminal

Persistent remote terminal through a **visible local GUI**. The model asks the SSH tools to run commands; the tools talk to a local Python GUI that holds the real SSH connection.

```text
pi extension (Node.js)
  └─ launches internal-python-gui via uv
      └─ PyQt6 terminal GUI
          ├─ Paramiko SSH client
          ├─ Flask API on http://127.0.0.85:8564
          └─ std/out.txt session log
```

**Credential isolation** - the key safety design:

- Username, server address, and password are entered in the local Python GUI only - never in the pi editor, never in a prompt, never sent to the model.
- The model only calls `ssh_run` with a **command to execute**. It never sees the connection details.
- The Flask API binds to loopback only (`127.0.0.85:8564`).
- The model receives command output, not credentials.

**AI-callable tools:**

| Tool | Description |
| --- | --- |
| `ssh_status` | Check whether the GUI is reachable and connected |
| `ssh_connect` | Launch GUI, connect to `user@host[:port]`, optionally run an initial command |
| `ssh_run` | Execute a non-interactive shell command on the connected server |
| `ssh_peek` | Read recent output from the API buffer or full `std/out.txt` log |
| `ssh_interrupt` | Send repeated Ctrl+C / Ctrl+D to break hung commands |

**Safety notes:**

- Avoid interactive commands (`vim`, `nano`, `top`) in `ssh_run` - they will hang.
- Use `ssh_peek` with `mode: "file"` to inspect the full session history.
- SSH logs under `internal-python-gui/std/` are gitignored.

---

### Quick directory navigation

`/cd` switches the current Pi session to a different directory, always starting a fresh session in the target directory.

With no arguments, `/cd` opens a tree-style directory picker overlay rooted at the current working directory. On confirm, a new session is created in the picked directory and `switchSession` loads it. Cancelling with Esc leaves the current session untouched.

**Listing rules:**

- A synthetic `./` entry is always at index 0 - press Enter on it to switch to a fresh session right here, without navigating up.
- `↑ / ↓` move selection.
- `←` navigate up one level (or to drive listing at the root).
- `→` drill into the highlighted folder. No-op on empty folders and on `./`.
- `Enter` confirm the highlighted entry.
- `PgUp / PgDn` jump by the visible viewport size.
- `Ctrl+PgUp / Ctrl+PgDn` jump to the first / last entry.
- `Tab` autocomplete the highlighted entry into the path input.
- `Esc` cancel without switching.
- Selection always resets to the top after any refresh.
- Listing is unbounded; the viewport scrolls so the selected row is always visible.
- Typing filters the listing by fuzzy match; if no children match, Enter falls through to `/cd <typed>` resolution.

**One-shot path argument** skips the picker:

- `/cd ~/projects` - home-relative.
- `/cd /d/dev/myproject` - absolute (Windows or POSIX).
- `/cd ../sibling-project` - relative to current cwd.
- `/cd brand-new-project` - creates the directory after a confirm dialog if missing.

**Cross-platform:** Windows drive listing probes A-Z via `fs.readdirSync`; POSIX drive listing returns `["/"]`. Path joining / dirname / basename go through Node's `path` so separators are OS-correct. Header line is shortened with `~` on POSIX.

---

### Cache diagnostics

A live hit-rate readout, prefix-shape hashing that detects cache invalidations mid-session, a cache-write ROI calculation, a per-tool token-cost breakdown that surfaces prefix bloat, and a `cache-audit` skill that walks the model through diagnosis. The `cache-viz` theme reinforces the cache metrics visually. None of this exists in stock pi.

The bundled `cache-audit` skill guides the model through a cache diagnostics workflow:

```text
/skill:cache-audit
```

It runs `/cache-stats` and `/cache-profile`, diagnoses low hit rates, explains prefix churn, and suggests cache-stability improvements.

---

### Usage report

**ALPHA** - in development. Output, schema, and defaults may change before the first stable release.

Every completed assistant response with usage data is recorded to a local SQLite database at `.pi-aftc-toolset/data/turns.db`. Generate a report with `/usage-report` - a single self-contained HTML file at `.pi-aftc-toolset/data/report.html`, opened in your browser. No server, no external assets, no build step.

**Report sections:**

| Section | Content |
| --- | --- |
| 1 | Daily totals (last 24 h): most used / most inefficient / highest avg cost / lowest avg cost |
| 2 | Weekly totals (last 7 days), with weekend toggle |
| 3 | Monthly totals (last 28 days), with weekend toggle |
| 4 | Per-model cost report - sortable, period selector (Daily / Weekly / Monthly / All) |
| 5 | Per-model x thinking level - one row per thinking level per model |
| 6 | Cost projections per model x thinking level: $/hr, $/day, $/week, $/month, $/year |

Projections with fewer than ~14 calendar days of data are flagged as estimates. Single-turn handling: denominator is `max(0.5h, active hours)`.

**What gets recorded per turn:** per-turn metrics + prompt-type classification flags. The actual text of prompts and responses is **never** recorded - only flags. This keeps the DB small (~100 bytes / row) and avoids storing sensitive content.

**Prompt classification flags** (`0`/`1`):

| Column | Meaning |
| --- | --- |
| `user_prompt` | Direct response to a user message (`0` for automated continuations) |
| `base_prompt` | First user prompt of a task (drives projections) |
| `sub_prompt` | Follow-up / refinement under the current task |
| `steering_prompt` | Sub-prompt sent while the agent was still processing the previous one |
| `followup_prompt` | Sub-prompt queued in the editor and delivered after the agent finished |
| `continuation_prompt` | Idle follow-up / refinement in the same task thread |
| `prompt_kind` | Human-readable label: `base` / `continuation` / `steer` / `followup` / `auto` |

---

## Bundled skills

Load with `/skill:<name>`. The toolset ships with 31 live skills:

| Skill | Use for |
| --- | --- |
| `git` | Git + GitHub CLI workflow, Conventional Commits, safety rails |
| `bash` / `ps1` / `bat` / `tmux` | Shell scripting and terminal control |
| `html` / `css` / `scss` / `web-frontend` / `react` / `vue` / `angular` | Web frontend |
| `nodejs` / `javascript-mjs` / `javascript-transpiled` / `typescript` / `bun` / `deno` | JS / TS runtimes |
| `python` / `go` / `csharp` / `php` | Backend languages |
| `docker` / `devops` / `nginx` / `linux` | Infra and ops |
| `ffmpeg` | Video / audio / image CLI |
| `markdown-guide` | AI-friendly markdown for READMEs, SKILL.md, rules.md |
| `pinescript` | Pine Script v6 for TradingView |
| `cache-audit` | Prompt-cache diagnostics workflow |
| `bulk-read` | Concatenate many files into one markdown document |

> Previously bundled SDLC pipeline skills (assess-impact, audit-code, define-success, dispatch-agents, edit-document, plan-refactor, publish-package, quick-fix, request-review, research-first, respond-review, security-review, smoke-test, write-document, and the former git skills git-workflow / guard-git / github / release-branch) have been archived as `.rar` files in `skills/` to reduce per-turn context cost. The four git skills were merged into the single `/skill:git` above.

---

## Updating

```bash
pi update npm:pi-aftc-toolset
```

or install a pinned GitHub release:

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset@v<version>
```

Then `/reload` in pi.

---

## Uninstall

```bash
pi remove npm:pi-aftc-toolset          # global
pi remove npm:pi-aftc-toolset -l       # project-local
```

or via GitHub:

```bash
pi remove git:github.com/DarceyLloyd/pi-aftc-toolset
```

Then `/reload` or restart pi.

---

## Advanced installation

### npm variants

```bash
pi install npm:pi-aftc-toolset          # global
pi install npm:pi-aftc-toolset -l       # project-local
pi -e npm:pi-aftc-toolset               # ephemeral (current session only)
```

### GitHub variants

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset         # latest main
pi install git:github.com/DarceyLloyd/pi-aftc-toolset@v1.6.0  # pinned release
pi install git:github.com/DarceyLloyd/pi-aftc-toolset -l      # project-local
```

> GitHub installs skip npm post-install hooks - run `/aftc-install` once after the first install.

### Local clone

```bash
git clone https://github.com/DarceyLloyd/pi-aftc-toolset.git
pi install /path/to/pi-aftc-toolset -l
```

---

## Dependency installer

`/aftc-install` (see [Slash Commands](#slash-commands)) installs:

- `better-sqlite3` via `npm install`
- Python GUI dependencies via `uv sync` inside `internal-python-gui/`
- A bundled `uv.exe` automatically if required

Reload pi afterwards. The footer works without SQLite, but usage recording / reporting and SSH require `/aftc-install`.

---

## Requirements

- pi CLI
- Node.js / npm
- Providers that expose `usage.cacheRead` and `usage.cacheWrite` for full cache metrics (other providers may show zero / incomplete cache values)
- Python (installed automatically by `/aftc-install` via bundled `uv.exe`) for the SSH GUI

---

## Development

Install from a clone:

```bash
pi install /path/to/pi-aftc-toolset -l
```

After edits, reload pi with `/reload`.

### Key files

```text
extensions/toolset/index.ts             extension entry point + orchestrator
extensions/toolset/core.ts              cache/timing data + commands
extensions/toolset/footer-widget.ts     cache dashboard widget + /aftc-footer
extensions/toolset/usage-report.ts      usage report generator
extensions/toolset/usage-recording.ts   per-turn SQLite recording
extensions/toolset/ssh.ts               SSH tools and commands
extensions/toolset/response.ts          response divider + /aftc-response-divider
extensions/toolset/theme.ts              /theme shortcut to pi's theme picker
extensions/toolset/cd.ts                /cd directory picker
extensions/toolset/cwd.ts               /cwd current-directory display
extensions/toolset/dir.ts               /dir + /ls listing
extensions/toolset/help.ts              /aftc-help command reference
internal-python-gui/main.py             local SSH GUI/API
skills/                                 31 live skills (see Bundled skills above)
themes/cache-viz.json                   cache-oriented pi theme (green/cyan)
themes/aftc-orange-viz.json             orange-accented pi theme
```

Each TS file has a sibling `<name>.readme.md` documenting its contract (events, commands, factory signature, failure modes). See `extensions/toolset/readme.md` for the folder-level overview, and `rules.md` for source-of-truth development conventions.

### Tests

Each test has its own subfolder under `tests/` (dependency-free - `node` + pi's bundled jiti + `better-sqlite3` only):

```bash
node tests/parse-check/parse-check.mjs
node tests/full-check/full-check.mjs
node tests/widget-render-check/widget-render-check.mjs
node tests/stfu-check/stfu-check.cjs
node tests/bulk-read-check/bulk-read-check.mjs
node tests/theme-check/theme-check.cjs
node tests/state-check/state-check.cjs
node tests/cd-no-preserve/cd-no-preserve.cjs
node tests/cd-picker-top/cd-picker-top.cjs
node tests/load-test/load-test.cjs
```

See `tests/README.md` for the full layout and conventions.

---

## Persistent files

Project-local runtime data lives under `.pi-aftc-toolset/data/`:

| File | Purpose |
| --- | --- |
| `state.json` | Cross-session user preferences (footer AVG timeframe, footer on/off, response divider on/off). Created with defaults on first access; only re-written when a preference actually changes. |
| `turns.db` | SQLite usage database |
| `report.html` | Latest generated usage report |

In-memory only (per-session, not persisted): cache accumulators, model info, per-turn timings, context-window clock start time.

SSH GUI runtime files live under `internal-python-gui/std/` and are gitignored.

---

## License

[MIT](./LICENSE) - Author <Darcey.Lloyd@gmail.com>
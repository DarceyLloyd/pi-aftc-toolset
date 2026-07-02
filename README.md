# pi-aftc-toolset

A productivity toolset for the [pi](https://pi.dev) CLI coding agent.

`pi-aftc-toolset` adds a set of extensions, tools, a skill, and a theme to pi. It shows you what the model is doing as it happens, records every model call so you can see what you are spending, lets the model run commands on a remote server through a safe local SSH terminal, and bundles a few quality-of-life shortcuts.

Features: **live footer dashboard**, **SQLite usage tracking**, **HTML usage report with model leaderboards and cost projections**, **SSH remote terminal tools**, **one-command dependency installer**, **cache diagnostics**, **bundled cache-audit skill**, **cache-viz theme**, **input-clear shortcut**.

[![GitHub release](https://img.shields.io/github/v/release/DarceyLloyd/pi-aftc-toolset)](https://github.com/DarceyLloyd/pi-aftc-toolset/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

---

## Install

The package is published to npm: <https://www.npmjs.com/package/pi-aftc-toolset>. You can install it from npm or from a GitHub release.

### From npm (recommended)

Install globally (available in all projects):

```bash
pi install npm:pi-aftc-toolset
```

Install project-local only:

```bash
pi install npm:pi-aftc-toolset -l
```

Pin a specific version (optional — omit `@<version>` to always get the latest):

```bash
pi install npm:pi-aftc-toolset@<version>
```

Try it temporarily for one run (nothing is saved):

```bash
pi -e npm:pi-aftc-toolset
```

### From GitHub (latest)

Install the latest from the default branch globally:

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset
```

Install project-local only:

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset -l
```

Try it temporarily for one run:

```bash
pi -e git:github.com/DarceyLloyd/pi-aftc-toolset
```

Pin a specific release tag (optional — omit `@v<version>` to always get the latest):

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset@v<version>
```

### From a local clone

```bash
pi install /path/to/pi-aftc-toolset -l
```

### After installing

Run pi and, if needed, reload so the extension is picked up:

```text
/reload
```

Verify it is installed:

```bash
pi list
```

> **First run note:** `pi install` does not always run a package's runtime installers. This toolset uses a native SQLite dependency plus Python GUI dependencies for SSH. If pi reports missing dependencies, run `/aftc-install` (see [Dependency installer](#dependency-installer)).

---

## Uninstall

### npm (global)

```bash
pi remove npm:pi-aftc-toolset
```

### npm (project-local)

```bash
pi remove npm:pi-aftc-toolset -l
```

### GitHub (global)

```bash
pi remove git:github.com/DarceyLloyd/pi-aftc-toolset
```

Then reload or restart pi.

---

## Slash commands

Every feature is exposed through slash commands. Run `/aftc-help` inside pi to see this list in a scrollable dialog.

### General

| Command | Description |
|---|---|
| `/aftc-help` | Show this command and shortcut list in a scrollable dialog |
| `/aftc-install` | Install missing runtime dependencies (`better-sqlite3` + Python SSH GUI deps) |
| `/cls` | Clear the terminal screen |

### Footer, cache and timing

| Command | Description |
|---|---|
| `/aftc-footer` | Toggle the footer dashboard on/off |
| `/cache-profile` | Per-tool token costs, prefix shape hashes, system prompt size, churn analysis |
| `/cache-stats` | Session cache stats, cache-write ROI, SQLite-backed projections, model spend, prefix details |
| `/cache-reset` | Zero in-memory accumulators (tokens, cost, turns, churn) for benchmarking/debugging |
| `/cost-timer-always-running` | Run the session cost timer continuously from the first user prompt (default) |
| `/cost-timer-stop-when-idle` | Advance the session timer only while the assistant is actively processing |
| `/cost-timer-info` | Show the current timer mode and explain both modes |

### Usage report

| Command | Description |
|---|---|
| `/usage-report` | Generate and open `.pi-aftc-toolset/data/report.html` |
| `/usage-clear` | Permanently delete all recorded SQLite usage rows after confirmation |

### SSH

| Command | Description |
|---|---|
| `/ssh-gui` | Launch the local PyQt6 SSH GUI manually |
| `/ssh-connect user@host [password]` | Connect to a remote server (prompts for password if omitted) |
| `/ssh-run <command>` | Run a one-shot command on the connected server |
| `/ssh-status` | Show SSH GUI running state and connection status |
| `/ssh-disconnect` | Disconnect the active SSH session |

### Skill

| Command | Description |
|---|---|
| `/skill:cache-audit` | Load the bundled workflow for cache-hit and prefix diagnostics |

### Keyboard shortcuts

| Shortcut | Description |
|---|---|
| `alt+c` | Clear the text in pi's input editor |
| `Ctrl+T` | Built-in pi shortcut — toggle visibility of model `<thinking>` blocks |

---

## Footer dashboard

The footer is a four-line diagnostic bar that updates live from pi events and a 1Hz session sampler. Toggle it with `/aftc-footer`.

```text
▏ Z.ai: GLM 5.2 · medium │ Cache Turn 0.0% / AVG 86.0% ↓ │ 1.0M window
▏ IO ↑249K ↓5.1K │ 0 cached / 96K new │ $0.54315 (20 turns · 2 user) | Ctx Time 9M 47S │ $3.33/hr · $0.055/min
▏ 27 Tools ~5.5Kt │ Skills 3 ~2.0Kt │ Thinking time 0.0s Last / 1.1s Avg │ Response time: 0.1s Last / 2.8s Avg
▏ STATUS: OK │ Git: Not Setup
```

What each line shows:

| Line | Shows |
|---|---|
| 1 | Model, thinking level, latest-turn cache hit rate, session-average hit rate, trend arrow, context window |
| 2 | Input/output token totals, last-turn cache split, session cost, total model calls, user-prompt count, context time, burn rate |
| 3 | Active tool count/token estimate, skill/memory tool cost, thinking time, response time |
| 4 | Prefix shape status and Git branch |

### How cache hit rate is calculated

pi reports `input` as **new prompt tokens** only. `cacheRead` is the cached prefix served by the provider. The hit rate is:

```text
cacheRead / (cacheRead + input)
```

| Rate | Meaning |
|---|---|
| `Cache Turn` | Latest assistant turn only — useful for spotting immediate cache misses |
| `AVG` | Whole-session average — better for long-term cache health |

### Prefix churn

The footer hashes the system prompt and tool schema. If either changes between turns, line 4 can show:

```text
STATUS: CHANGED: system
STATUS: CHANGED: tools
STATUS: CHANGED: compaction
```

This helps explain sudden cache drops.

### Session timer modes

The footer's session timer has two modes:

| Mode | Counts | Best for |
|---|---|---|
| `always-running` (default) | Wall-clock time from first user prompt | Overall session cost awareness |
| `stop-when-idle` | Active assistant-processing time only | Cost per minute of model activity |

Switch with `/cost-timer-always-running`, `/cost-timer-stop-when-idle`, or `/cost-timer-info`. The mode is preserved across `session_start`, `model_select`, and `/cache-reset` during the current pi process.

---

## SSH remote terminal

The SSH feature gives the model a persistent remote terminal through a **visible local GUI**. The model asks the SSH tools to run commands; the tools talk to a local Python GUI that holds the real SSH connection.

```text
pi extension (Node.js)
  └─ launches internal-python-gui via uv
      └─ PyQt6 terminal GUI
          ├─ Paramiko SSH client
          ├─ Flask API on http://127.0.0.85:8564
          └─ std/out.txt session log
```

### How it keeps your SSH credentials away from the AI

This is the key safety design of the SSH feature:

- The **username, server IP/address, and password are entered in the local Python GUI only** — never in the pi editor, never in a prompt, and never sent to the model.
- The model only ever calls tools like `ssh_run` with a **command to execute**. It never sees the connection details.
- The GUI holds the SSH connection and runs the command locally, then returns **only the command output** to the model.
- The Flask API that bridges the extension and the GUI binds to **loopback only** (`127.0.0.85:8564`), so no other machine on your network can reach it.
- Everything you type into the GUI stays on your machine. The model receives command output, not credentials.

In short: **the AI gets the results of commands, never the keys to the server.**

### AI-callable tools

These tools are registered with pi so the model can use them when appropriate:

| Tool | Description |
|---|---|
| `ssh_status` | Check whether the GUI is reachable and connected |
| `ssh_connect` | Launch GUI, connect to `user@host[:port]`, optionally run an initial command |
| `ssh_run` | Execute a non-interactive shell command on the connected server |
| `ssh_peek` | Read recent output from the API buffer or the full `std/out.txt` log |
| `ssh_interrupt` | Send repeated Ctrl+C/Ctrl+D to break hung commands |

### SSH safety notes

- Avoid interactive commands such as `vim`, `nano`, `top`, or anything that waits for keystrokes through `ssh_run` — they will hang. Use non-interactive alternatives.
- Use `ssh_peek` with `mode: "file"` to inspect the full session history.
- SSH logs and std files live under `internal-python-gui/std/` and are gitignored — they never get committed.

---

## Usage report

Every completed assistant response that includes usage data is recorded to a local SQLite database at `.pi-aftc-toolset/data/turns.db`. Generate a report from it with:

```text
/usage-report
```

This writes a single self-contained HTML file to `.pi-aftc-toolset/data/report.html` and opens it in your browser. No server, no external assets, no build step.

The report contains:

- **Lifetime totals**
  - Turns / model calls, user prompts, base prompts, sub prompts
  - Steering, follow-up, continuation prompt counts
  - Automated continuations, cache read/write, tokens, total cost
  - Average cost per turn and per user prompt, model calls per prompt

- **Model leaderboards** — one shared time-window selector drives six ranked cards (top 5 models each):
  - Time windows: Last 3 Hours, Last 6 Hours, Last 12 Hours, Today, Yesterday, Last 3 Days, Week, Month
  - Most prompted (prompts, sub prompts, turns, avg cost/turn, total cost)
  - Most model calls / turns (turns, prompts, sub prompts, avg cost/turn, total cost)
  - Longest avg response (avg response, avg think, turns, avg cost/turn)
  - Most cost per turn (avg cost/turn, turns, cache, total cost)
  - Most cost over period (total cost, turns, prompts, avg cost/turn)
  - Highest cache hit rate (cache, turns, avg cost/turn, total cost)

- **Summary cards** — cheapest, most expensive (each with `$/hr · $/day · $/wk · $/mo` rate breakdown), most cache inefficient, most turn inefficient, highest spend, most used, slowest thinking, slowest response. Each card is pill-labelled **GOOD** / **OK** / **BAD**.

- **Trend** — interactive chart with:
  - Hourly / Daily / Weekly / Monthly views
  - Cost / User prompts / Turns metrics
  - Stacked model colours with a legend

- **Trend data table** — date, model, turns, user prompts, base, sub, steering, follow-up, continuation, cost, avg cost/turn, active hours, avg cache. Sortable columns.

- **Per-model cost report** — sortable table with period tabs (Today / Week / Month), turns, prompts, sub prompts, avg/max calls per prompt, avg cost per turn and per prompt, cache, think/response times.

- **Model × thinking level** — breakdown of cost, turns, prompts, cache, think/response time per model and thinking level.

- **Cost projections** — 6h / 12h / 1d / 7d / 30d, with selectable calculation modes:
  - Recommended: base prompt pace
  - Average base-prompt cost
  - Average all-prompt cost
  - Raw model-call velocity
  - Worst prompt loop risk

### What gets recorded per turn

The database records: session turn number, timestamp, model name, thinking level, thinking time, response time, cost (USD), input/output tokens, cache read/write tokens, plus a set of prompt-type flags so the report can tell apart normal prompts, mid-stream steering/follow-ups, and automated tool-call continuations:

- `user_prompt` — first assistant response after a user message (`1`), vs automated continuations (`0`)
- `base_prompt` — top-level prompt that starts a task (drives projections)
- `sub_prompt` — any follow-up/refinement under the current task
- `steering_prompt` — sub prompt sent while the assistant is active (pi `steer`)
- `followup_prompt` — queued active follow-up (pi `followUp`)
- `continuation_prompt` — idle follow-up/refinement in the same task thread
- `prompt_kind` — `base`, `steer`, `followup`, `continuation`, or `auto`

This matters because a single user prompt can produce many model calls when the assistant performs tool calls. `Model calls / prompt` is the average number of model responses caused by each user prompt — lower is better (`1.0` means one prompt produced one call; high values mean tool-call loops).

Clear all recorded usage with:

```text
/usage-clear
```

---

## Cache diagnostics

Two commands give you deeper cache insight than the footer alone:

- `/cache-profile` — per-tool token costs, prefix shape hashes, system prompt size, and churn analysis. Shows which tools are expensive and whether the prefix is stable.
- `/cache-stats` — session cache stats, cache-write ROI, SQLite-backed projections, model spend, and prefix details.
- `/cache-reset` — zeroes in-memory accumulators (tokens, cost, turns, churn) for benchmarking or debugging.

### `cache-audit` skill

The bundled skill guides the model through a cache diagnostics workflow:

- run `/cache-stats`
- inspect `/cache-profile`
- diagnose low hit rates
- explain prefix churn
- suggest cache-stability improvements

Load it with:

```text
/skill:cache-audit
```

---

## Dependency installer

This toolset has runtime dependencies that `pi install` does not always set up automatically: a native SQLite library (`better-sqlite3`) and Python GUI dependencies for SSH. If pi reports missing dependencies, run:

```text
/aftc-install
```

It installs:

- `better-sqlite3` via `npm install`
- Python GUI dependencies with `uv sync` inside `internal-python-gui/`
- a bundled `uv.exe` automatically if needed

Then run `/reload`. The footer works without SQLite, but usage recording/reporting and SSH require `/aftc-install`.

---

## Bundled theme

### `cache-viz` theme

The theme at `themes/cache-viz.json` provides a green/cyan-oriented visual style for cache and diagnostic work.

---

## Quality-of-life shortcuts

- `alt+c` — clears the text in pi's input editor so you can start typing fresh. Always available; implemented through `ctx.ui.setEditorText("")`.
- `Ctrl+T` — built-in pi shortcut to toggle visibility of model `<thinking>` blocks.
- `/cls` — clears the terminal screen.

---

## Persistent files

Project-local runtime data is stored under `.pi-aftc-toolset/data/`:

| File | Purpose |
|---|---|
| `data.json` | Session start time used by the footer/session clock |
| `turns.db` | SQLite usage database |
| `report.html` | Latest generated usage report |

SSH GUI runtime files are stored under `internal-python-gui/std/`:

| File | Purpose |
|---|---|
| `out.txt` | ANSI-stripped terminal output / session log |
| `in.txt` | Command input log |
| `err.txt` | Error output / logs |

All runtime data and logs are gitignored — they never get committed.

---

## What is included?

| Area | Files | What it provides |
|---|---|---|
| Extension orchestrator | `extensions/toolset/index.ts` | Loads the suite modules into pi |
| Footer / cache / timing | `extensions/toolset/core.ts` | Footer, cache diagnostics, timer commands, `/cls` |
| Usage DB + report | `extensions/toolset/db.ts`, `thinking.ts`, `usage.ts`, `types.ts` | SQLite recording, HTML report, usage clearing |
| Installer | `extensions/toolset/install.ts` | `/aftc-install` |
| Help | `extensions/toolset/help.ts` | `/aftc-help` command reference |
| Input clear | `extensions/toolset/input-clear.ts` | `alt+c` editor clear shortcut |
| SSH | `extensions/toolset/ssh.ts`, `internal-python-gui/` | AI-callable SSH tools and visible terminal GUI |
| Skill | `skills/cache-audit/` | Reusable cache audit workflow |
| Theme | `themes/cache-viz.json` | Green/cyan cache-oriented pi theme |

---

## Requirements

- The pi CLI coding agent
- Node.js/npm available to install `better-sqlite3`
- A model/provider that reports token usage for full cost/cache diagnostics
- For SSH: Python GUI dependencies installed by `/aftc-install` via `uv sync`

Cache metrics are most useful with providers that expose `usage.cacheRead` and `usage.cacheWrite`. If a provider does not report cache data, cache-specific fields may show zero or incomplete values.

---

## Updating

npm (latest):

```bash
pi update npm:pi-aftc-toolset
```

npm (pinned version — optional, omit `@<version>` to stay on latest):

```bash
pi install npm:pi-aftc-toolset@<version>
```

GitHub (pinned release — optional, omit `@v<version>` to stay on latest):

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset@v<version>
```

Local clone:

```bash
cd /path/to/pi-aftc-toolset
git pull
```

Then run `/reload` in pi.

---

## Development

Install locally from a clone:

```bash
pi install /path/to/pi-aftc-toolset -l
```

After edits, reload pi:

```text
/reload
```

Key files:

```text
extensions/toolset/index.ts       extension entry point
extensions/toolset/core.ts        footer/cache/timer commands
extensions/toolset/usage.ts       usage report generator
extensions/toolset/ssh.ts         SSH tools and commands
internal-python-gui/main.py       local SSH GUI/API
skills/cache-audit/SKILL.md       bundled skill
```

Lightweight parse/check scripts in the repo root:

```bash
node parse-check.mjs   # quick: does usage.ts still parse?
node full-check.mjs    # full: parse + DB + projection math + HTML structure + embedded JS syntax
```

---

## License

[MIT](./LICENSE) · Author Darcey.Lloyd@gmail.com

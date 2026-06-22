# pi-aftc-toolset v1.0.0

AFTC's productivity toolset for the [pi](https://pi.dev) CLI coding agent.

`pi-aftc-toolset` started as a cache diagnostics footer. It is now a small suite of pi extensions, tools, a skill, and a theme for tracking model usage, understanding prompt-cache behaviour, generating cost reports, clearing input quickly, and working with remote servers through a bundled SSH GUI.

[![GitHub release](https://img.shields.io/github/v/release/DarceyLloyd/pi-aftc-toolset)](https://github.com/DarceyLloyd/pi-aftc-toolset/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

---

## Highlights

- **Live footer dashboard** for model, thinking level, cache hit rates, token IO, cost, timing, tools, skills, prefix churn, and Git branch.
- **SQLite-backed model usage tracking** with per-turn cost/token/cache/timing data recorded to `.pi-aftc-toolset/data/turns.db`.
- **User prompt, sub-prompt, and automated turn tracking** so reports can distinguish normal prompts, mid-stream steering/follow-ups, and assistant/tool-call continuation turns.
- **Self-contained HTML usage report** at `.pi-aftc-toolset/data/report.html` with richer summary cards, Hourly/Daily/Weekly/Monthly trend views, model legends, sortable tables, per-model cost, thinking-level breakdowns, and cost projections.
- **SSH remote terminal tools** backed by a bundled PyQt6 + Flask + Paramiko GUI.
- **One-command dependency installer** via `/aftc-install` for `better-sqlite3` and Python GUI dependencies.
- **Quality-of-life commands** such as `/cls`, `/aftc-help`, `/usage-clear`, and `alt+c` to clear the pi editor.
- **Bundled cache-audit skill** and **cache-viz theme**.

---

## Preview

Footer example:

```text
▏ MiniMax-M3 · high │ Cache Turn 98.8% / AVG 98.5% ↑ │ 1M window
▏ IO ↑67 ↓11 │ 5.4K cached / 0 new │ $0.00070 (3 turns · 1 user) | Session 8M 3S │ Today $2.40 │ $0.30/hr · $0.005/min
▏ 13 Tools ~3.7Kt │ Skills 3 ~1.9Kt │ Thinking time 5.0s Last / 8.0s Avg │ Response time: 12.0s Last / 15.0s Avg
▏ STATUS: OK │ Git Branch: main
```

Usage report page:

```text
.pi-aftc-toolset/data/report.html
```

The report is a single HTML file: no server, no external assets, no build step.

---

## What is included?

| Area | Files | What it provides |
|---|---|---|
| Extension orchestrator | `extensions/toolset/index.ts` | Loads the suite modules into pi |
| Cache/footer dashboard | `extensions/toolset/core.ts` | Footer, cache diagnostics, timer commands, `/cls` |
| Usage DB + report | `extensions/toolset/db.ts`, `thinking.ts`, `usage.ts`, `types.ts` | SQLite recording, HTML report, usage clearing |
| Installer | `extensions/toolset/install.ts` | `/aftc-install` for Node/Python runtime deps |
| Help | `extensions/toolset/help.ts` | `/aftc-help` command reference |
| Input clear | `extensions/toolset/input-clear.ts` | `alt+c` editor clear shortcut |
| SSH | `extensions/toolset/ssh.ts`, `internal-python-gui/` | AI-callable SSH tools and visible terminal GUI |
| Skill | `skills/cache-audit/` | Reusable cache audit workflow |
| Theme | `themes/cache-viz.json` | Green/cyan cache-oriented pi theme |

---

## Install

Install a pinned release tag:

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset@v1.0.0
```

Install project-local instead of global:

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset@v1.0.0 -l
```

Try it temporarily without installing:

```bash
pi -e git:github.com/DarceyLloyd/pi-aftc-toolset@v1.0.0
```

Install from a local development clone:

```bash
pi install /w/Dev/pi-aftc-toolset -l
```

Then run pi and reload if needed:

```text
/reload
```

Verify installation:

```bash
pi list
```

---

## First run

`pi install` does not always run package runtime installers for git packages, and this project uses a native SQLite dependency plus Python GUI dependencies. If pi reports missing dependencies, run:

```text
/aftc-install
```

That command installs:

- `better-sqlite3` via `npm install`
- Python GUI dependencies with `uv sync` inside `internal-python-gui/`
- bundled `uv.exe` automatically if needed

After installing dependencies, run:

```text
/reload
```

The footer still loads without SQLite, but usage recording/reporting and some dependency-backed features require `/aftc-install`.

---

## Slash commands

### General

| Command | Description |
|---|---|
| `/aftc-help` | Show commands and shortcuts in a scrollable pi dialog |
| `/aftc-install` | Install missing runtime dependencies |
| `/cls` | Clear the terminal screen |

### Footer, cache, timing

| Command | Description |
|---|---|
| `/aftc-footer` | Toggle the footer dashboard on/off |
| `/cache-profile` | Show per-tool token costs, prefix hashes, system prompt size, and churn analysis |
| `/cache-stats` | Show session cache stats, cache-write ROI, SQLite-backed projections, model spend, and prefix details |
| `/cache-reset` | Reset in-memory accumulators for benchmarking/debugging |
| `/cost-timer-always-running` | Use wall-clock session timing from first user prompt. Default |
| `/cost-timer-stop-when-idle` | Count only active model-processing time |
| `/cost-timer-info` | Explain timer modes and show the current mode |

### Usage report

| Command | Description |
|---|---|
| `/usage-report` | Generate and open `.pi-aftc-toolset/data/report.html` |
| `/usage-clear` | Permanently clear all rows from the usage SQLite database after confirmation |

### SSH

| Command | Description |
|---|---|
| `/ssh-gui` | Launch the local SSH GUI manually |
| `/ssh-connect user@host [password]` | Connect to a remote server. Prompts for password if omitted |
| `/ssh-run <command>` | Run a one-shot command on the connected server |
| `/ssh-status` | Show GUI and SSH connection status |
| `/ssh-disconnect` | Disconnect the active SSH session |

### Skill

| Command | Description |
|---|---|
| `/skill:cache-audit` | Load the bundled cache audit workflow for cache-hit and prefix diagnostics |

---

## Keyboard shortcuts

| Shortcut | Description |
|---|---|
| `alt+c` | Clear the current pi editor text |
| `Ctrl+T` | Built-in pi shortcut: toggle model `<thinking>` block visibility |

`alt+c` is intentionally simple and always available. It clears the editor text through `ctx.ui.setEditorText("")`.

---

## Footer dashboard

The footer is a four-line diagnostic bar that updates from pi events and a lightweight 1Hz session sampler.

| Line | Shows |
|---|---|
| 1 | Current model, thinking level, latest-turn cache hit rate, session-average hit rate, trend arrow, context window |
| 2 | Input/output token totals, last-turn cache split, session cost, total model calls, user-prompt count, session time, today's spend, burn rate |
| 3 | Active tool count/token estimate, skill/memory tool cost, thinking time, response time |
| 4 | Prefix shape status and Git branch |

### Cache hit-rate formula

pi reports `input` as **new prompt tokens** only. `cacheRead` is the cached prefix served by the provider. The useful hit-rate formula is:

```text
cacheRead / (cacheRead + input)
```

| Rate | Meaning |
|---|---|
| `Cache Turn` | Latest assistant turn only. Volatile but useful for seeing immediate cache misses |
| `AVG` | Whole-session average. Better for long-term cache health |

### Prefix churn

The footer hashes the system prompt and tool schema. If either changes between turns, line 4 can show:

```text
STATUS: CHANGED: system
STATUS: CHANGED: tools
STATUS: CHANGED: compaction
```

This helps explain sudden cache drops.

---

## Usage database and model report

Every completed assistant response with usage data is recorded to SQLite at:

```text
.pi-aftc-toolset/data/turns.db
```

The table records:

- session turn number
- timestamp
- model name
- thinking level
- thinking time and response time
- cost USD
- input/output tokens
- cache read/write tokens
- `user_prompt` flag (`1` for the first assistant response after a user message, `0` for automated continuations)
- `prompt_index` number (1-based prompt sequence within the current session)
- `base_prompt` flag (`1` for top-level prompts used as projection baseline)
- `sub_prompt` flag (`1` for any follow-up/refinement prompt under an existing task)
- `steering_prompt` flag (`1` for active mid-stream `steer` prompts)
- `followup_prompt` flag (`1` for active queued `followUp` prompts)
- `continuation_prompt` flag (`1` for idle follow-up/refinement prompts that continue the task)
- `prompt_kind` text (`base`, `steer`, `followup`, `continuation`, or `auto`)

This distinction matters because a single user prompt can produce multiple model calls when the assistant performs tool calls, and mid-stream steering/follow-up messages are useful to measure separately. The report can now show:

- **Turns** — all assistant model calls with usage data
- **User prompts** — the first assistant response after each user message; a closer proxy for how often you prompted the model
- **Base prompts** — top-level prompts that start a task and drive the projection baseline
- **Sub prompts** — follow-up/refinement prompts under the current task
- **Steering prompts** — sub prompts sent while the assistant is active using pi's `steer` behavior
- **Follow-up prompts** — queued active follow-ups using pi's `followUp` behavior
- **Continuation prompts** — idle follow-ups/refinements in the same task thread
- **Automated continuations** — extra model calls caused by tool-call loops or continuation rounds

`Model calls / prompt` is not a percentage. It is the average number of model responses caused by each user prompt. Lower is generally better: `1.0` means one prompt produced one model call; high values mean tool-call loops or many continuation rounds.

Generate the report with:

```text
/usage-report
```

The report includes:

- lifetime totals for turns/model calls, base prompts, sub prompts, steering/follow-up/continuation prompt types, automated continuations, cache, tokens, and cost
- most used model by user prompts for Today/Week/Month plus Last 3 Hours/6 Hours/12 Hours
- expanded summary cards: cheapest, most expensive, most cache inefficient, most turn inefficient (the model with the highest number of model calls from a single prompt), highest spend, most used, slowest thinking, slowest response
- interactive Trend section with Hourly/Daily/Weekly/Monthly views, Cost/User prompts/Turns metrics, stacked model colors, and a legend
- trend data table with model, turns, user prompts, sub prompts, cost, average cost, active hours, and cache rate
- enhanced per-model cost report
- enhanced model × thinking-level table
- cost projections for 6h, 12h, 1d, 7d, 30d with selectable calculation modes: base prompt pace, average base-prompt cost, average all-prompt cost, raw model-call velocity, and worst prompt loop risk
- sortable columns and period tabs for Today/Week/Month

Clear recorded usage with:

```text
/usage-clear
```

---

## SSH remote terminal

The SSH feature gives the model a persistent remote terminal through a visible local GUI.

The architecture is:

```text
pi extension (Node.js)
  └─ launches internal-python-gui via uv
      └─ PyQt6 terminal GUI
          ├─ Paramiko SSH client
          ├─ Flask API on http://127.0.0.85:8564
          └─ std/out.txt session log
```

### AI-callable tools

These tools are registered with pi so the model can use them when appropriate:

| Tool | Description |
|---|---|
| `ssh_status` | Check whether the GUI is reachable and connected |
| `ssh_connect` | Launch GUI, connect to `user@host[:port]`, optionally run an initial command |
| `ssh_run` | Execute a non-interactive shell command on the connected server |
| `ssh_peek` | Read recent output from API buffer or full `std/out.txt` log |
| `ssh_interrupt` | Send repeated Ctrl+C/Ctrl+D to break hung commands |

### SSH safety notes

- Avoid interactive commands such as `vim`, `nano`, `top`, or long foreground prompts through `ssh_run`.
- Use `ssh_peek` with `mode: "file"` to inspect full session history.
- SSH logs and std files live under `internal-python-gui/std/` and are gitignored.
- The Flask API binds to loopback only: `127.0.0.85:8564`.

---

## Timer modes

The footer's session timer supports two modes:

| Mode | Counts | Best for |
|---|---|---|
| `always-running` | Wall-clock time from first user prompt | Overall session cost awareness |
| `stop-when-idle` | Active assistant-processing time only | Cost per minute of model activity |

Switch modes with:

```text
/cost-timer-always-running
/cost-timer-stop-when-idle
/cost-timer-info
```

The timer mode is preserved across `session_start`, `model_select`, and `/cache-reset` during the current pi process.

---

## Persistent files

Project-local runtime data is stored under:

```text
.pi-aftc-toolset/data/
```

| File | Purpose |
|---|---|
| `data.json` | Session start time used by the footer/session clock |
| `turns.db` | SQLite usage database |
| `report.html` | Latest generated model usage report |

SSH GUI runtime files are stored under:

```text
internal-python-gui/std/
```

| File | Purpose |
|---|---|
| `out.txt` | ANSI-stripped terminal output/session log |
| `in.txt` | Command input log |
| `err.txt` | Error output/logs |

Runtime data and logs are gitignored.

---

## Bundled skill and theme

### `cache-audit` skill

The bundled skill guides the model through cache diagnostics:

- run `/cache-stats`
- inspect `/cache-profile`
- diagnose low hit rates
- explain prefix churn
- suggest cache-stability improvements

Use it with:

```text
/skill:cache-audit
```

### `cache-viz` theme

The theme at `themes/cache-viz.json` provides a green/cyan-oriented visual style for cache and diagnostic work.

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

Useful files:

```text
extensions/toolset/index.ts       extension entry point
extensions/toolset/core.ts        footer/cache/timer commands
extensions/toolset/usage.ts       usage report generator
extensions/toolset/ssh.ts         SSH tools and commands
internal-python-gui/main.py       local SSH GUI/API
skills/cache-audit/SKILL.md       bundled skill
```

There are lightweight parse/check scripts in the root:

```bash
node parse-check.mjs
node full-check.mjs
```

---

## Requirements

- pi CLI coding agent
- Node.js/npm available to install `better-sqlite3`
- A model/provider that reports token usage for full cost/cache diagnostics
- For SSH: Python GUI dependencies installed by `/aftc-install` through `uv sync`

Cache metrics are most useful with providers that expose `usage.cacheRead` and `usage.cacheWrite`. If a provider does not report cache data, cache-specific fields may show zero or incomplete values.

---

## Updating

Pinned release install:

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset@v1.0.0
```

Project-local pinned release:

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset@v1.0.0 -l
```

Local clone:

```bash
cd /path/to/pi-aftc-toolset
git pull
```

Then run `/reload` in pi.

---

## Uninstall

Global:

```bash
pi remove pi-aftc-toolset
```

Project-local:

```bash
pi remove pi-aftc-toolset -l
```

Then reload or restart pi.

---

## License

[MIT](./LICENSE)

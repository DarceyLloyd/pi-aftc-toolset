# pi-aftc-toolset

[![GitHub release](https://img.shields.io/github/v/release/DarceyLloyd/pi-aftc-toolset)](https://github.com/DarceyLloyd/pi-aftc-toolset/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A productivity toolset for the [pi](https://pi.dev) CLI coding agent.

`pi-aftc-toolset` is a collection of tools for pi — from my point of view, essentials to assist with what I do on a daily basis and to get the most out of AI models.

## Features

- Live footer widget which displays cache hit rate, cache efficiency, context time and live cost tracking.
- Secure SSH GUI that keeps server credentials away from the AI.
- Usage reports with model rankings, trends and spending insights (ALPHA, in development).
- Cache diagnostics and profiling tools.
- Themed response divider above every assistant reply.
- Built-in cache-oriented theme.
- Keyboard shortcuts and productivity commands.

---

# Installation

## Quick Install

**GitHub**

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset
```

**npm**

```bash
pi install npm:pi-aftc-toolset
```

Start pi:

```bash
pi
```

Install runtime dependencies:

**Note:** `pi install` doesn't install native runtime dependencies.
If features such as SQLite or SSH are unavailable, run `/aftc-install`.

```text
/aftc-install
```

Restart pi or run:

```text
/reload
```

> **First run note:** `pi install` does not always run a package's
> runtime installers. This toolset uses a native SQLite dependency
> plus Python GUI dependencies for SSH. If pi reports missing
> dependencies, run `/aftc-install` (see
> [Dependency installer](#dependency-installer)).

---

# Uninstall

```bash
pi remove npm:pi-aftc-toolset
```

Project-local:

```bash
pi remove npm:pi-aftc-toolset -l
```

or via GitHub:

```bash
pi remove git:github.com/DarceyLloyd/pi-aftc-toolset
```

Then reload or restart pi.

---

# Included Features

## Cache Dashboard

A live diagnostics widget showing:

- Current model and thinking level
- Cache hit rate (turn + session)
- Context time
- Cost per minute/hour
- Token usage
- Tool and skill usage
- Thinking and response times

See **Cache Dashboard** below for full details.

---

## Secure SSH

A local Python GUI provides persistent SSH sessions while ensuring
usernames, passwords and server addresses never enter the model
context.

Features include:

- Persistent SSH sessions
- AI-callable SSH tools
- Local GUI
- Secure credential isolation
- Session logging

See **SSH Remote Terminal** below.

---

## Usage Reports

ALPHA — in development. The feature works but the output, schema, and
defaults may change before the first stable release.

Generate a self-contained HTML report containing:

- Lifetime statistics
- Model leaderboards
- Cost breakdowns
- Cache efficiency
- Trend charts
- Cost projections

---

## Cache Diagnostics

Built-in commands help diagnose cache behaviour.

- `/cache-profile`
- `/cache-stats`
- `/cache-reset`
- `cache-audit` skill

---

## Response Divider

A full-width themed rule rendered above every assistant reply, making
it easier to scan a long conversation. Toggle it with
`/aftc-response-divider`.

---

## Interrupt

When a reasoning model gets stuck in a long internal monologue or a
runaway tool-call loop, hit `/aftc-stop` (or `/stfu`) to abort the
current agent operation and return to the editor. Both commands call
`ctx.abort()` under the hood and behave identically — `/stfu` is just
a short alias you can type in a hurry. When the agent is already
idle, you'll get a friendly "Agent is already idle — nothing to
stop." notification instead of a silent no-op.

---

## Included Theme

**cache-viz** provides a cache-focused green/cyan colour scheme.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+C` | Clear editor |
| `Ctrl+T` | Toggle thinking blocks |
| `/cls` | Clear terminal |

---

# Commands

## General

- `/aftc-help`
- `/aftc-install`
- `/aftc-response-divider`
- `/cls`

## Interrupt

- `/aftc-stop` — stop the current agent operation (escape a runaway thinking loop or stalled tool call).
- `/stfu` — short alias for `/aftc-stop`. Same action, fewer keystrokes.

## Footer Widget, Cache, Costs, Stats +

- `/aftc-footer`
- `/cache-profile`
- `/cache-stats`
- `/cache-reset`

## SSH

- `/ssh-gui`
- `/ssh-connect` (best to use the GUI for this, scheduled for removal)
- `/ssh-run`
- `/ssh-status`
- `/ssh-disconnect` (best to use the GUI for this, scheduled for removal)

## Usage

- `/usage-report` (ALPHA — in development)
- `/usage-clear`

## Skills

- `/skill:cache-audit`

---

# Feature Guides

## Model, Cache, Costs and usage Footer Widget

The footer widget is a three-line diagnostic panel (not pi's
footer), so it composes alongside other footer/status-bar extensions
(e.g. pi-bar) instead of replacing them. It updates live from pi
events and a 1Hz session sampler. Toggle it with `/aftc-footer`.

```text
▏ Z.ai: GLM 5.2 · medium │ Cache Turn 0.0% / AVG 86.0% ↓ │ 1.0M window
▏ IO ↑249K ↓5.1K │ 0 cached / 96K new │ $0.54315 (20 turns · 2 user) | Ctx Time 9M 47S │ $3.33/hr · $0.055/min
▏ 27 Tools ~5.5Kt │ Skills 3 ~2.0Kt │ Thinking time 0.0s Last / 1.1s Avg │ Response time: 0.1s Last / 2.8s Avg
```

What each line shows:

| Line | Shows |
|---|---|
| 1 | Model, thinking level, latest-turn cache hit rate, session-average hit rate, trend arrow, context window |
| 2 | Input/output token totals, last-turn cache split, session cost, total model calls, user-prompt count, context time, burn rate |
| 3 | Active tool count/token estimate, skill/memory tool cost, thinking time, response time |

### How cache hit rate is calculated

pi reports `input` as **new prompt tokens** only. `cacheRead` is
the cached prefix served by the provider. The hit rate is:

```text
cacheRead / (cacheRead + input)
```

| Rate | Meaning |
|---|---|
| `Cache Turn` | Latest assistant turn only — useful for spotting immediate cache misses |
| `AVG` | Whole-session average — better for long-term cache health |

### Prefix churn

Prefix shape churn is tracked in core.ts and surfaced by the
`/cache-profile` and `/cache-stats` commands (not the footer, which
intentionally stays focused on per-turn metrics). When the system
prompt or tool schema changes between turns, `/cache-stats` shows
the churn reason in the "Cache prefix shape" section, helping
explain sudden cache drops.

### Session timer modes

The footer's session clock is wall-clock elapsed since the first
user prompt of the current session. It's tracked in memory only
(set on the first `message_start` for user, cleared on every
`session_start` / `/cache-reset` / `/reload`). No file I/O. The
cost rate is `acc.cost / sessionMinutes`, displayed as
`$X.XX/hr · $X.XXX/min`.

---

## SSH Remote Terminal

The SSH feature gives the model a persistent remote terminal
through a **visible local GUI**. The model asks the SSH tools to
run commands; the tools talk to a local Python GUI that holds
the real SSH connection.

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

- The **username, server IP/address, and password are entered in
  the local Python GUI only** — never in the pi editor, never in a
  prompt, and never sent to the model.
- The model only ever calls tools like `ssh_run` with a **command
  to execute**. It never sees the connection details.
- The GUI holds the SSH connection and runs the command locally,
  then returns **only the command output** to the model.
- The Flask API that bridges the extension and the GUI binds to
  **loopback only** (`127.0.0.85:8564`), so no other machine on
  your network can reach it.
- Everything you type into the GUI stays on your machine. The
  model receives command output, not credentials.

In short: **the AI gets the results of commands, never the keys to
the server.**

### AI-callable tools

These tools are registered with pi so the model can use them when
appropriate:

| Tool | Description |
|---|---|
| `ssh_status` | Check whether the GUI is reachable and connected |
| `ssh_connect` | Launch GUI, connect to `user@host[:port]`, optionally run an initial command |
| `ssh_run` | Execute a non-interactive shell command on the connected server |
| `ssh_peek` | Read recent output from the API buffer or the full `std/out.txt` log |
| `ssh_interrupt` | Send repeated Ctrl+C/Ctrl+D to break hung commands |

### SSH safety notes

- Avoid interactive commands such as `vim`, `nano`, `top`, or
  anything that waits for keystrokes through `ssh_run` — they
  will hang. Use non-interactive alternatives.
- Use `ssh_peek` with `mode: "file"` to inspect the full session
  history.
- SSH logs and std files live under `internal-python-gui/std/`
  and are gitignored — they never get committed.

---

## Usage Report

ALPHA — in development. Output, schema, and defaults may change before
the first stable release.

Every completed assistant response that includes usage data is
recorded to a local SQLite database at
`.pi-aftc-toolset/data/turns.db`. Generate a report from it with:

```text
/usage-report
```

This writes a single self-contained HTML file to
`.pi-aftc-toolset/data/report.html` and opens it in your browser.
No server, no external assets, no build step.

The report is organised into six sections:

- **Section 1 — Daily totals (last 24 hours)** — four cards:
  most used (derived from base prompts), most inefficient (derived
  from turns/self-prompting), highest avg cost (derived from base +
  sub prompts), lowest avg cost (derived from base + sub prompts).

- **Section 2 — Weekly totals (last 7 days)** — same four cards,
  with a **weekend toggle** to include/exclude Sat/Sun.

- **Section 3 — Monthly totals (last 28 days)** — same four cards,
  with a weekend toggle.

- **Section 4 — Per-model cost report** — sortable table with a
  period selector (Daily / Weekly / Monthly / All time, default
  All time).

- **Section 5 — Per-model × thinking level** — same shape as
  Section 4 but keyed by model + thinking level, so a single model
  has one row per thinking level used.

- **Section 6 — Cost projections** — per model × thinking level:
  `$`/hr, `$`/day, `$`/week, `$`/month, `$`/year derived from total
  spend ÷ active hours. When fewer than ~14 calendar days are
  recorded, projections are flagged as estimates with a note:
  *"Not enough data available for calculation, averages have been
  used."*

### What gets recorded per turn

The database records per-turn metrics and prompt-type metadata so
the report can tell apart normal prompts, mid-stream
steering/follow-ups, and automated tool-call continuations. **The
actual text of the user's prompt and sub-prompts is never
recorded** — only classification flags. This keeps the DB small
(one row ≈ ~100 bytes) and avoids storing anything sensitive.

### Thin-data handling

The tool may have only a few minutes or hours of recorded data.
Projections use `max(0.5h, active hours)` as the denominator so a
single turn never produces a divide-by-zero, and any projection
based on fewer than ~14 calendar days is flagged as an estimate.

#### Per-row columns

| Column | Type | Meaning |
|---|---|---|
| `id` | int PK | Auto-increment row id |
| `turn` | int | Session-scoped turn counter |
| `timestamp` | int | ms since epoch at `message_end` |
| `model_name` | text | e.g. `MiniMax-M3` |
| `thinking_level` | text | e.g. `high`, `low`, `off` |
| `thinking_ms` | int | Time to first non-thinking output |
| `response_ms` | int | Total turn duration (request-sent → message end) |
| `cost_usd` | real | Cost of this turn |
| `input_tokens` | int | New prompt tokens |
| `output_tokens` | int | Output tokens |
| `cache_read` | int | Cached prefix tokens served |
| `cache_write` | int | Tokens written to cache this turn |
| `session_id` | text | Stable per-runtime-session id |
| `prompt_index` | int | 1-based user-prompt number; all automated continuations share the same index as the user prompt that caused them |

#### Prompt-classification columns

These flag the *kind of trigger* for the assistant turn — **not
the content of the prompt**. They're either `0` (false) or `1`
(true) unless noted.

| Column | Meaning |
|---|---|
| `user_prompt` | `1` if this assistant turn is a direct response to a user message. `0` for automated tool-call continuation rounds. |
| `base_prompt` | `1` if this is the first user prompt of a task (top-level, drives projections). Always `0` when `user_prompt = 0`. |
| `sub_prompt` | `1` if this is any follow-up / refinement under the current task. Always `0` when `user_prompt = 0`. |
| `steering_prompt` | `1` if the user sent this sub-prompt while the agent was still actively processing the previous one (pi's `steer()`). |
| `followup_prompt` | `1` if the user queued this sub-prompt to be delivered after the agent finished (pi's `followUp()`). |
| `continuation_prompt` | `1` if this is an idle follow-up / refinement sent in the same task thread. |
| `prompt_kind` | text — see table below. |

#### `prompt_kind` values

The `prompt_kind` column carries a single human-readable label
for the trigger. It's redundant with the `*_prompt` flag columns
(those flags are derived from the same source) but it's a useful
denormalised index for sorting and grouping in the report.

| `user_prompt` | `prompt_kind` | Meaning |
|---|---|---|
| 1 | `base` | First user prompt of a task (top-level, drives projections). |
| 1 | `continuation` | Idle follow-up / refinement in the same task thread. |
| 1 | `steer` | Sub-prompt sent while the agent was still actively processing the previous one. |
| 1 | `followup` | Sub-prompt queued in the editor and delivered after the agent finished. |
| 0 | `auto` | Automated tool-call continuation round — no new user input between this and the prior turn. |

#### What is NOT recorded

- The actual **text** of user prompts, sub-prompts, or assistant
  responses. (The model call content lives in pi's session
  JSONL; this DB only stores metrics.)
- File paths, tool names, or arguments the assistant invoked
  tools with.
- Reasoning or thinking-block content (only `thinking_ms` is
  recorded).

This matters because a single user prompt can produce many
model calls when the assistant performs tool calls. `Model calls
/ prompt` is the average number of model responses caused by
each user prompt — lower is better (`1.0` means one prompt
produced one call; high values mean tool-call loops).

Clear all recorded usage with:

```text
/usage-clear
```

---

## Cache Diagnostics

Two commands give you deeper cache insight than the footer alone:

- `/cache-profile` — per-tool token costs, prefix shape hashes,
  system prompt size, and churn analysis. Shows which tools are
  expensive and whether the prefix is stable.
- `/cache-stats` — session cache stats, cache-write ROI,
  SQLite-backed projections, model spend, and prefix details.
- `/cache-reset` — zeroes in-memory accumulators (tokens, cost,
  turns, churn) for benchmarking or debugging.

### `cache-audit` skill

The bundled skill guides the model through a cache diagnostics
workflow:

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

# Additional Installation Options

## npm

Global:

```bash
pi install npm:pi-aftc-toolset
```

Project:

```bash
pi install npm:pi-aftc-toolset -l
```

Temporary:

```bash
pi -e npm:pi-aftc-toolset
```

## GitHub

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset
```

Project local:

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset -l
```

Pinned release:

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset@v<version>
```

## Local Clone

```bash
pi install /path/to/pi-aftc-toolset -l
```

## Dependency Installer

Run:

```text
/aftc-install
```

Installs:

- `better-sqlite3` via `npm install`
- Python GUI dependencies via `uv sync` inside `internal-python-gui/`
- a bundled `uv.exe` automatically if required

Reload pi afterwards. The footer works without SQLite, but usage
recording/reporting and SSH require `/aftc-install`.

---

# Requirements

- pi CLI
- Node.js / npm
- Providers exposing token usage for best cache metrics
- Python dependencies installed through `/aftc-install` for SSH

Cache metrics are most useful with providers that expose
`usage.cacheRead` and `usage.cacheWrite`. If a provider does not
report cache data, cache-specific fields may show zero or
incomplete values.

---

# Updating

```bash
pi update npm:pi-aftc-toolset
```

or install a pinned GitHub release:

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset@v<version>
```

Then run `/reload` in pi.

---

# Development

Install locally from a clone:

```bash
pi install /path/to/pi-aftc-toolset -l
```

After edits, reload pi:

```text
/reload
```

## Key files

```text
extensions/toolset/index.ts             extension entry point + orchestrator
extensions/toolset/core.ts              cache/timing data + commands
extensions/toolset/footer-widget.ts     cache dashboard widget + /aftc-footer
extensions/toolset/usage-report.ts      usage report generator
extensions/toolset/usage-recording.ts   per-turn SQLite recording
extensions/toolset/ssh.ts               SSH tools and commands
extensions/toolset/response.ts          response divider + /aftc-response-divider
internal-python-gui/main.py             local SSH GUI/API
skills/cache-audit/SKILL.md             bundled skill
themes/cache-viz.json                   cache-oriented pi theme
```

Each TS file has a sibling `<name>.readme.md` documenting its
contract (events, commands, factory signature, failure modes). See
`extensions/toolset/readme.md` for the folder-level overview, and
`rules.md` for the source-of-truth development conventions.

## Tests

Tests live under `tests/` (one subfolder per test, dependency-free —
`node` + pi's bundled jiti + `better-sqlite3` only):

```bash
node tests/parse-check/parse-check.mjs          # jiti parses usage-report.ts
node tests/full-check/full-check.mjs            # DB + projections + HTML structure
node tests/widget-render-check/widget-render-check.mjs  # orchestrator + footer widget + ticker
node tests/stfu-check/stfu-check.cjs            # /aftc-stop + /stfu: idle / streaming / headless
node tests/load-test/load-test.cjs              # end-to-end: factory + events + commands + SQLite
```

## Persistent files

Project-local runtime data is stored under `.pi-aftc-toolset/data/`:

| File | Purpose |
|---|---|
| (in-memory only) | The context-window session start time is tracked in memory (set on first user `message_start`, cleared on `session_start` / `/cache-reset`). Not persisted. |
| `turns.db` | SQLite usage database |
| `report.html` | Latest generated usage report |

SSH GUI runtime files are stored under `internal-python-gui/std/`:

| File | Purpose |
|---|---|
| `out.txt` | ANSI-stripped terminal output / session log |
| `in.txt` | Command input log |
| `err.txt` | Error output / logs |

All runtime data and logs are gitignored — they never get committed.

## What is included?

| Area | Files | What it provides |
|---|---|---|
| Extension orchestrator | `extensions/toolset/index.ts` | Loads the suite modules into pi and wires the footer data provider to the widget |
| Cache / timing data | `extensions/toolset/core.ts` | Cache diagnostics, timer commands, `/cls` |
| Cache footer widget | `extensions/toolset/footer-widget.ts` | Renders the three-line cache dashboard, owns `/aftc-footer` toggle |
| Usage DB + report | `extensions/toolset/db.ts`, `usage-recording.ts`, `usage-report.ts`, `types.ts` | SQLite recording, HTML report, usage clearing |
| Installer | `extensions/toolset/install.ts` | `/aftc-install` |
| Help | `extensions/toolset/help.ts` | `/aftc-help` command reference |
| Response divider | `extensions/toolset/response.ts` | Full-width themed rule above each assistant reply, `/aftc-response-divider` |
| Interrupt | `extensions/toolset/stfu.ts` | `/aftc-stop` and `/stfu` slash commands — emergency abort of current agent operation |
| Input clear | `extensions/toolset/input-clear.ts` | `alt+c` editor clear shortcut |
| SSH | `extensions/toolset/ssh.ts`, `internal-python-gui/` | AI-callable SSH tools and visible terminal GUI |
| Skill | `skills/cache-audit/` | Reusable cache audit workflow |
| Theme | `themes/cache-viz.json` | Green/cyan cache-oriented pi theme |

---

# License

[MIT](./LICENSE) · Author Darcey.Lloyd@gmail.com

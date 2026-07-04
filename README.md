# pi-aftc-toolset

[![GitHub release](https://img.shields.io/github/v/release/DarceyLloyd/pi-aftc-toolset)](https://github.com/DarceyLloyd/pi-aftc-toolset/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A productivity toolset for the [pi](https://pi.dev) CLI coding agent.

`pi-aftc-toolset` is a collection of tools for pi - from my point of view, essentials to assist with what I do on a daily basis and to get the most out of AI models.

## Recent updates
- Fixed skills in footer widget
- Added new line of info to footer widget
- Pruned skills: archived 18 SDLC pipeline skills (assess-impact, audit-code, define-success, dispatch-agents, edit-document, plan-refactor, publish-package, quick-fix, request-review, research-first, respond-review, security-review, smoke-test, write-document, plus git-workflow / guard-git / github / release-branch) to `.rar` files in `skills/`. The four git skills were merged into a single lean `/skill:git`. Reduces per-turn context cost since every skill's `description` is injected into the system prompt on every turn.
- **aftc-orange-viz** orange accented theme added (based on sea-shells theme)
- **/skill:bulk-read** skill - concatenate many files into one markdown for fast project-wide reads
- **/aftc-footer-report-timeframe** sets the footer's 4th-line time window (Today, 3h, 6h, 24h, 2d, 3d, 7d, 28d)
- **/theme** shortcut opens a theme picker
- **/cd** command added (change dir with new conext window or not without closing pi)
- **/stfu** or **/aftc-stop** (if the ML model goes into some repeat loop, just use /stfu to get out of it)
- Footer became a **Widget**
- Footer widget got some enhancements
- Major refactor of all components

## Main Features

- Live footer widget which displays cache hit rate, cache efficiency, context time and live cost tracking.
- Secure SSH GUI that keeps server credentials away from the AI.
- Usage reports with model rankings, trends and spending insights (ALPHA, in development).
- Cache diagnostics and profiling tools.
- Themed response divider above every assistant reply.
- Built-in cache-oriented theme.
- Keyboard shortcuts and productivity commands.
- Quick directory switching - jump to a fresh Pi session (or not) in another directory with `/cd`, no quit-and-relaunch needed.

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

**Note:** `pi install` typically doesn't install native runtime dependencies.
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

## Caching features

This extension does not change pi's caching - providers already
cache the prompt prefix automatically. What it adds is
**visibility and analytical tooling on top of caching**, so you
can see when the cache is helping, when it isn't, and why.

Specifically: a live hit-rate readout, prefix-shape hashing that
detects cache invalidations mid-session, a cache-write ROI
calculation, a per-tool token-cost breakdown that surfaces prefix
bloat, and a `cache-audit` skill that walks the model through
diagnosis. The `cache-viz` theme reinforces the cache metrics
visually. None of this exists in stock pi - these are diagnostics
the user would otherwise have to assemble from raw session JSONL.

---

## Footer Widget

A live diagnostics widget showing:

- Current model and thinking level
- Cache hit rate (turn + session)
- Context time
- Cost per minute/hour
- Token usage
- Tool and skill usage
- Thinking and response times
- AVG-window aggregates from the SQLite `turns` table
  (configurable time window via `/aftc-footer-report-timeframe`,
  default Today)

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

ALPHA - in development. The feature works but the output, schema, and
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
`ctx.abort()` under the hood and behave identically - `/stfu` is just
a short alias you can type in a hurry. When the agent is already
idle, you'll get a friendly "Agent is already idle - nothing to
stop." notification instead of a silent no-op.

---

## Quick Directory Navigation

Pi is locked to one working directory per session. `/cd` switches
to a different directory - interactively (preserve-or-fresh prompt,
tree picker with `←`/`→` navigation, drive listings, page-key
shortcuts, `/cd-set-max-depth [2-10]`) or via a direct path
argument. See **Quick directory navigation** under Feature Guides
for full usage.

---

## Included Themes

- **cache-viz** - cache-focused green/cyan colour scheme.
- **aftc-orange-viz** - orange-accented variant of the sea-shells palette (the AFTC default).

---

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
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
- `/theme` - open a theme picker. Pre-selects the active theme, supports arrow keys, PageUp / PageDown for page jumps, Ctrl+PageUp / Ctrl+PageDown for top / bottom, Enter to switch, Esc to cancel. Handles 100s of themes without losing place.

## Interrupt

- `/aftc-stop` - stop the current agent operation (escape a runaway thinking loop or stalled tool call).
- `/stfu` - short alias for `/aftc-stop`. Same action, fewer keystrokes.

## Navigation

- `/cd` - switch to a different directory. No args → interactive picker + preserve/fresh session prompt. With a path (`/cd ~/projects`, `/cd /abs/path`, `/cd ../foo`) → direct switch (always fresh).
- `/cd-set-max-depth [2-10]` - set the `/cd` picker listing depth (default 3). Pass a number, or run with no args to pick from 2–10.

## Footer Widget, Cache, Costs, Stats +

- `/aftc-footer`
- `/aftc-footer-report-timeframe` - set the footer 4th-line time window: Today, 3h, 6h, 24h, 2d, 3d, 7d, 28d (default: Today)
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

- `/usage-report` (ALPHA in development)
- `/usage-clear`

---
---
---

# Feature Guides

## Model, Cache, Costs and usage Footer Widget

The footer widget is a four-line diagnostic panel (not pi's
footer), so it composes alongside other footer/status-bar extensions
(e.g. pi-bar) instead of replacing them. It updates live from pi
events and a 1Hz session sampler. Toggle it with `/aftc-footer`.

What each line shows:

| Line | Shows |
| --- | --- |
| 1 | Model, thinking level, latest-turn cache hit rate, session-average hit rate, trend arrow, context window, IO token totals, last-turn cache split |
| 2 | Last-turn cost, context-session total cost, user-prompt count, total model calls, context time, burn rate |
| 3 | Active tool count/token estimate, skills `used/available` (pulled into context this session vs loaded in `<available_skills>`), thinking time, response time |
| 4 | AVG-window aggregates from the SQLite `turns` table over a configurable time window: cost, prompts/turns, **average** cache hit rate, average thinking time, average response time |

Line 4's time window is configurable via `/aftc-footer-report-timeframe`.
Options: Today (default, local 00:00 to now), 3h, 6h, 24h, 2d, 3d,
7d, 28d. The selection persists across `/reload`, `/new`, and
fresh pi startup (stored as a user preference in
`.pi-aftc-toolset/data/state.json`). The label is shown in the
footer as `AVG <label>: ...`. Refreshed at most every 10s from
SQLite so the DB isn't hammered on every render tick.

### How cache hit rate is calculated

pi reports `input` as **new prompt tokens** only. `cacheRead` is
the cached prefix served by the provider. The hit rate is:

```text
cacheRead / (cacheRead + input)
```

| Rate | Meaning |
| --- | --- |
| `Cache Turn` | Latest assistant turn only - useful for spotting immediate cache misses |
| `AVG` | Whole-session average - better for long-term cache health |

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
  the local Python GUI only** - never in the pi editor, never in a
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
| --- | --- |
| `ssh_status` | Check whether the GUI is reachable and connected |
| `ssh_connect` | Launch GUI, connect to `user@host[:port]`, optionally run an initial command |
| `ssh_run` | Execute a non-interactive shell command on the connected server |
| `ssh_peek` | Read recent output from the API buffer or the full `std/out.txt` log |
| `ssh_interrupt` | Send repeated Ctrl+C/Ctrl+D to break hung commands |

### SSH safety notes

- Avoid interactive commands such as `vim`, `nano`, `top`, or
  anything that waits for keystrokes through `ssh_run` - they
  will hang. Use non-interactive alternatives.
- Use `ssh_peek` with `mode: "file"` to inspect the full session
  history.
- SSH logs and std files live under `internal-python-gui/std/`
  and are gitignored - they never get committed.

---

## Quick directory navigation

`/cd` switches the current Pi session to a different directory in
two stages.

### Stage 1 - preserve or fresh session

When invoked with no arguments, `/cd` first asks whether to
**preserve** the current session (resume the most recent session
for the target directory - the existing session file is kept
intact and not overwritten, so conversation history carries over)
or to start **fresh** (a brand-new empty session in the target
directory). The choice is held in memory and only applied once a
target directory has been picked - cancelling the picker at stage
2 leaves the current session untouched.

### Stage 2 - directory listing and navigation

After stage 1, the picker shows a tree-style directory listing
rooted at the current working directory:

- The header line shows the directory currently being browsed.
- Direct children of that directory are listed first, with
  descendants up to a configurable max-depth (default 3, settable
  via `/cd-set-max-depth [2-10]`).
- There is no `..` row - up-navigation is exclusively via the
  **←** key. At the drive root, **←** switches to a drives
  listing (Windows: A–Z; POSIX: `/`).
- The listing is **unbounded** (no entry-count cap). The viewport
  scrolls so the selected row is always visible.

#### Controls:

- **↑ / ↓** move selection.
- **←** navigate up one level (or to drive listing at root).
- **→** drill into the highlighted folder (refreshes the
  listing). No-op on empty folders.
- **Enter** confirm the highlighted entry. On an empty listing,
  selects the current folder.
- **PgUp / PgDn** jump by the visible viewport size.
- **Ctrl+PgUp / Ctrl+PgDn** jump to the first / last entry.
- **Tab** autocomplete the highlighted entry into the path
  input.
- **Esc** cancel without switching.
- **Type + Enter** if the typed text doesn't match any result,
  treated as `/cd <text>` (resolves `~`, absolute, relative, or
  prompts to create + switch if missing).

### One-shot path argument

`/cd <path>` skips both stages. Supported forms:

- `/cd ~/projects` home-relative.
- `/cd /d/dev/myproject` absolute (Windows or POSIX).
- `/cd ../sibling-project` relative to current cwd.
- `/cd brand-new-project` creates the directory after a confirm
  dialog if it doesn't exist.

The one-shot form always starts a fresh session.

### Cross-platform

- **Windows** drive listing probes A→Z via `fs.readdirSync`.
- **POSIX** (Linux/macOS) drive listing returns `["/"]`.
- Path joining, dirname, and basename go through Node's `path`
  module, so separators are OS-correct (`\` on Windows, `/` on
  POSIX). The header line is shortened with `~` on POSIX.

Adapted from the MIT-licensed `pi-move` extension by k3-2o.

---

## Usage Report

ALPHA - in development. Output, schema, and defaults may change before
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

- **Section 1 - Daily totals (last 24 hours)** - four cards:
  most used (derived from base prompts), most inefficient (derived
  from turns/self-prompting), highest avg cost (derived from base +
  sub prompts), lowest avg cost (derived from base + sub prompts).

- **Section 2 - Weekly totals (last 7 days)** - same four cards,
  with a **weekend toggle** to include/exclude Sat/Sun.

- **Section 3 - Monthly totals (last 28 days)** - same four cards,
  with a weekend toggle.

- **Section 4 - Per-model cost report** - sortable table with a
  period selector (Daily / Weekly / Monthly / All time, default
  All time).

- **Section 5 - Per-model × thinking level** - same shape as
  Section 4 but keyed by model + thinking level, so a single model
  has one row per thinking level used.

- **Section 6 - Cost projections** - per model × thinking level:
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
recorded** - only classification flags. This keeps the DB small
(one row ≈ ~100 bytes) and avoids storing anything sensitive.

### Thin-data handling

The tool may have only a few minutes or hours of recorded data.
Projections use `max(0.5h, active hours)` as the denominator so a
single turn never produces a divide-by-zero, and any projection
based on fewer than ~14 calendar days is flagged as an estimate.

#### Per-row columns

| Column | Type | Meaning |
| --- | --- | --- |
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

These flag the *kind of trigger* for the assistant turn - **not
the content of the prompt**. They're either `0` (false) or `1`
(true) unless noted.

| Column | Meaning |
| --- | --- |
| `user_prompt` | `1` if this assistant turn is a direct response to a user message. `0` for automated tool-call continuation rounds. |
| `base_prompt` | `1` if this is the first user prompt of a task (top-level, drives projections). Always `0` when `user_prompt = 0`. |
| `sub_prompt` | `1` if this is any follow-up / refinement under the current task. Always `0` when `user_prompt = 0`. |
| `steering_prompt` | `1` if the user sent this sub-prompt while the agent was still actively processing the previous one (pi's `steer()`). |
| `followup_prompt` | `1` if the user queued this sub-prompt to be delivered after the agent finished (pi's `followUp()`). |
| `continuation_prompt` | `1` if this is an idle follow-up / refinement sent in the same task thread. |
| `prompt_kind` | text - see table below. |

#### `prompt_kind` values

The `prompt_kind` column carries a single human-readable label
for the trigger. It's redundant with the `*_prompt` flag columns
(those flags are derived from the same source) but it's a useful
denormalised index for sorting and grouping in the report.

| `user_prompt` | `prompt_kind` | Meaning |
| --- | --- | --- |
| 1 | `base` | First user prompt of a task (top-level, drives projections). |
| 1 | `continuation` | Idle follow-up / refinement in the same task thread. |
| 1 | `steer` | Sub-prompt sent while the agent was still actively processing the previous one. |
| 1 | `followup` | Sub-prompt queued in the editor and delivered after the agent finished. |
| 0 | `auto` | Automated tool-call continuation round - no new user input between this and the prior turn. |

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
each user prompt - lower is better (`1.0` means one prompt
produced one call; high values mean tool-call loops).

Clear all recorded usage with:

```text
/usage-clear
```

---

## Cache Diagnostics

Two commands give you deeper cache insight than the footer alone:

- `/cache-profile` - per-tool token costs, prefix shape hashes,
  system prompt size, and churn analysis. Shows which tools are
  expensive and whether the prefix is stable.
- `/cache-stats` - session cache stats, cache-write ROI,
  SQLite-backed projections, model spend, and prefix details.
- `/cache-reset` - zeroes in-memory accumulators (tokens, cost,
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
---
---




# Skills

### Version control

- `/skill:git` git operations, Conventional Commits, branch naming, destructive-command safety rails, `gh` CLI for issues/PRs/CI, and the merge/PR/keep/discard ship decision. (Consolidates the former `git-workflow`, `guard-git`, `github`, and `release-branch` skills.)

### Shell scripting

- `/skill:bash` bash scripting conventions
- `/skill:ps1` PowerShell scripting
- `/skill:bat` Windows batch scripting
- `/skill:tmux` remote control tmux sessions for interactive CLIs

### Web frontend

- `/skill:html` HTML5 markup, accessibility, ARIA
- `/skill:css` CSS3 conventions, responsive design
- `/skill:scss` SCSS / Sass preprocessing
- `/skill:web-frontend` HTML / CSS / JS / a11y / perf workflows
- `/skill:react` React with hooks, Vite, Next.js
- `/skill:vue` Vue 3 Composition API, Pinia
- `/skill:angular` Angular standalone components, signals

### JavaScript / TypeScript

- `/skill:nodejs` Node.js scripts, npm, stdlib-first
- `/skill:javascript-mjs` ES modules (.mjs)
- `/skill:javascript-transpiled` transpiled JS output
- `/skill:typescript` TypeScript strict mode, ESM, MVC patterns
- `/skill:bun` Bun runtime
- `/skill:deno` Deno runtime

### Backend languages

- `/skill:python` Python with uv, stdlib-first
- `/skill:go` Go programming
- `/skill:csharp` C# / .NET with dotnet CLI
- `/skill:php` PHP 8.2+ with Composer

### Infrastructure and ops

- `/skill:docker` Docker, docker-compose, Dockerfiles
- `/skill:devops` CI/CD, IaC, deployment, databases
- `/skill:nginx` nginx configuration
- `/skill:linux` Linux sysadmin

### Media

- `/skill:ffmpeg` ffmpeg CLI for video, audio, image processing

### Documentation

- `/skill:markdown-guide` AI-friendly markdown formatting for documentation .md files (READMEs, SKILL.md, rules.md, AGENTS.md)

### Other

- `/skill:pinescript` - Pine Script v6 (TradingView). Skill content targets v6 specifically; v5 has different syntax for some features.
- `/skill:cache-audit` prompt-cache diagnostics workflow
- `/skill:bulk-read` - concatenate many files into one markdown document. Triggers on "read all files", "analyze the project", "load every file", "concatenate files", "audit the code", and similar. The skill bundles a Node.js script that walks the tree, skips noise dirs and binary files, and emits a single markdown file with `FILE: <abs-path>` headers plus fenced code blocks. The agent then reads that one file instead of N separate `read` calls.

> Previously bundled SDLC pipeline skills (assess-impact, audit-code, define-success, dispatch-agents, edit-document, plan-refactor, publish-package, quick-fix, request-review, research-first, respond-review, security-review, smoke-test, write-document, and the former git skills git-workflow / guard-git / github / release-branch) have been archived as `.rar` files in `skills/` and removed from the live skill set to reduce per-turn context cost. The four git skills were merged into the single `/skill:git` above.

---
---
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
extensions/toolset/theme.ts              /theme shortcut to pi's theme picker
internal-python-gui/main.py             local SSH GUI/API
skills/cache-audit/SKILL.md             bundled cache-audit skill
skills/bulk-read/SKILL.md               bundled bulk-read skill (Node.js script inline)
themes/cache-viz.json                   cache-oriented pi theme (green/cyan)
themes/aftc-orange-viz.json             orange-accented pi theme
```

Each TS file has a sibling `<name>.readme.md` documenting its
contract (events, commands, factory signature, failure modes). See
`extensions/toolset/readme.md` for the folder-level overview, and
`rules.md` for the source-of-truth development conventions.

## Tests

Tests live under `tests/` (one subfolder per test, dependency-free -
`node` + pi's bundled jiti + `better-sqlite3` only):

```bash
node tests/parse-check/parse-check.mjs          # jiti parses usage-report.ts
node tests/full-check/full-check.mjs            # DB + projections + HTML structure
node tests/widget-render-check/widget-render-check.mjs  # orchestrator + footer widget + ticker
node tests/stfu-check/stfu-check.cjs            # /aftc-stop + /stfu: idle / streaming / headless
node tests/bulk-read-check/bulk-read-check.mjs  # bulk-read skill: script extract + walk + manifest
node tests/theme-check/theme-check.cjs        # /theme: register, pick, cancel, setTheme-fail, no-UI
node tests/state-check/state-check.cjs        # state.json (defaults generation, get/set, persistence)
node tests/load-test/load-test.cjs              # end-to-end: factory + events + commands + SQLite
```

## Persistent files

Project-local runtime data is stored under `.pi-aftc-toolset/data/`:

| File | Purpose |
| --- | --- |
| `state.json` | Cross-session user preferences (footer AVG timeframe, footer on/off, response divider on/off). Created with defaults on first access; only re-written when a preference actually changes. Persists across `/reload`, `/new`, and fresh pi startup. |
| (in-memory only) | Cache accumulators, model info, per-turn timings, and the context-window clock start time. All per-session; reset on every `session_start`. Not persisted — there is no per-session resumption state anymore. |
| `turns.db` | SQLite usage database |
| `report.html` | Latest generated usage report |

SSH GUI runtime files are stored under `internal-python-gui/std/`:

| File | Purpose |
| --- | --- |
| `out.txt` | ANSI-stripped terminal output / session log |
| `in.txt` | Command input log |
| `err.txt` | Error output / logs |

All runtime data and logs are gitignored - they never get committed.

## What is included?

| Area | Files | What it provides |
| --- | --- | --- |
| Extension orchestrator | `extensions/toolset/index.ts` | Loads the suite modules into pi and wires the footer data provider to the widget |
| Cache / timing data | `extensions/toolset/core.ts` | Cache diagnostics, timer commands, `/cls` |
| Cache footer widget | `extensions/toolset/footer-widget.ts` | Renders the four-line cache dashboard, owns `/aftc-footer` toggle |
| Usage DB + report | `extensions/toolset/db.ts`, `usage-recording.ts`, `usage-report.ts`, `types.ts` | SQLite recording, HTML report, usage clearing |
| Installer | `extensions/toolset/install.ts` | `/aftc-install` |
| Help | `extensions/toolset/help.ts` | `/aftc-help` command reference |
| Response divider | `extensions/toolset/response.ts` | Full-width themed rule above each assistant reply, `/aftc-response-divider` |
| Interrupt | `extensions/toolset/stfu.ts` | `/aftc-stop` and `/stfu` slash commands - emergency abort of current agent operation |
| Input clear | `extensions/toolset/input-clear.ts` | `alt+c` editor clear shortcut |
| Theme picker | `extensions/toolset/theme.ts` | `/theme` slash command - shortcut to pi's theme picker |
| SSH | `extensions/toolset/ssh.ts`, `internal-python-gui/` | AI-callable SSH tools and visible terminal GUI |
| Skill | `skills/` (31 live skills) | Reusable workflows: project flagship `cache-audit` and `bulk-read`, plus a consolidated `git` skill and language/runtime/domain skills (typescript, python, pinescript, ffmpeg, docker, etc.). See the Skills section above for the full list. |
| Theme | `themes/cache-viz.json`, `themes/aftc-orange-viz.json` | Green/cyan and orange-themed pi themes |

---

# License

[MIT](./LICENSE) · Author <Darcey.Lloyd@gmail.com>

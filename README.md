# **pi-aftc-toolset**

<!-- last-reviewed: 2026-08-05 22:05 -->

Stats bar. Isolated SSH. Documentation generation (docx). Persistent
self-educating cache-aware skills on demand (codex). Usage reports. Audio
notifications. Shortcuts. Skills. Themes ++

A productivity extension package for [pi](https://pi.dev)
(`@earendil-works/pi-coding-agent`): install it, run `/aftc-install`, and
pi grows a cache/cost diagnostics footer, a persistent usage database with
an HTML report, credential-isolated SSH tooling for the model and for you,
an opt-in knowledge base, a documentation generator, and a long tail of
workflow conveniences.

---

## **WHATS NEW**

### **/docx project documentation generator (BETA 4)**

The generation prompt is now tailored by project type: after the
confirmations a picker modal (auto-detect pre-selected) asks for the
closest stack and ONE focused type pack is appended to a slim core prompt
(10 packs: web-app, basic-website, webgpu-webgl, desktop-app, juce-vst,
mobile-app, python-app, cli-tool, shell-scripts, generic). The generated
layout changed: `docx/` IS the documentation folder — the docs tree mirrors
the structure map as `<id>_<name>/` folders, every reachable surface gets
its own build-ready doc, and old docs are recon hints only (source wins).
The hard context gate dropped from 50% to 25% — `/new` first above that,
even with `--yes`.

### **Clean console by default**

The `[aftc-toolset]` diagnostic chatter no longer prints by default
(`debugLoggingEnabled`, `/aftc-debug-log-on|off`). Every diagnostic line is
still captured in `<data dir>/debug.log` (rotating 5 MB), and errors ALWAYS
print.

### **AFTC CODEX UPDATES**

`/codex` menu simplified (Codex Enabled / Inject Thought Guidance /
Auto-Detect & Load Docs / Auto Sync Codex Update on Startup / Resources &
Updates); the phantom "outdated" warning is gone; auto-sync now runs on the
first session start of any kind; `/codex-live-to-seed` bumps the shipped
codexVersion itself when it wrote seed files. Shipped codex version: **7**.

---

## **Install**

### **Option 1 - npm (recommended)**

```bash
pi install npm:pi-aftc-toolset
```

Then in pi:

```text
/aftc-install     # installs better-sqlite3 + packaged SSH carrier deps (python)
/reload
```

> **Runtime dependencies:** `pi install` does not install all the required
> runtime deps. Run `/aftc-install` after extension installation.

---

<br><br>

# **Quick Documentation & Links**
- [**Footer Widget**](#footer-widget)
- [**SSH**](#ssh)

- [**DOCX Documentation Generator (BETA 4)**](#docx-project-documentation-generator)
    > **WARNING: This will re-write readme.md and move all existing documentation.**
    If you have a docs folder it will move all documentation to `./docx/old_docs.zip` before generating in-depth modular documentation designed for AI use while staying human-friendly. This can take a long time the larger the project is.

    > **NOTE: run `/new` first, then `/docx`** — a fresh session means no compaction risk mid-generation and no prior conversation steering the docs. `/docx` flat-out refuses at 25%+ context use (even with `--yes`) and advises a fresh session at 20%+. Context use itself is modest — measured runs used only 5–8% of a 1M-token window and even large projects stayed under 20% — but expect a LONG wait: the bigger and more complex the project, the longer it takes.

- [**Usage Report**](#usage-report) (ALPHA)
- [**AFTC Codex**](#aftc-codex-knowledge-base)

    > **WARNING**: AFTC Codex injects rules + guidance into your system prompt and tells the model to load additional topic docs on demand. This results in the model having access to potentially a lot of rules, issues & solutions and gotchyas. Loading 1 to 5 is light enough, loading 20 can be costly but necessary when you have something complex that you want the AI to have its best shot at working out and one shotting it.

    > I recommend you create a plan.md and a tasks.md first so that you can maximise your use of the codex skills.

- [**Audio notifications**](#slash-commands) /aftc-notifications
- [**Slash commands**](#slash-commands) /aftc-* /codex-*
- [**Keyboard shortcuts**](#keyboard-shortcuts) Alt+C / Alt+N / Alt+X
- [**run_script**](#run_script-reliable-large-scripts)

    > Reliable large/multi-line script execution. Works around a pi bash-tool truncation bug that silently drops inline commands past a few KB.
- [**Cache diagnostics**](#cache-diagnostics)
- [**Bundled skills**](#bundled-skills)
- [**Feature defaults**](#pi-aftc-toolset-defaults)
- [**Data location**](#data-location)
- [**Advanced installation and uninstall guide**](#advanced-installation)
- [**Project documentation**](#project-documentation)

---

<br><br>

## **Footer widget**

![Footer widget](images/footer-widget.png)

A themed dashboard bar below the editor (`/aftc-footer` to configure:
enable, averages line, timeframe). Lines 1–4 always available; line 5 only
for supported subscription providers.

### Line 1 — what's happening right now

Model name + thinking level, context window size with pi's own context-use
%, last-turn cache hit vs session average (with trend arrow), and the
session's cached vs new token split.

### Line 2 — your money and prompts

User vs AI prompt counts, last turn cost, live Task Time, Session Time
(wall-clock since your first prompt), Session Time Cost, and the burn rate
($/hr and $/min).

### Line 3 — speed and tools

Turn thinking time and response time (last + averages), active tool count
with estimated schema tokens, and skills used/available.

### Line 4 — long-term averages

Prefixed with the chosen window (eg `3 Day Averages:`), from the persistent
usage DB: total cost, window prompt sums (User/AI), average cache hit %,
and Avg Task Time (completed tasks only). 19 windows via `/aftc-footer` →
Set averages timeframe: ten rolling "Last …" windows (1h–72h) and nine
calendar-anchored windows (1 Day → 1 Year).

### Line 5 — subscription quota (some providers only)

5-hour rolling + weekly allowance usage with live reset countdowns.
Supported: ChatGPT/Codex (OAuth), Anthropic (OAuth subscription headers),
MiniMax Token Plan, ZAI/GLM Coding Plan, Kimi for Coding. All other
providers: the line stays hidden.

---

<br><br>

## **SSH**

Operate remote servers from pi — model tools for the AI, slash commands
for you, a full-screen interactive terminal for hands-on work. Everything
runs through a packaged Python (Paramiko) carrier over local stdio — it
opens **no** listening socket.

### Ensure dependencies are installed

```text
/aftc-install
```

Installs/verifies the carrier environment: Python 3 + `uv` + `uv sync
--locked` of the packaged sidecar.

### **SSH commands**

| Command | What it does |
| --- | --- |
| `/ssh-cm` (alias `/ssh-connection-manager`) | Full-screen connection manager: add / edit / delete saved connections |
| `/ssh-connect [name]` | Connect a saved connection (quotes for names with spaces; no name → picker) |
| `/ssh-connections` | List saved connection names |
| `/ssh-status` | Show connection status |
| `/ssh-select [id]` | Select the active session for local commands |
| `/ssh-disconnect [id]` | Disconnect a session |
| `/ssh-shell` | Open the full-screen interactive terminal on the selected session |
| `/ssh-close-shell <id>` | Close an interactive shell |
| `/ssh-interrupt <id>` | Send Ctrl+C + Ctrl+D recovery keys to a shell |
| `/ssh-upload <local> <remote> [--preserve]` | Upload a file (overwrite confirmation; `--preserve` keeps attrs) |
| `/ssh-download <remote> <local> [--preserve]` | Download a file (overwrite confirmation) |
| `/ssh-rename <from> <to>` | Rename a remote path after confirmation |
| `/ssh-auto-accept-session-on` / `-off` | Trust NEW host keys without asking / restore the prompt (changed keys are always rejected) |
| `/ssh-help` | SSH workflow guidance |

### How to manage connections

`/ssh-cm` opens the connection manager: `[ Add new connection ]`,
`[ Edit ]`, `[ Delete ]`. The add dialog collects name, username, host,
port (22), timeout (30 s), optional key path and optional password (saved
locally, never exposed to the model).

### How to connect

`/ssh-connect [name]` — or just ask the model, which uses `ssh_connect`.
New host keys ask for approval (or auto-accept when enabled).

### How to disconnect

`/ssh-disconnect [id]` — or the model's `ssh_disconnect`. Idle carriers are
reaped automatically and re-spawned on demand.

### Run commands and pick a session

`/ssh-select` chooses the session the local commands act on. For driven
work, the model uses `ssh_run` (bounded, 120 s max timeout, optional
bounded stdin — never for credentials).

### Interactive shells

`/ssh-shell` opens a full-screen terminal (nano, vim, htop, top, less all
render properly). All keys go to the remote program — including Esc;
**Ctrl+] exits locally**. The model drives programs through
`ssh_open_shell` + `ssh_send_keys` / `ssh_paste` / `ssh_peek` /
`ssh_resize` / `ssh_interrupt` / `ssh_close`.

### Transfer files

`/ssh-upload` + `/ssh-download` (or the model's `ssh_upload` /
`ssh_download`): files or whole directory trees, symlinks never followed,
cancellable, `--preserve` restores timestamps/permissions.

### Manage remote files

Model tools: `ssh_list_dir`, `ssh_read_file`, `ssh_stat`, `ssh_write_file`,
`ssh_mkdir`, `ssh_rename`, `ssh_remove` — every mutation needs local-user
approval.

### Model tools

20 tools: `ssh_status`, `ssh_connect`, `ssh_disconnect`, `ssh_run`,
`ssh_open_shell`, `ssh_send_keys`, `ssh_paste`, `ssh_resize`, `ssh_close`,
`ssh_peek`, `ssh_interrupt`, `ssh_upload`, `ssh_download`, `ssh_list_dir`,
`ssh_read_file`, `ssh_stat`, `ssh_write_file`, `ssh_mkdir`, `ssh_rename`,
`ssh_remove`. A bundled `ssh` skill teaches the model the workflow.

### Credential isolation

Connections are saved in your local `ssh.json`; the model only ever sees
saved NAMES and opaque session/shell ids. Credentials are collected by
local prompts, all model-facing output is redacted, and errors are mapped
to safe categories (timeout, cancelled, not connected, unavailable) — no
host/port/key diagnostics ever reach the model.

---

<br><br>

## **Think-tag processing**

Models that emit thinking as inline `<think>…</think>` text tags (the
DeepSeek/Qwen convention) get those tags converted into pi's native
collapsible thinking blocks at message-finalize time. Off by default:
`/aftc-enable-think-processing` / `/aftc-disable-think-processing`. Safe by
construction: skips messages that already have thinking blocks, errored /
aborted turns, and provider-signed text.

---

<br><br>

## **QwenCloud / Alibaba providers**

Currently **disabled** — pi 0.81+ registers providers natively. The module
(Qwen Cloud/DashScope + Qwen Coding Plan via pi's native `/login`, live
model catalogs, `/qwencloud` command) stays in the package and can be
re-enabled in `index.ts` if the built-in proves weaker.

---

<br><br>

## **Cache diagnostics**

Everything the footer shows, on demand:

- `/cache-profile` — per-tool schema token costs, skills loaded, cache
  prefix shape (system/tools/prefix hashes), churn analysis.
- `/cache-stats` — session cache statistics, cache-write ROI (net saved,
  payback turns), cost burn rate.
- `/cache-reset` — zero the accumulators (debugging).
- `/cls` — clear the terminal screen.

Hit-rate formula: `cacheRead / (cacheRead + input)` — pi's `input` is NEW
prompt tokens only. Prefix churn (system prompt or tool schema changes
breaking the cache) is detected per turn and warned.

---

<br><br>

## **Usage report**

`/usage-report` writes a self-contained HTML report (the only external ref
is the Chart.js CDN — tables work offline) to your data dir and opens it
in your browser. Every assistant turn is recorded as metrics only —
**never prompt or response text**. `/usage-clear` wipes the database behind
a confirmation.

![Usage report overview](images/ur-overview.png)

Five tabs:

| Tab | Contents |
| --- | --- |
| **Overview** | Headline cards (total cost, prompts, calls, cache hit, active days), 30-day spend chart, cost-share doughnut, 24h/7d/28d summaries with per-model scoreboards |
| **Models** | Per-model sortable table + period selector + cost-by-model chart, Task Time column |
| **Thinking levels** | Per-model × thinking-level table + period selector |
| **Timings** | Task Time analysis: avg/longest task, turns per task, error/abort counts, think/respond/overhead split, user vs AI turns, top-10 longest tasks |
| **Projections** | Burn rate ($/day, projected month/year) + per-model × thinking projections from spend ÷ active days |

![Models tab](images/ur-models.png)
![Thinking levels tab](images/ur-thinking-levels.png)
![Timings tab](images/ur-timings.png)
![Projections tab](images/ur-projections.png)

---

<br><br>

## **aftc-codex (knowledge base)**

An OPT-IN, self-educating knowledge base: the maintainer's unified rules +
thinking guidance + a generated resource list ride your system prompt, and
the model fetches topic docs on demand with `codex_load` (aliases: ts, py,
js; specials: rules, guidance, list, markdown).

- `/codex` — settings menu (enable, guidance inject, auto-detect & load,
  auto-sync on startup, resources & updates).
- `/codex-enable` / `/codex-disable` — first enable asks: **Pre-trained**
  (rules + ~27 topic docs) or **Fresh Start**.
- `/codex-init` / `/codex-refresh` — prep the session (auto-detects your
  project's stack and loads the relevant docs) / strip + re-prep.
- `/codex-status` — state, resource counts, version row.
- `/codex-sync` — NON-DESTRUCTIVE update: merges new shipped content into
  your live codex; learned entries are never touched.
- `/codex-install` — wipe + fresh re-seed.
- `/codex-learn` — record durable lessons via the `codex_add_entry` /
  `codex_edit_entry` / `codex_remove_entry` tools (IDs generated, formats
  validated, generality + secrets guards enforced).
- `/codex-inject-rules` — session-only critical-rules injection (works
  even when disabled; cleared by `/new`).

Your live copy lives in your data dir (`aftc-codex/`); the shipped seed is
versioned (`codexVersion` 7) and merges forward automatically on startup
when Auto Sync is on.

---

<br><br>

## **/docx project documentation generator**

Regenerates a project's full documentation set: a fresh GitHub README
(written last), plus `./docx/` — master document, structure map, and a
mirrored tree of ID-prefixed deep docs — per the shipped documentation
guide. Before anything is generated, existing documentation is moved to
`./docx/old_docs/` (zipped to `old_docs.zip` at the end); AGENTS.md is
edited in place, never replaced.

```text
/docx                # confirmations + project-type picker (auto-detect pre-selected)
/docx --yes          # headless: skip confirmations
/docx --type <key>   # headless: pick the prompt pack
```

Safeguards: refuses at ≥25% context use (compaction-corruption risk),
advises `/new` at ≥20%, verified backup counts, sub-project folders stay
read-only.

---

<br><br>

## **run_script (reliable large scripts)**

The `run_script` model tool writes the script body to a temp file and runs
`bash <file>` — no inline-size limit, working around pi's bash-tool
truncation bug (a few KB+ inline commands get silently cut). Bash-only
(git-bash on Windows); default timeout 120 s, max 1800 s. Toggle:
`/run-script-on` / `/run-script-off` (default on).

---

<br><br>

## Bundled skills

34 skills ship with the package — activate with `/skill:<name>`:

- **Workflows:** `cache-audit`, `bulk-read`, `aftc-codex`, `ssh`, `tmux`
- **Languages:** `typescript`, `javascript-mjs`, `javascript-transpiled`,
  `python`, `go`, `php`, `pinescript`, `bash`, `bat`, `ps1`, `markdown`,
  `csharp`
- **Frameworks/runtimes:** `react`, `vue`, `angular`, `web-frontend`,
  `bun`, `deno`, `nodejs`
- **Styling/markup:** `html`, `css`, `scss`
- **Ops:** `docker`, `devops`, `nginx`, `linux`, `godot`
- **Media:** `ffmpeg`

---

<br><br>

## Slash Commands

Run `/aftc-help` inside pi for the same list grouped by category.

### General

| Command | What it does |
| --- | --- |
| `/aftc-help` | Grouped command/shortcut reference |
| `/aftc-install` | Install runtime deps (SQLite + packaged SSH carrier) |
| `/aftc-response-divider` | Toggle the themed divider above each assistant reply |
| `/aftc-intro-off` | Disable the AFTC text startup animation |
| `/aftc-intro-on` | Enable and play the AFTC text startup animation |
| `/cls` | Clear the terminal |
| `/theme` | Open a theme picker (arrow keys, page jumps, live preview, pre-selects active theme) |
| `/run-script-on` | Enable the `run_script` tool (reliable large-script execution); `/reload` to apply |
| `/run-script-off` | Disable the `run_script` tool (eg once pi fixes its bash truncation); `/reload` to apply |
| `/aftc-debug-log-on` | Turn on `[aftc-toolset]` diagnostic console output (off by default; errors always print) |
| `/aftc-debug-log-off` | Turn diagnostic console output back off |
| `/aftc-cut-input` | Cut all input-editor text to the clipboard (same as `Alt+X`) |
| `/docx [--yes] [--type <key>]` | Regenerate the project's full documentation set into `./docx/`; old docs zipped to `docx/old_docs.zip` (`--yes` skips the confirmations, `--type` picks the prompt pack) |

### Interrupt

| Command | What it does |
| --- | --- |
| `/aftc-stop` | Abort the current agent operation |
| `/stfu` | Short alias for `/aftc-stop` |

### Navigation

| Command | What it does |
| --- | --- |
| `/dir` (alias `/ls`) | Show the current directory name + platform-native listing |
| `/cwd` | Show the current working directory as an inline card |
| `/qd` | Quick dir access menu: open the users data dir or the `.pi` dir |

### Footer, cache, timing

| Command | What it does |
| --- | --- |
| `/aftc-footer` | Open the footer dashboard menu: Enable footer (ON/OFF), Show recorded averages (ON/OFF — the line-4 averages), Set averages timeframe (19 rolling / calendar windows) |
| `/cache-profile` | Per-tool token costs, prefix shape, churn analysis |
| `/cache-stats` | Current-context cache diagnostics + cost rate |
| `/cache-reset` | Zero accumulators and timer (debugging) |

### SSH

See the [SSH](#ssh) section for the full command reference, model tools, and workflows.

### Usage

| Command | What it does |
| --- | --- |
| `/usage-report` | Write + open `report.html` (ALPHA) |
| `/usage-clear` | Delete all SQLite rows (with confirmation) |

### Replay

| Command | What it does |
| --- | --- |
| `/save-replay-prompt <text>` | Save `<text>` as a replay prompt (persists across reload/sessions) and add a visual save confirmation to conversation history |
| `/replay` | Re-execute the saved prompt as a fresh user message (queued as follow-up when busy) |
| `/r` | Short alias for `/replay` — same action, fewer keystrokes |

### Model behaviour

| Command | What it does |
| --- | --- |
| `/keep-it-short` | Send a fixed "be concise" instruction prompt to the active model (queued as follow-up when busy) |
| `/kis` | Short alias for `/keep-it-short` — same action, fewer keystrokes |

### Thinking

| Command | What it does |
| --- | --- |
| `/aftc-enable-think-processing` | Turn on inline `<think>…</think>` tag parsing (off by default; `/reload` to apply) |
| `/aftc-disable-think-processing` | Turn off inline `<think>…</think>` tag parsing (`/reload` to apply) |

### Audio notification

| Command | What it does |
| --- | --- |
| `/aftc-audio-notifications` (alias `/aftc-notifications`) | Settings hub: enable toggle + per-category sound pickers (startup, question, task-complete, error, aborted, context 25/50/75%) + open the sounds dir |
| `/aftc-notify-time [sec]` | Show or set the minimum task duration before the completion sound (0 disables) |

### aftc-codex

See the [aftc-codex](#aftc-codex-knowledge-base) section — `/codex`,
`/codex-enable`, `/codex-disable`, `/codex-init`, `/codex-refresh`,
`/codex-status`, `/codex-install`, `/codex-sync`, `/codex-learn`,
`/codex-inject-rules` (+ `/aftc-codex-*` full names).

### Providers

Currently **disabled** — pi now registers providers natively. The module stays in the package and can be re-enabled in a future release.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+C` | Clear the input editor |
| `Alt+N` | Insert a newline at the cursor |
| `Alt+X` | Cut all input text to the clipboard |
| `Ctrl+T` | Toggle thinking blocks (pi built-in) |

### Bundled themes

- **aftc-orange-viz** - orange-accented variant of the sea-shells palette (the AFTC default, recommended).
- **cache-viz** - cache-focused green/cyan colour scheme.
- **aftc-black-n-blue** - dark blue accents on black.

Switch themes with `/theme`.

---

<br><br>

## PI AFTC Toolset Defaults

| Feature | Default state |
| --- | --- |
| Footer widget | Enabled |
| Footer averages line (line 4) | Enabled |
| Footer timeframe | 3 Days |
| SSH | Available (command-driven) |
| Usage recording | Enabled (when SQLite installed) |
| aftc-codex knowledge base | Disabled |
| Codex guidance inject / auto-load / auto-sync | Enabled (once codex is on) |
| Audio notifications | Disabled (fresh installs silent) |
| run_script tool | Enabled |
| Think-tag processing | Disabled |
| Response divider | Enabled |
| AFTC text intro | Enabled |
| Debug logging (stdout chatter) | Disabled (errors always print) |

---

<br><br>

## Data location

The toolset stores its runtime data — usage history (`turns.db`), preferences (`config.json`), saved SSH connections (`ssh.json`), the live codex (`aftc-codex/`), the debug log (`debug.log`) and the generated report (`report.html`) — in a per-user folder **outside** the installed package, so it survives `pi update`. Location per operating system:

| OS | Data folder |
| --- | --- |
| **Windows** | `%APPDATA%\pi-aftc-toolset\data\` (eg `C:\Users\<you>\AppData\Roaming\pi-aftc-toolset\data\`) |
| **Linux** | `$XDG_DATA_HOME/pi-aftc-toolset/data/`, falling back to `~/.local/share/pi-aftc-toolset/data/` |
| **macOS** | `~/Library/Application Support/pi-aftc-toolset/data/` |

Set the `AFTC_TOOLSET_DATA_ROOT` environment variable to override the location (used by tests and power users). `/qd` opens the folder in your file manager.

> **Uninstall note:** this folder lives outside the package, so `pi remove` does **not** delete it — your usage history and preferences remain after uninstall. Delete the folder above manually for a full clean-up.

---

<br><br>

## Updating

```bash
pi update npm:pi-aftc-toolset
```

or install a pinned GitHub release:

```bash
pi install git:github.com/DarceyLloyd/pi-aftc-toolset@v<version>
```

Then `/reload` in pi. When an update ships new codex content, your live
codex merges it automatically on startup (Auto Sync) — otherwise
`/codex-sync` (non-destructive) or `/codex-install` (fresh) when prompted.

---

<br><br>

## Uninstall

```bash
pi remove npm:pi-aftc-toolset          # global
pi remove npm:pi-aftc-toolset -l       # project-local
```

or if you installed via GitHub:

```bash
pi remove git:github.com/DarceyLloyd/pi-aftc-toolset
```

Then `/reload` or restart pi.

---

<br><br>

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

<br><br>

## Dependency installer

`/aftc-install` (see [Slash Commands](#slash-commands)) installs and verifies:

- `better-sqlite3` via `npm install`
- Packaged SSH carrier dependencies via `uv sync --locked`
- The platform-native `uv` executable, using `uv.exe` on Windows and `uv` on Linux and macOS
- A Python 3 interpreter (`py`/`python` on Windows, `python3`/`python` elsewhere)

If Node, Python, or `uv` is missing it reports platform-specific recovery guidance without exposing saved connection data.

Reload pi afterwards. The footer works without SQLite, but usage recording, reporting, and SSH require `/aftc-install`.

---

<br><br>

## Requirements

- pi CLI (developed against 0.83.0)
- Node.js / npm
- Providers that expose `usage.cacheRead` and `usage.cacheWrite` for full cache metrics (other providers may show zero / incomplete cache values)
- Python 3.10+ and uv for the packaged SSH carrier. `/aftc-install` verifies the carrier environment.

---

<br><br>

## Development

Install from a clone:

```bash
pi install /path/to/pi-aftc-toolset -l
```

After edits, reload pi with `/reload`. Full developer documentation
(workflow, test suites, Linux gates, release discipline) lives in
`./docx/`.

---

<br><br>

## Project map (lite)

```
pi-aftc-toolset
|- 1 Extension source (extensions/aftc-toolset)   all feature modules
|    UI framework · Footer/cache/usage · Feature modules
|    SSH (+ Python carrier) · aftc-codex · docx generator
|- 2 Packaging & shipped assets (data, skills, themes, release scripts)
\- 3 Tests (tests/)
```

---

<br><br>

## Persistent files

Runtime data lives in a per-user folder **outside** the installed package
(see [Data location](#data-location)), so it survives `pi update`. Every
file is created lazily from built-in defaults — none of it is shipped or
committed, and the whole data dir is excluded from git and npm publishing.

| File | Purpose |
| --- | --- |
| `config.json` | Cross-session user preferences: footer (on/off, averages line on/off, timeframe window), response divider, think-tag processing, intro animation, audio notifications, replay prompt, run_script tool and aftc-codex switches. Created with defaults on first access; only re-written when a value actually changes. |
| `ssh.json` | Local SSH connection metadata (name, username, host, port, timeout, optional key path, optional saved password) + new-host-key auto-accept flag. Local-only, never shipped. |
| `turns.db` | SQLite usage database (turns + tasks tables — metrics only, never prompt text) |
| `report.html` | Latest generated usage report |
| `debug.log` | Rotating `[aftc-toolset]` diagnostic log (5 MB cap + one `.old` generation) |
| `aftc-codex/` | Your live codex knowledge base (seeded from the shipped copy; learned entries yours) |

**Your data survives updates.** Because the data dir is outside the
package, `pi update` no longer wipes it. Upgrading from a version that
stored data inside the install folder moves any still-present files over
automatically on first run (data already lost to an older update can't be
recovered).

In-memory only (per-session, not persisted): cache accumulators, model info, per-turn timings, context-window clock start time.

SSH sessions, shell buffers, credentials, and carrier processes are in-memory only and are cleared during shutdown.
<br><br>

---
## Project documentation

*For more details please see [docx/project_documentation.md](docx/project_documentation.md) and [docx/project_map.md](docx/project_map.md).*

---


<br><br>

## Change log

The full change history is now in [change-log.txt](./change-log.txt).

---

<br><br>

# License

[MIT](./LICENSE) - Author <Darcey.Lloyd@gmail.com>

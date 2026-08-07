# pi-aftc-toolset — Project Documentation

<!-- last-reviewed: 2026-08-07 -->

> Master document. Do not follow the per-ID links below until your work
> touches that area — each section ends with an *Only read* instruction;
> honour it. Discovery: this file's Documentation Index, or the annotations
> in [project_map.md](project_map.md).

## Description

**pi-aftc-toolset** is a productivity extension package for [pi](https://pi.dev)
(the `@earendil-works/pi-coding-agent` coding agent). It is a *tool package*:
installed into pi (`pi install pi-aftc-toolset` or from GitHub), loaded by pi's
extension loader (jiti — TypeScript at runtime, no build step), and it adds:

- A **cache/token/cost diagnostics footer widget** (5 themed lines) with
  subscription allowance tracking for ChatGPT/Codex, Anthropic, MiniMax,
  ZAI/GLM and Kimi subscriptions.
- A **persistent usage database** (SQLite) with a **usage report** served
  by a local server (Overview / Models / Thinking levels / Timings /
  Projections tabs).
- **Isolated SSH**: saved connections, a packaged Python (Paramiko) carrier
  over local stdio, 20 model tools (commands, PTY shells, SFTP, remote file
  ops) and a full-screen interactive terminal — credentials never reach the
  model context.
- **aftc-codex**: an opt-in, self-educating knowledge base injected into the
  system prompt with `codex_load`/entry tools.
- **/docx**: a documentation generator (the feature that produced this doc set).
- Audio notifications, keyboard shortcuts, startup intros, response divider,
  replay prompts, think-tag parsing, theme picker, quick dir access,
  emergency stop, `run_script`, 34 bundled skills and 3 bundled themes.

Who it serves: pi users who want session telemetry, remote-server tooling and
workflow conveniences. What it does NOT do: it is not a standalone app (it
runs only inside pi), it does not store prompt/response text (metrics only),
and it never exposes SSH credentials to the model.

## Tech stack

| Layer | Technology | Version |
| --- | --- | --- |
| Host | `@earendil-works/pi-coding-agent` (peer) | any; developed against 0.83.0 |
| Host peers | `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, `typebox` | any (peer `*`) |
| Extension runtime | TypeScript via pi's jiti loader (no build step) | TS 5.x syntax |
| Package version | pi-aftc-toolset | 1.19.11 (npm: 1.19.10 published) |
| Persistence | `better-sqlite3` | 12.11.1 (pinned) |
| Zip (docx backup) | `adm-zip` | ^0.6.0 |
| SSH carrier | Python + `paramiko` (uv-locked sidecar) | Python >=3.10; paramiko >=3.4.0,<4.0.0; aftc-ssh-sidecar 0.1.0 |
| Report charts | Chart.js bundled in the shipped usage-report app (no CDN) | 4.4.7 |
| Audio playback | bundled miniaudio binary (`data/aftc-intro/bin/play_sound-win-x64.exe`, C source shipped) | n/a |
| Tests | plain Node ESM scripts + jiti; Docker/Compose for SSH + Linux gates | n/a |

## Lite project map

```
pi-aftc-toolset
|- 1 Extension source (extensions/aftc-toolset)   — all feature modules
|    1.3 UI framework · 1.4 Footer/usage · 1.5 Feature modules
|    1.6 SSH (+1.6.10 Python carrier sub-project) · 1.7 aftc-codex · 1.8 docx
|    1.9 Sub-agents (007)
|- 2 Packaging & shipped assets (data, skills, themes, release scripts)
\- 3 Tests (tests/)
```

The FULL tree of every node lives only in [project_map.md](project_map.md).

## Project Guidance & Rules

### Rules

- Never use the character '§' in code comments, files or documentation.
- Never use the word "master" for on/off switches; use `featureNameEnabled`.
- Never create NUL files; never read `.bak` / `.old` / `.git` folders.
- Feature modules must not import each other — wire through `index.ts` and
  the structural interfaces in `types.ts` (see 1.1).
- Config files are read fresh from disk on EVERY access — never cache
  `config.json` or `ssh.json` in module memory (see 1.2, 1.6.3).
- Every tool gets a `promptSnippet`; SSH tools take saved names + opaque ids
  only — credentials never cross into model context (see 1.6).
- New user-facing features are disabled by default; never overwrite user
  settings — only add missing keys via write-back migration (see 1.2).
- Every `.ts` file has a sibling `<name>-readme.md`, kept current.
- Tests: every test registers a watchdog timeout; scripts must self-terminate.
- Before writing/modifying pi extension code, read the aftc-codex resource
  `tools/pi-extension.md` (live copy) — see 1.7.

### Maintaining This Documentation

- Docs update in the SAME change as the code — never deferred; a stale doc is a bug.
- A wrong doc is corrected immediately, and every doc referencing the
  corrected subject is checked and fixed in the same change.
- Refresh `last-reviewed` / `last-verified` headers of every doc touched.
- New modules update four things in one commit: map node, master per-ID
  section, Documentation Index entry, new ID-prefixed deep doc.
- A change that adds a UI surface (overlay/dialog/menu/screen) or a component
  with its own rules mints a leaf in the same commit: map node (next free
  sibling ID), leaf doc in the correct mirrored folder, Documentation Index
  entry, and an entry in [1_tui_sitemap.md](1_extension_source/1_tui_sitemap.md).

---

## 1 - Extension source (extensions/aftc-toolset)

The single pi extension that powers the package: one orchestrator
(`index.ts`) wiring ~30 self-contained feature modules, shared utilities
(`paths.ts`, `config.ts`, `db.ts`, `ui/`), the SSH subsystem, the aftc-codex
knowledge base and the docx generator. Owns every runtime behaviour of the
toolset; does NOT own shipped assets (2) or tests (3).

> Only read the following files if you need to work on extension-source
> features of this project, or if requested by the user or aftc codex:
> `./docx/1_extension_source/1_extension_documentation.md` and
> `./docx/1_extension_source/1_extension_map.md`.

### 1.1 - Entry & orchestration

`index.ts` (default export) + `types.ts`: instantiates every module in
order, runs the legacy-data migration, wires core→footer via
`FooterDataProvider`, registers `/aftc-intro-on|off`, owns the
module-layout rules (one feature per file, no cross-imports).

> Only read `./docx/1_extension_source/1.1_orchestration.md` when working
> on module wiring or the extension entry.

### 1.2 - Core infrastructure & config

`paths.ts` (package root + persistent data dir), `config.ts` (`config.json`
preferences API), `db.ts` (shared SQLite + schema), `debug-log.ts`
(`/aftc-debug-log-on|off`), `help-registry.ts` (the `/aftc-help` source of
truth). Plumbing every feature imports.

> Only read `./docx/1_extension_source/1.2_core_infrastructure_documentation.md`
> when working on data-dir paths, preferences, the DB schema or debug logging.

### 1.3 - UI framework (ui/)

Shared TUI output layer: `aftc-console.ts` (severity-tagged transcript +
diagnostics), `aftc-ui.ts` (GRUB-style takeover overlays: menus, confirms,
forms, inputs, viewer) and `terminal-screen.ts` (VT100 virtual screen for
the SSH terminal). Leaf utilities — every feature may import them.

> Only read the following files if you need to work on UI-framework features
> of this project, or if requested by the user or aftc codex:
> `./docx/1_extension_source/1.3_ui/1.3_ui_documentation.md` and
> `./docx/1_extension_source/1.3_ui/1.3_ui_map.md`.

#### 1.3.1 aftc-console — transcript + diagnostic facade (emphasis/warn/error/info/log). Only read `./docx/1_extension_source/1.3_ui/1.3.1_aftc_console.md`.
#### 1.3.2 aftc-ui — overlay primitives: showMenu/showConfirm/showForm/showInput/showViewer + palette/focus contract. Only read `./docx/1_extension_source/1.3_ui/1.3.2_aftc_ui.md`.
#### 1.3.3 terminal-screen — VT100 virtual screen behind the SSH terminal. Only read `./docx/1_extension_source/1.3_ui/1.3.3_terminal_screen.md`.

### 1.4 - Footer, cache & usage

Cache/token/cost accumulators (`core.ts`), the 4+1-line footer widget
(`footer-widget.ts`), subscription allowance fetching (`allowance.ts`),
per-turn SQLite recording (`usage-recording.ts`) and the HTML usage report
(`usage-report.ts`). Depends on 1.2 (db, config); rendered through 1.3.

> Only read the following files if you need to work on footer/usage features
> of this project, or if requested by the user or aftc codex:
> `./docx/1_extension_source/1.4_footer_usage/1.4_footer_usage_documentation.md` and
> `./docx/1_extension_source/1.4_footer_usage/1.4_footer_usage_map.md`.

#### 1.4.1 Cache diagnostics core — accumulators, timings, shape tracker, task timer, `/cache-profile|stats|reset`, `/cls`, timeframe definitions. Only read `./docx/1_extension_source/1.4_footer_usage/1.4.1_cache_core.md`.
#### 1.4.2 Footer widget — the 4+1-line bar surface + `/aftc-footer` menu + timeframe picker. Only read `./docx/1_extension_source/1.4_footer_usage/1.4.2_footer_widget.md`.
#### 1.4.3 Subscription allowance — ChatGPT/Codex, Anthropic headers, MiniMax, ZAI/GLM, Kimi fetchers for line 5. Only read `./docx/1_extension_source/1.4_footer_usage/1.4.3_allowance.md`.
#### 1.4.4 Usage recording — TurnRecorder writing metrics-only rows to turns/tasks. Only read `./docx/1_extension_source/1.4_footer_usage/1.4.4_usage_recording.md`.
#### 1.4.5 Usage report — `/usage-report` + `/usage-clear`, the usage-report app + local server with its 5 tabs. Only read `./docx/1_extension_source/1.4_footer_usage/1.4.5_usage_report.md`.

### 1.5 - Feature modules

The standalone conveniences: shortcuts, `/aftc-help`, `/aftc-install`, audio
notifications, response divider, `/stfu`, dir/nav commands, replay,
keep-it-short, theme picker, think-tag parser, `run_script`, startup intros
and the (disabled) provider integrations. Each is one file, self-registering.

> Only read the following files if you need to work on feature-module features
> of this project, or if requested by the user or aftc codex:
> `./docx/1_extension_source/1.5_feature_modules/1.5_feature_modules_documentation.md` and
> `./docx/1_extension_source/1.5_feature_modules/1.5_feature_modules_map.md`.

#### 1.5.1 Keyboard shortcuts — alt+c/alt+n/alt+x + `/aftc-cut-input`. Only read `./docx/1_extension_source/1.5_feature_modules/1.5.1_keys.md`.
#### 1.5.2 Help & discovery — `/aftc-help` viewer built from the registry. Only read `./docx/1_extension_source/1.5_feature_modules/1.5.2_help.md`.
#### 1.5.3 Installer — `/aftc-install` (npm + uv) + session-start dep warning. Only read `./docx/1_extension_source/1.5_feature_modules/1.5.3_install.md`.
#### 1.5.4 Audio notifications — event sounds + settings hub + `/aftc-notify-time`. Only read `./docx/1_extension_source/1.5_feature_modules/1.5.4_notify.md`.
#### 1.5.5 Response divider — themed rule above each reply, `/aftc-response-divider`. Only read `./docx/1_extension_source/1.5_feature_modules/1.5.5_response_divider.md`.
#### 1.5.6 Emergency stop — `/aftc-stop` / `/stfu` abort. Only read `./docx/1_extension_source/1.5_feature_modules/1.5.6_stfu.md`.
#### 1.5.7 Directory & navigation — `/dir` `/ls` `/cwd` `/qd`. Only read `./docx/1_extension_source/1.5_feature_modules/1.5.7_navigation.md`.
#### 1.5.8 Replay — `/save-replay-prompt` `/replay` `/r`. Only read `./docx/1_extension_source/1.5_feature_modules/1.5.8_replay.md`.
#### 1.5.9 Keep it short — `/keep-it-short` `/kis`. Only read `./docx/1_extension_source/1.5_feature_modules/1.5.9_keep_it_short.md`.
#### 1.5.10 Theme picker — `/theme` with live preview. Only read `./docx/1_extension_source/1.5_feature_modules/1.5.10_theme.md`.
#### 1.5.11 Think-tag parser — inline `<think>` tags → ThinkingContent blocks. Only read `./docx/1_extension_source/1.5_feature_modules/1.5.11_think_parser.md`.
#### 1.5.12 run_script tool — reliable large-script execution + on/off. Only read `./docx/1_extension_source/1.5_feature_modules/1.5.12_run_script.md`.
#### 1.5.13 Startup intros — AFTC wordmark widget (WarGames dormant). Only read `./docx/1_extension_source/1.5_feature_modules/1.5.13_intros.md`.
#### 1.5.14 Providers — DISABLED QwenCloud module kept on disk. Only read `./docx/1_extension_source/1.5_feature_modules/1.5.14_providers.md`.

### 1.6 - SSH feature (ssh/)

Isolated SSH: saved connections (`ssh.json`), a local `SshSessionManager`,
20 model tools + 16 slash commands, full-screen overlays (connection manager,
forms, terminal) and the packaged Python carrier (1.6.10). Privacy boundary:
only names/opaque ids cross to the model; everything else is redacted.

> Only read the following files if you need to work on SSH features of this
> project, or if requested by the user or aftc codex:
> `./docx/1_extension_source/1.6_ssh/1.6_ssh_documentation.md` and
> `./docx/1_extension_source/1.6_ssh/1.6_ssh_map.md`.

#### 1.6.1 Command & tool surface — the 16 commands + 20 tools in ssh/index.ts. Only read `./docx/1_extension_source/1.6_ssh/1.6.1_command_tool_surface.md`.
#### 1.6.2 Sessions & lifecycle — SshSessionManager + carrier client, idle reaper. Only read `./docx/1_extension_source/1.6_ssh/1.6.2_sessions.md`.
#### 1.6.3 Connection store — ssh.json fresh-read contract. Only read `./docx/1_extension_source/1.6_ssh/1.6.3_connection_store.md`.
#### 1.6.4 Redaction & safe errors — the privacy filter + safe error mapping. Only read `./docx/1_extension_source/1.6_ssh/1.6.4_redaction.md`.
#### 1.6.5 Connection manager screen — `/ssh-cm` full-screen list/add/edit/delete. Only read `./docx/1_extension_source/1.6_ssh/1.6.5_connection_manager.md`.
#### 1.6.6 New connection dialog — the add form + empty-password/replace confirms. Only read `./docx/1_extension_source/1.6_ssh/1.6.6_new_connection_dialog.md`.
#### 1.6.7 Connection form & auth overlays — edit form + connect-time credential flow. Only read `./docx/1_extension_source/1.6_ssh/1.6.7_connection_form.md`.
#### 1.6.8 Confirm overlay — the reusable two-button dialog and every call site. Only read `./docx/1_extension_source/1.6_ssh/1.6.8_confirm_overlay.md`.
#### 1.6.9 Interactive terminal overlay — `/ssh-shell` VT100 screen; Ctrl+] exits. Only read `./docx/1_extension_source/1.6_ssh/1.6.9_terminal_overlay.md`.

### 1.6.10 - Python carrier (ssh/carrier/) — sub-project

`aftc-ssh-sidecar`: packaged uv-locked Python process providing multi-session
SSH over local stdio JSON-RPC (Paramiko). Own manifest/runtime/entry point;
its folder is read-only for docs.

> Only read the following files if you need to work on the Python carrier of
> this project, or if requested by the user or aftc codex:
> `./docx/1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10_carrier_documentation.md` and
> `./docx/1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10_carrier_map.md`.
> The carrier is a sub-project: its folder is read-only for documentation —
> any readme or docs inside it may be read for reference but are never
> created or modified. When working on the carrier you may need to read the
> 1.6 SSH documentation — evaluate and act, and read all related
> documentation.

#### 1.6.10.1 Daemon & JSON-RPC — entry, wire format, dispatch table. Only read `./docx/1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10.1_daemon_rpc.md`.
#### 1.6.10.2 Sessions & modes — Paramiko sessions, exec/shell modes, monitor. Only read `./docx/1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10.2_sessions_modes.md`.
#### 1.6.10.3 SFTP & port forwarding — transfers, chunked cancel, forwards. Only read `./docx/1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10.3_sftp_forward.md`.
#### 1.6.10.4 Safety — keys.py encoder, redaction, error code catalogue. Only read `./docx/1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10.4_safety.md`.

### 1.7 - aftc-codex knowledge base

Opt-in knowledge base: ships a seed (`data/aftc-codex/`), maintains a live
per-user copy in the data dir, injects rules/guidance/resource list into the
system prompt, and gives the model `codex_load` + entry write tools. Off by
default; fail-soft; never destroys user data.

> Only read the following files if you need to work on aftc-codex features of
> this project, or if requested by the user or aftc codex:
> `./docx/1_extension_source/1.7_aftc_codex/1.7_aftc_codex_documentation.md` and
> `./docx/1_extension_source/1.7_aftc_codex/1.7_aftc_codex_map.md`.

#### 1.7.1 Store, seeding & version lifecycle — store, seed/live versions, compat guard, sync core. Only read `./docx/1_extension_source/1.7_aftc_codex/1.7.1_store_lifecycle.md`.
#### 1.7.2 Injection & detection — system-prompt injection, rules-only mode, stack auto-detect/pinning. Only read `./docx/1_extension_source/1.7_aftc_codex/1.7.2_injection.md`.
#### 1.7.3 Commands & menus — `/aftc-codex-*` commands + settings menus. Only read `./docx/1_extension_source/1.7_aftc_codex/1.7.3_commands.md`.
#### 1.7.4 Model tools — codex_load + the entry write tools and their guards. Only read `./docx/1_extension_source/1.7_aftc_codex/1.7.4_tools.md`.
#### 1.7.5 Learn & live-to-seed scripts — /codex-learn + the 4 shipped scripts. Only read `./docx/1_extension_source/1.7_aftc_codex/1.7.5_learn_sync_scripts.md`.

### 1.8 - docx documentation generator

`/docx`: regenerates a project's full documentation set (this one included)
from a shipped guide + per-type prompt packs, with deterministic backup,
context-window gates and helper scripts (map-scan, link-audit, zip-old).

> Only read the following files if you need to work on the docx generator of
> this project, or if requested by the user or aftc codex:
> `./docx/1_extension_source/1.8_docx/1.8_docx_documentation.md` and
> `./docx/1_extension_source/1.8_docx/1.8_docx_map.md`.

#### 1.8.1 /docx command & flow — gates, confirmations, type picker, prompt assembly. Only read `./docx/1_extension_source/1.8_docx/1.8.1_docx_command.md`.
#### 1.8.2 Backup — deterministic whitelist-scoped move into docx/old_docs/. Only read `./docx/1_extension_source/1.8_docx/1.8.2_backup.md`.
#### 1.8.3 Shipped guide & type packs — documentation_guide.md + 10 packs. Only read `./docx/1_extension_source/1.8_docx/1.8.3_guide_packs.md`.
#### 1.8.4 Helper scripts — map-scan, link-audit, ui-hints, zip-old. Only read `./docx/1_extension_source/1.8_docx/1.8.4_scripts.md`.

### 1.9 - Sub-agents, codename 007

Delegate focused work to isolated child pi processes (operatives),
each with a fresh context window, profile-owned capabilities and a
bounded report back. Foreground-only v1: one `subagent` tool call =
one run; `/007` + `/007-*` command family; disabled by default;
children hermetic (only a gated read-only codex capability); no DB
writes — spend in-memory, guarded by the allowance gate. Seed in
`data/subagents/` (data only); config in its own
`<dataDir>/subagents-config.json`.

> Only read the following files if you need to work on subagents
> features of this project, or if requested by the user or aftc codex:
> `./docx/1_extension_source/1.9_subagents/1.9_subagents_documentation.md` and
> `./docx/1_extension_source/1.9_subagents/1.9_subagents_map.md`.

#### 1.9.1 Config — subagents-config.json prefs module. Only read `./docx/1_extension_source/1.9_subagents/1.9.1_config.md`.
#### 1.9.2 Catalog + seed/sync — profile discovery (3 tiers), frontmatter, extends, seed-to-live. Only read `./docx/1_extension_source/1.9_subagents/1.9.2_catalog.md`.
#### 1.9.3 RPC child transport — strict-LF JSONL + supervised child + tree kill. Only read `./docx/1_extension_source/1.9_subagents/1.9.3_rpc_child.md`.
#### 1.9.4 Child runtime — worker protocol + report_result + codex brief. Only read `./docx/1_extension_source/1.9_subagents/1.9.4_child_runtime.md`.
#### 1.9.5 Supervisor — scheduler, lifecycle, watchdogs, termination ladder. Only read `./docx/1_extension_source/1.9_subagents/1.9.5_supervisor.md`.
#### 1.9.6 Tool + factory — subagent tool, model resolution, allowance gate, footer builder. Only read `./docx/1_extension_source/1.9_subagents/1.9.6_tool.md`.
#### 1.9.7 Commands & UI — /007 family + aftc-ui screens. Only read `./docx/1_extension_source/1.9_subagents/1.9.7_commands_ui.md`.

## 2 - Packaging & shipped assets

Everything that ships with the npm package beside code: the `data/` folder
(extension-config.json, audio MP3s, codex seed, intro assets), 34 bundled
skills, 3 bundled themes, and the maintainer release scripts. Owns the
seed→live flow inputs (consumed by 1.7) and the npm artifact shape.

> Only read the following files if you need to work on packaging/shipped-data
> features of this project, or if requested by the user or aftc codex:
> `./docx/2_packaging/2_packaging_documentation.md` and
> `./docx/2_packaging/2_packaging_map.md`.

#### 2.1 Shipped data — extension-config.json (codexVersion), codex seed, audio MP3s, intro assets, play_sound binary. Only read `./docx/2_packaging/2.1_shipped_data.md`.
#### 2.2 Bundled skills — the 34 shipped pi skills. Only read `./docx/2_packaging/2.2_skills.md`.
#### 2.3 Bundled themes — aftc-black-n-blue, aftc-orange-viz, cache-viz. Only read `./docx/2_packaging/2.3_themes.md`.
#### 2.4 Release & maintainer scripts — publish.bat, shipit.ps1, backup.ps1, clear-docker.bat + release discipline. Only read `./docx/2_packaging/2.4_release.md`.

## 3 - Tests (tests/)

~50 suites, one folder per check (`tests/<name>/<name>.mjs` + README):
plain Node ESM with jiti + mock pi APIs locally; disposable Docker SSH
fixtures; two Docker-Compose Linux gates; plus the docx fixture projects.
Every script carries a watchdog timeout. Rules live in AGENTS.md and 3.1.

> Only read the following files if you need to work on tests of this project,
> or if requested by the user or aftc codex:
> `./docx/3_tests/3_tests_documentation.md` and
> `./docx/3_tests/3_tests_map.md`.

#### 3.1 Test conventions & harness — watchdog timeouts, harness mechanics, workflow order. Only read `./docx/3_tests/3.1_conventions.md`.
#### 3.2 Local suites — the no-Docker node checks (full table). Only read `./docx/3_tests/3.2_local_suites.md`.
#### 3.3 Docker suites — disposable SSH fixture end-to-end suites. Only read `./docx/3_tests/3.3_docker_suites.md`.
#### 3.4 Linux gates — pi-linux-integration + pi-linux-ssh-verify Compose gates + verification cycle. Only read `./docx/3_tests/3.4_linux_gates.md`.
#### 3.5 docx fixtures — the fixture projects under tests/docx/ (not sub-projects) + their surface inventory. Only read `./docx/3_tests/3.5_docx_fixtures.md`.

---

## Documentation Index

Discovery index — find the doc for the area you are about to work on and load
ONLY that doc; do not follow these links for areas you are not working on.

### Root

- [project_map.md](project_map.md) — full structure map
- [contributing.md](contributing.md) — workflow, rules, release discipline
- [deployment.md](deployment.md) — npm publish, GitHub releases, updates
- [development.md](development.md) — dev environment, install, dev tools
- [dependency_map.md](dependency_map.md) — cross-ID dependency view
- [design.md](design.md) — AFTC UI design language & key conventions
- [known-gaps.md](known-gaps.md) — unchecked pre-launch items + fix plan

### Branch 1 — Extension source

- [1_extension_source/1_extension_documentation.md](1_extension_source/1_extension_documentation.md) - ID 1
- [1_extension_source/1_extension_map.md](1_extension_source/1_extension_map.md) - ID 1 sub-map
- [1_extension_source/1_tui_sitemap.md](1_extension_source/1_tui_sitemap.md) - ID 1 sitemap (every TUI surface)
- [1_extension_source/1.1_orchestration.md](1_extension_source/1.1_orchestration.md) - ID 1.1
- [1_extension_source/1.2_core_infrastructure_documentation.md](1_extension_source/1.2_core_infrastructure_documentation.md) - ID 1.2
  - [1_extension_source/1.3_ui/1.3_ui_documentation.md](1_extension_source/1.3_ui/1.3_ui_documentation.md) - ID 1.3
  - [1_extension_source/1.3_ui/1.3_ui_map.md](1_extension_source/1.3_ui/1.3_ui_map.md) - ID 1.3 sub-map
  - [1_extension_source/1.3_ui/1.3.1_aftc_console.md](1_extension_source/1.3_ui/1.3.1_aftc_console.md) - ID 1.3.1
  - [1_extension_source/1.3_ui/1.3.2_aftc_ui.md](1_extension_source/1.3_ui/1.3.2_aftc_ui.md) - ID 1.3.2
  - [1_extension_source/1.3_ui/1.3.3_terminal_screen.md](1_extension_source/1.3_ui/1.3.3_terminal_screen.md) - ID 1.3.3
  - [1_extension_source/1.4_footer_usage/1.4_footer_usage_documentation.md](1_extension_source/1.4_footer_usage/1.4_footer_usage_documentation.md) - ID 1.4
  - [1_extension_source/1.4_footer_usage/1.4_footer_usage_map.md](1_extension_source/1.4_footer_usage/1.4_footer_usage_map.md) - ID 1.4 sub-map
  - [1_extension_source/1.4_footer_usage/1.4.1_cache_core.md](1_extension_source/1.4_footer_usage/1.4.1_cache_core.md) - ID 1.4.1
  - [1_extension_source/1.4_footer_usage/1.4.2_footer_widget.md](1_extension_source/1.4_footer_usage/1.4.2_footer_widget.md) - ID 1.4.2
  - [1_extension_source/1.4_footer_usage/1.4.3_allowance.md](1_extension_source/1.4_footer_usage/1.4.3_allowance.md) - ID 1.4.3
  - [1_extension_source/1.4_footer_usage/1.4.4_usage_recording.md](1_extension_source/1.4_footer_usage/1.4.4_usage_recording.md) - ID 1.4.4
  - [1_extension_source/1.4_footer_usage/1.4.5_usage_report.md](1_extension_source/1.4_footer_usage/1.4.5_usage_report.md) - ID 1.4.5
  - [1_extension_source/1.5_feature_modules/1.5_feature_modules_documentation.md](1_extension_source/1.5_feature_modules/1.5_feature_modules_documentation.md) - ID 1.5
  - [1_extension_source/1.5_feature_modules/1.5_feature_modules_map.md](1_extension_source/1.5_feature_modules/1.5_feature_modules_map.md) - ID 1.5 sub-map
  - [1_extension_source/1.5_feature_modules/1.5.1_keys.md](1_extension_source/1.5_feature_modules/1.5.1_keys.md) - ID 1.5.1
  - [1_extension_source/1.5_feature_modules/1.5.2_help.md](1_extension_source/1.5_feature_modules/1.5.2_help.md) - ID 1.5.2
  - [1_extension_source/1.5_feature_modules/1.5.3_install.md](1_extension_source/1.5_feature_modules/1.5.3_install.md) - ID 1.5.3
  - [1_extension_source/1.5_feature_modules/1.5.4_notify.md](1_extension_source/1.5_feature_modules/1.5.4_notify.md) - ID 1.5.4
  - [1_extension_source/1.5_feature_modules/1.5.5_response_divider.md](1_extension_source/1.5_feature_modules/1.5.5_response_divider.md) - ID 1.5.5
  - [1_extension_source/1.5_feature_modules/1.5.6_stfu.md](1_extension_source/1.5_feature_modules/1.5.6_stfu.md) - ID 1.5.6
  - [1_extension_source/1.5_feature_modules/1.5.7_navigation.md](1_extension_source/1.5_feature_modules/1.5.7_navigation.md) - ID 1.5.7
  - [1_extension_source/1.5_feature_modules/1.5.8_replay.md](1_extension_source/1.5_feature_modules/1.5.8_replay.md) - ID 1.5.8
  - [1_extension_source/1.5_feature_modules/1.5.9_keep_it_short.md](1_extension_source/1.5_feature_modules/1.5.9_keep_it_short.md) - ID 1.5.9
  - [1_extension_source/1.5_feature_modules/1.5.10_theme.md](1_extension_source/1.5_feature_modules/1.5.10_theme.md) - ID 1.5.10
  - [1_extension_source/1.5_feature_modules/1.5.11_think_parser.md](1_extension_source/1.5_feature_modules/1.5.11_think_parser.md) - ID 1.5.11
  - [1_extension_source/1.5_feature_modules/1.5.12_run_script.md](1_extension_source/1.5_feature_modules/1.5.12_run_script.md) - ID 1.5.12
  - [1_extension_source/1.5_feature_modules/1.5.13_intros.md](1_extension_source/1.5_feature_modules/1.5.13_intros.md) - ID 1.5.13
  - [1_extension_source/1.5_feature_modules/1.5.14_providers.md](1_extension_source/1.5_feature_modules/1.5.14_providers.md) - ID 1.5.14
  - [1_extension_source/1.6_ssh/1.6_ssh_documentation.md](1_extension_source/1.6_ssh/1.6_ssh_documentation.md) - ID 1.6
  - [1_extension_source/1.6_ssh/1.6_ssh_map.md](1_extension_source/1.6_ssh/1.6_ssh_map.md) - ID 1.6 sub-map
  - [1_extension_source/1.6_ssh/1.6.1_command_tool_surface.md](1_extension_source/1.6_ssh/1.6.1_command_tool_surface.md) - ID 1.6.1
  - [1_extension_source/1.6_ssh/1.6.2_sessions.md](1_extension_source/1.6_ssh/1.6.2_sessions.md) - ID 1.6.2
  - [1_extension_source/1.6_ssh/1.6.3_connection_store.md](1_extension_source/1.6_ssh/1.6.3_connection_store.md) - ID 1.6.3
  - [1_extension_source/1.6_ssh/1.6.4_redaction.md](1_extension_source/1.6_ssh/1.6.4_redaction.md) - ID 1.6.4
  - [1_extension_source/1.6_ssh/1.6.5_connection_manager.md](1_extension_source/1.6_ssh/1.6.5_connection_manager.md) - ID 1.6.5
  - [1_extension_source/1.6_ssh/1.6.6_new_connection_dialog.md](1_extension_source/1.6_ssh/1.6.6_new_connection_dialog.md) - ID 1.6.6
  - [1_extension_source/1.6_ssh/1.6.7_connection_form.md](1_extension_source/1.6_ssh/1.6.7_connection_form.md) - ID 1.6.7
  - [1_extension_source/1.6_ssh/1.6.8_confirm_overlay.md](1_extension_source/1.6_ssh/1.6.8_confirm_overlay.md) - ID 1.6.8
  - [1_extension_source/1.6_ssh/1.6.9_terminal_overlay.md](1_extension_source/1.6_ssh/1.6.9_terminal_overlay.md) - ID 1.6.9
    - [1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10_carrier_documentation.md](1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10_carrier_documentation.md) - ID 1.6.10, `sub-project`
    - [1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10_carrier_map.md](1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10_carrier_map.md) - ID 1.6.10 sub-map
    - [1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10.1_daemon_rpc.md](1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10.1_daemon_rpc.md) - ID 1.6.10.1
    - [1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10.2_sessions_modes.md](1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10.2_sessions_modes.md) - ID 1.6.10.2
    - [1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10.3_sftp_forward.md](1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10.3_sftp_forward.md) - ID 1.6.10.3
    - [1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10.4_safety.md](1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10.4_safety.md) - ID 1.6.10.4
  - [1_extension_source/1.7_aftc_codex/1.7_aftc_codex_documentation.md](1_extension_source/1.7_aftc_codex/1.7_aftc_codex_documentation.md) - ID 1.7
  - [1_extension_source/1.7_aftc_codex/1.7_aftc_codex_map.md](1_extension_source/1.7_aftc_codex/1.7_aftc_codex_map.md) - ID 1.7 sub-map
  - [1_extension_source/1.7_aftc_codex/1.7.1_store_lifecycle.md](1_extension_source/1.7_aftc_codex/1.7.1_store_lifecycle.md) - ID 1.7.1
  - [1_extension_source/1.7_aftc_codex/1.7.2_injection.md](1_extension_source/1.7_aftc_codex/1.7.2_injection.md) - ID 1.7.2
  - [1_extension_source/1.7_aftc_codex/1.7.3_commands.md](1_extension_source/1.7_aftc_codex/1.7.3_commands.md) - ID 1.7.3
  - [1_extension_source/1.7_aftc_codex/1.7.4_tools.md](1_extension_source/1.7_aftc_codex/1.7.4_tools.md) - ID 1.7.4
  - [1_extension_source/1.7_aftc_codex/1.7.5_learn_sync_scripts.md](1_extension_source/1.7_aftc_codex/1.7.5_learn_sync_scripts.md) - ID 1.7.5
  - [1_extension_source/1.8_docx/1.8_docx_documentation.md](1_extension_source/1.8_docx/1.8_docx_documentation.md) - ID 1.8
  - [1_extension_source/1.8_docx/1.8_docx_map.md](1_extension_source/1.8_docx/1.8_docx_map.md) - ID 1.8 sub-map
  - [1_extension_source/1.8_docx/1.8.1_docx_command.md](1_extension_source/1.8_docx/1.8.1_docx_command.md) - ID 1.8.1
  - [1_extension_source/1.8_docx/1.8.2_backup.md](1_extension_source/1.8_docx/1.8.2_backup.md) - ID 1.8.2
  - [1_extension_source/1.8_docx/1.8.3_guide_packs.md](1_extension_source/1.8_docx/1.8.3_guide_packs.md) - ID 1.8.3
  - [1_extension_source/1.8_docx/1.8.4_scripts.md](1_extension_source/1.8_docx/1.8.4_scripts.md) - ID 1.8.4
  - [1_extension_source/1.9_subagents/1.9_subagents_documentation.md](1_extension_source/1.9_subagents/1.9_subagents_documentation.md) - ID 1.9
  - [1_extension_source/1.9_subagents/1.9_subagents_map.md](1_extension_source/1.9_subagents/1.9_subagents_map.md) - ID 1.9 sub-map
  - [1_extension_source/1.9_subagents/1.9.1_config.md](1_extension_source/1.9_subagents/1.9.1_config.md) - ID 1.9.1
  - [1_extension_source/1.9_subagents/1.9.2_catalog.md](1_extension_source/1.9_subagents/1.9.2_catalog.md) - ID 1.9.2
  - [1_extension_source/1.9_subagents/1.9.3_rpc_child.md](1_extension_source/1.9_subagents/1.9.3_rpc_child.md) - ID 1.9.3
  - [1_extension_source/1.9_subagents/1.9.4_child_runtime.md](1_extension_source/1.9_subagents/1.9.4_child_runtime.md) - ID 1.9.4
  - [1_extension_source/1.9_subagents/1.9.5_supervisor.md](1_extension_source/1.9_subagents/1.9.5_supervisor.md) - ID 1.9.5
  - [1_extension_source/1.9_subagents/1.9.6_tool.md](1_extension_source/1.9_subagents/1.9.6_tool.md) - ID 1.9.6
  - [1_extension_source/1.9_subagents/1.9.7_commands_ui.md](1_extension_source/1.9_subagents/1.9.7_commands_ui.md) - ID 1.9.7

### Branch 2 — Packaging & shipped assets

- [2_packaging/2_packaging_documentation.md](2_packaging/2_packaging_documentation.md) - ID 2
- [2_packaging/2_packaging_map.md](2_packaging/2_packaging_map.md) - ID 2 sub-map
- [2_packaging/2.1_shipped_data.md](2_packaging/2.1_shipped_data.md) - ID 2.1
- [2_packaging/2.2_skills.md](2_packaging/2.2_skills.md) - ID 2.2
- [2_packaging/2.3_themes.md](2_packaging/2.3_themes.md) - ID 2.3
- [2_packaging/2.4_release.md](2_packaging/2.4_release.md) - ID 2.4

### Branch 3 — Tests

- [3_tests/3_tests_documentation.md](3_tests/3_tests_documentation.md) - ID 3
- [3_tests/3_tests_map.md](3_tests/3_tests_map.md) - ID 3 sub-map
- [3_tests/3.1_conventions.md](3_tests/3.1_conventions.md) - ID 3.1
- [3_tests/3.2_local_suites.md](3_tests/3.2_local_suites.md) - ID 3.2
- [3_tests/3.3_docker_suites.md](3_tests/3.3_docker_suites.md) - ID 3.3
- [3_tests/3.4_linux_gates.md](3_tests/3.4_linux_gates.md) - ID 3.4
- [3_tests/3.5_docx_fixtures.md](3_tests/3.5_docx_fixtures.md) - ID 3.5

---

New sections may be added by the AI or the user as the project evolves; the
future shape cannot be known in advance. When adding one, follow the
Maintaining This Documentation rules above.

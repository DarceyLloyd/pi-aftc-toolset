# pi-aftc-toolset — Master Documentation

<!-- last-reviewed: 2026-08-05 16:40 -->

## Description

pi-aftc-toolset is a productivity extension package for the [pi](https://pi.dev) CLI coding agent. It serves pi users who want diagnostics, remote access, and knowledge tooling inside their coding-agent sessions: a live footer widget (costs, cache, timing), credential-isolated SSH with interactive terminals, an opt-in self-educating knowledge base (aftc-codex), a project documentation generator (/docx), audio notifications, usage recording with HTML reports, bundled skills and themes, and a suite of slash commands and keyboard shortcuts.

It is NOT: a standalone application, a pi fork, a provider of LLM models, or a general-purpose automation framework. It does not modify pi itself — it is loaded by pi as a package (`extensions/`, `skills/`, `themes/`).

## Tech Stack

| Component | Version |
| --- | --- |
| Runtime | pi coding agent (`@earendil-works/pi-coding-agent`, peer dep `*`) — TypeScript loaded via jiti, no build step |
| Node.js | 22+ (container baseline node:22-bookworm) |
| better-sqlite3 | 12.11.1 (usage recording) |
| adm-zip | ^0.6.0 (docx backup zip) |
| Python | >=3.10 (SSH carrier) |
| Paramiko | >=3.4.0,<4.0.0 (SSH carrier) |
| uv | latest (carrier dependency manager) |
| miniaudio | bundled C player binaries (MIT-0) |

## Lite Project Map

```
pi-aftc-toolset/
|-1 - Application Source (extensions/aftc-toolset/)
|-2 - Shipped Data (data/)
|-3 - Skills (skills/)
|-4 - Themes (themes/)
|-5 - Tests (tests/)
\-6 - Package & Distribution
```

The full tree (every node, every level) lives in [project_map.md](project_map.md).

## Project Guidance & Rules

### Rules

- Never start background resources in the extension factory; start lazily, clean up in `session_shutdown`.
- Feature modules never import each other; shared interfaces live in `types.ts`, wiring in `index.ts`.
- All console output goes through `ui/aftc-console.ts`; all dialogs through `ui/aftc-ui.ts`.
- Config (`config.json`) is read fresh from disk on every access — never cached in module memory; writes are fresh read-modify-write; user values are sacred.
- Every `.ts` module has a sibling `<module>-readme.md`; keep both current.
- Every slash command has exactly one help-registry entry next to its `pi.registerCommand` call.
- Every test has a global watchdog timeout.
- The model never sees SSH credentials — saved connections by name, opaque session ids only.

### Maintaining This Documentation

- Docs update in the SAME change as the code - never deferred; a stale doc is a bug.
- A wrong doc is corrected immediately + every doc referencing the corrected subject is checked and fixed in the same change.
- Refresh `last-reviewed` / `last-verified` headers of every doc touched.
- New modules update four things in one commit: map node, master per-ID section, Documentation Index entry, new ID-prefixed deep doc.

## 1 - Application Source

All extension code: one pi package extension rooted at `extensions/aftc-toolset/index.ts` (orchestrator). Owns every runtime feature. Does NOT own: shipped assets (2), skills (3), themes (4), tests (5).

> Only read the following files if you need to work on application-source features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.1_pi_runtime_documentation.md` through `./docx/docs/1.11_audio_binaries_documentation.md` — pick the per-ID doc for the area you are touching (see the Documentation Index).

### 1.1 - pi Extension Runtime

The framework dependency: pi's extension API (events, tools, commands, UI, state) and the peer packages (`pi-coding-agent`, `pi-ai`, `pi-tui`, `typebox`). Everything in branch 1 is built on it. Owns: lifecycle hooks, tool registration, theming primitives. Does not own: any feature logic.

> Only read the following files if you need to work on framework-integration features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.1_pi_runtime_documentation.md`.

### 1.2 - Orchestrator & Core Infrastructure

`index.ts` (wires every module), `types.ts` (shared interfaces), `paths.ts` (package/data-dir resolution + legacy migration), `config.ts` (live preferences), `db.ts` (SQLite). Owns: module lifecycle, config persistence, path truth. Does not own: feature behaviour.

> Only read the following files if you need to work on orchestrator/core features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.2_orchestrator_core_documentation.md`.

### 1.3 - UI Framework

`ui/aftc-ui.ts` (GRUB-style dialogs: menus, confirms, forms, inputs, viewers + panel primitives) and `ui/aftc-console.ts` (severity facade over pi output: emphasis/warn/error/info/log). Every feature's UI goes through these.

> Only read the following files if you need to work on UI-framework features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.3_ui_framework_documentation.md`.

### 1.4 - Footer Widget & Usage Tracking

The diagnostics footer (model/context/cache/cost/timing lines), per-turn SQLite recording, subscription allowance line, and the `/usage-report` HTML report. Owns: usage data. Does not own: SSH usage of the DB.

> Only read the following files if you need to work on footer/usage features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.4_footer_usage_documentation.md`.

### 1.5 - Feature Modules

The 16 self-contained slash-command modules (help, install, keys, theme, stfu, dir, cwd, replay, keep-it-short, think-parser, notify, quick-open-dir, debug-log, response, run-script, help-registry). Each registers commands and is wired by the orchestrator.

> Only read the following files if you need to work on slash-command features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.5_feature_modules_documentation.md`.

### 1.6 - SSH Subsystem

Credential-isolated SSH: local commands, a full-screen terminal, file transfer/management, and model tools — all proxied through a packaged Python Paramiko carrier over stdio JSON-RPC. The model never sees hosts, users, or secrets.

> Only read the following files if you need to work on SSH features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.6_ssh_documentation.md` and `./docx/docs/1.6_ssh_map.md`.

#### 1.6.1 - SSH Orchestration & Model Tools

Command/tool registration and session selection for SSH. Owns the pi surface; not session mechanics.

> Only read the following files if you need to work on SSH orchestration features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.6.1_ssh_orchestration_documentation.md`.

#### 1.6.2 - Session Manager

In-memory sessions, opaque ids, credential clearing, bounded results; proxies everything to the carrier.

> Only read the following files if you need to work on SSH session features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.6.2_ssh_sessions_documentation.md`.

#### 1.6.3 - Carrier Bridge

Spawns/owns the Python carrier process; JSON-RPC client; lifecycle states and crash policy.

> Only read the following files if you need to work on carrier-bridge features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.6.3_carrier_bridge_documentation.md`.

#### 1.6.4 - Python SSH Carrier

The packaged Paramiko sidecar (uv-locked, multi-session) doing the real SSH work.

> Only read the following files if you need to work on carrier features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.6.4_python_carrier_documentation.md`.

#### 1.6.5 - Connection Store

ssh.json persistence for saved connections (metadata + optional saved passwords).

> Only read the following files if you need to work on connection-store features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.6.5_connection_store_documentation.md`.

#### 1.6.6 - SSH UI Overlays

Connection manager, forms, pickers, confirms, and the full-screen PTY terminal.

> Only read the following files if you need to work on SSH UI features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.6.6_ssh_ui_documentation.md`.

#### 1.6.7 - Redaction

Verbatim-substring redaction of connection metadata from all model-bound output.

> Only read the following files if you need to work on redaction features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.6.7_redaction_documentation.md`.

### 1.7 - aftc-codex Knowledge Base

The opt-in knowledge base: injects rules/guidance/resource list into the system prompt, auto-detects project technologies, serves topic docs via `codex_load`, and self-educates via `/codex-learn` + the entry tools. Off by default.

> Only read the following files if you need to work on aftc-codex features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.7_aftc_codex_documentation.md` and `./docx/docs/1.7_aftc_codex_map.md`.

#### 1.7.1 - Codex Coordinator

Shared state, sub-module wiring, read tracker, and the `codex_load` tool.

> Only read the following files if you need to work on codex-coordinator features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.7.1_codex_coordinator_documentation.md`.

#### 1.7.2 - Codex Store

Two-copy data model, copy-only seeding, resource reads, script spawns.

> Only read the following files if you need to work on codex-store features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.7.2_codex_store_documentation.md`.

#### 1.7.3 - System-Prompt Injection

Cached-prefix injection, in-history marker, context pruning, rules-only mode.

> Only read the following files if you need to work on codex-injection features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.7.3_codex_inject_documentation.md`.

#### 1.7.4 - Technology Detection

Maps project files/manifests/markers to codex topic docs.

> Only read the following files if you need to work on codex-detection features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.7.4_codex_detect_documentation.md`.

#### 1.7.5 - Learn Loop

The /codex-learn instruction prompt (generality + secrets hard limits).

> Only read the following files if you need to work on learn-loop features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.7.5_codex_learn_documentation.md`.

#### 1.7.6 - Entry Tools

Deterministic codex writes: add/edit/remove with all guards.

> Only read the following files if you need to work on entry-tool features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.7.6_codex_entries_documentation.md`.

#### 1.7.7 - Compatibility Guard

Shipped-vs-live version check; pauses codex on mismatch.

> Only read the following files if you need to work on compat-guard features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.7.7_codex_compat_documentation.md`.

#### 1.7.8 - Codex Commands

The /aftc-codex-* command surface and config menu.

> Only read the following files if you need to work on codex-command features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.7.8_codex_commands_documentation.md`.

#### 1.7.9 - Maintenance Scripts

List sync, ID backfill, maintainer live->seed release sync.

> Only read the following files if you need to work on codex-script features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.7.9_codex_scripts_documentation.md`.

### 1.8 - docx Generator

The `/docx` documentation generator: deterministic backup of existing docs into `docx/old_docs/`, execution-prompt injection from the shipped guide, and model-run helper scripts (scan/audit/zip).

> Only read the following files if you need to work on docx features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.8_docx_documentation.md` and `./docx/docs/1.8_docx_map.md`.

#### 1.8.1 - /docx Command & Orchestration

Modals, context gate, backup orchestration, prompt injection (incl. the print-mode turn-hold).

> Only read the following files if you need to work on docx-command features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.8.1_docx_command_documentation.md`.

#### 1.8.2 - Deterministic Backup

Whitelist-scoped move of pre-existing docs into docx/old_docs/.

> Only read the following files if you need to work on docx-backup features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.8.2_docx_backup_documentation.md`.

#### 1.8.3 - Documentation Guide

The shipped generation spec (section 18 is the injected prompt template).

> Only read the following files if you need to work on the docx guide, or if requested by the user or aftc codex:
> `./docx/docs/1.8.3_docx_guide_documentation.md`.

#### 1.8.4 - Model-Run Scripts

map-scan / link-audit / zip-old — the deterministic steps the model runs.

> Only read the following files if you need to work on docx-script features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.8.4_docx_scripts_documentation.md`.

### 1.9 - Intro Animations

Startup intro animations. The factory is disconnected; only the AFTC text wordmark runs (`/aftc-intro-on`, `/aftc-intro-off`).

> Only read the following files if you need to work on intro features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.9_intros_documentation.md`.

### 1.10 - Providers

The QwenCloud provider module. DISABLED since pi 0.81 added native provider support; kept on disk in case the built-in proves weaker. Not wired in `index.ts`.

> Only read the following files if you need to work on provider features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.10_providers_documentation.md`.

### 1.11 - Audio Player Binaries

The bundled miniaudio `play_sound` binaries (win/linux/mac x64+arm64) and their C source. Used by the audio-notification feature (1.5).

> Only read the following files if you need to work on audio-binary features of this project, or if requested by the user or aftc codex:
> `./docx/docs/1.11_audio_binaries_documentation.md`.

## 2 - Shipped Data

Package-shipped assets under `extensions/aftc-toolset/data/`: the aftc-codex seed, notification MP3s, intro audio, and `extension-config.json` (shipped-only keys, today `codexVersion`). One-way flow seed → live; never the reverse at runtime.

> Only read the following files if you need to work on shipped-data features of this project, or if requested by the user or aftc codex:
> `./docx/docs/2_shipped_data_documentation.md`.

## 3 - Skills

34 Agent Skills packages (`skills/<name>/SKILL.md`) shipped for pi's on-demand skill loading — languages, frameworks, tools, plus project skills (aftc-codex, ssh, cache-audit, bulk-read).

> Only read the following files if you need to work on skills features of this project, or if requested by the user or aftc codex:
> `./docx/docs/3_skills_documentation.md`.

## 4 - Themes

Three pi themes (`aftc-black-n-blue`, `aftc-orange-viz`, `cache-viz`) shipped via the package `pi` manifest.

> Only read the following files if you need to work on themes features of this project, or if requested by the user or aftc codex:
> `./docx/docs/4_themes_documentation.md`.

## 5 - Tests

The test suites under `tests/` (never published — gitignored and npmignored). Plain-Node ESM scripts with mandatory watchdogs; extension TypeScript loaded through pi's bundled jiti; Docker fixtures for SSH/Linux gates.

> Only read the following files if you need to work on test features of this project, or if requested by the user or aftc codex:
> `./docx/docs/5_tests_documentation.md`.

### 5.1 - Local Test Suites

The ~60 `*-check` suites: mock-pi module checks, codex suites, docx suite, UI overlay drivers. No network, no TUI.

> Only read the following files if you need to work on local-test features of this project, or if requested by the user or aftc codex:
> `./docx/docs/5.1_local_suites_documentation.md`.

### 5.2 - Docker Test Fixtures

The containerised test fixtures (`dev-tool`): `ssh-replacement` (ssh-test-server), `pi-linux-integration` (pi-linux), `pi-linux-ssh-verify` (pi-client + ssh-target), `install-test` (image only). Used by the SSH and Linux verification gates.

> Only read the following files if you need to work on docker-fixture features of this project, or if requested by the user or aftc codex:
> `./docx/docs/5.2_docker_fixtures_documentation.md`.

## 6 - Package & Distribution

The npm/pi package surface: `package.json` (`pi` manifest, deps), lockfiles, `.gitignore`/`.npmignore`/`.dockerignore`, `images/` (README screenshots), `LICENSE`, `backup.ps1`.

> Only read the following files if you need to work on packaging features of this project, or if requested by the user or aftc codex:
> `./docx/docs/6_package_distribution_documentation.md`.

## Documentation Index

*Discovery index — find the doc for the area you are about to work on and load ONLY that doc; do not follow these links for areas you are not working on.*

### Deep Documents

- [docs/1_application_source_documentation.md](docs/1_application_source_documentation.md) - ID 1 (branch stub)
- [docs/1.1_pi_runtime_documentation.md](docs/1.1_pi_runtime_documentation.md) - ID 1.1, `framework`
- [docs/1.2_orchestrator_core_documentation.md](docs/1.2_orchestrator_core_documentation.md) - ID 1.2
- [docs/1.3_ui_framework_documentation.md](docs/1.3_ui_framework_documentation.md) - ID 1.3
- [docs/1.4_footer_usage_documentation.md](docs/1.4_footer_usage_documentation.md) - ID 1.4
- [docs/1.5_feature_modules_documentation.md](docs/1.5_feature_modules_documentation.md) - ID 1.5
- [docs/1.6_ssh_documentation.md](docs/1.6_ssh_documentation.md) - ID 1.6
- [docs/1.6.1_ssh_orchestration_documentation.md](docs/1.6.1_ssh_orchestration_documentation.md) - ID 1.6.1
- [docs/1.6.2_ssh_sessions_documentation.md](docs/1.6.2_ssh_sessions_documentation.md) - ID 1.6.2
- [docs/1.6.3_carrier_bridge_documentation.md](docs/1.6.3_carrier_bridge_documentation.md) - ID 1.6.3
- [docs/1.6.4_python_carrier_documentation.md](docs/1.6.4_python_carrier_documentation.md) - ID 1.6.4
- [docs/1.6.5_connection_store_documentation.md](docs/1.6.5_connection_store_documentation.md) - ID 1.6.5
- [docs/1.6.6_ssh_ui_documentation.md](docs/1.6.6_ssh_ui_documentation.md) - ID 1.6.6
- [docs/1.6.7_redaction_documentation.md](docs/1.6.7_redaction_documentation.md) - ID 1.6.7
- [docs/1.7_aftc_codex_documentation.md](docs/1.7_aftc_codex_documentation.md) - ID 1.7
- [docs/1.7.1_codex_coordinator_documentation.md](docs/1.7.1_codex_coordinator_documentation.md) - ID 1.7.1
- [docs/1.7.2_codex_store_documentation.md](docs/1.7.2_codex_store_documentation.md) - ID 1.7.2
- [docs/1.7.3_codex_inject_documentation.md](docs/1.7.3_codex_inject_documentation.md) - ID 1.7.3
- [docs/1.7.4_codex_detect_documentation.md](docs/1.7.4_codex_detect_documentation.md) - ID 1.7.4
- [docs/1.7.5_codex_learn_documentation.md](docs/1.7.5_codex_learn_documentation.md) - ID 1.7.5
- [docs/1.7.6_codex_entries_documentation.md](docs/1.7.6_codex_entries_documentation.md) - ID 1.7.6
- [docs/1.7.7_codex_compat_documentation.md](docs/1.7.7_codex_compat_documentation.md) - ID 1.7.7
- [docs/1.7.8_codex_commands_documentation.md](docs/1.7.8_codex_commands_documentation.md) - ID 1.7.8
- [docs/1.7.9_codex_scripts_documentation.md](docs/1.7.9_codex_scripts_documentation.md) - ID 1.7.9
- [docs/1.8_docx_documentation.md](docs/1.8_docx_documentation.md) - ID 1.8
- [docs/1.8.1_docx_command_documentation.md](docs/1.8.1_docx_command_documentation.md) - ID 1.8.1
- [docs/1.8.2_docx_backup_documentation.md](docs/1.8.2_docx_backup_documentation.md) - ID 1.8.2
- [docs/1.8.3_docx_guide_documentation.md](docs/1.8.3_docx_guide_documentation.md) - ID 1.8.3
- [docs/1.8.4_docx_scripts_documentation.md](docs/1.8.4_docx_scripts_documentation.md) - ID 1.8.4
- [docs/1.9_intros_documentation.md](docs/1.9_intros_documentation.md) - ID 1.9
- [docs/1.10_providers_documentation.md](docs/1.10_providers_documentation.md) - ID 1.10
- [docs/1.11_audio_binaries_documentation.md](docs/1.11_audio_binaries_documentation.md) - ID 1.11
- [docs/2_shipped_data_documentation.md](docs/2_shipped_data_documentation.md) - ID 2
- [docs/3_skills_documentation.md](docs/3_skills_documentation.md) - ID 3
- [docs/4_themes_documentation.md](docs/4_themes_documentation.md) - ID 4
- [docs/5_tests_documentation.md](docs/5_tests_documentation.md) - ID 5
- [docs/5.1_local_suites_documentation.md](docs/5.1_local_suites_documentation.md) - ID 5.1
- [docs/5.2_docker_fixtures_documentation.md](docs/5.2_docker_fixtures_documentation.md) - ID 5.2, `dev-tool`, `container`
- [docs/6_package_distribution_documentation.md](docs/6_package_distribution_documentation.md) - ID 6

### Sub-Maps

- [docs/1.6_ssh_map.md](docs/1.6_ssh_map.md) - ID 1.6 branch
- [docs/1.7_aftc_codex_map.md](docs/1.7_aftc_codex_map.md) - ID 1.7 branch
- [docs/1.8_docx_map.md](docs/1.8_docx_map.md) - ID 1.8 branch

### Cross-Cutting

- [docs/dependency_map.md](docs/dependency_map.md) - runtime graph, mount map, build-output contract, feature trace matrix, API consumer matrix
- [docs/contributing.md](docs/contributing.md) - workflow, conventions, release process
- [docs/development.md](docs/development.md) - dev environment + dev tools (host access, disable)
- [docs/known-gaps.md](docs/known-gaps.md) - unchecked pre-launch items + fix plans

### Dev Tools

- 5.2 Docker fixtures: `tests/ssh-replacement`, `tests/pi-linux-integration`, `tests/pi-linux-ssh-verify`, `tests/install-test` - see [docs/5.2_docker_fixtures_documentation.md](docs/5.2_docker_fixtures_documentation.md)

## Final Note

This documentation set is expected to grow. New sections may be added by the AI or the user as the project evolves; the future shape cannot be known in advance. Add a map node + master section + index entry + deep doc in the same commit as the code.

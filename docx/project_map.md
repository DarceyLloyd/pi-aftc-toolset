# pi-aftc-toolset — Project Structure Map

<!-- structure-map - last-verified: 2026-08-05 16:40 - regenerate: run /docx (uses docx/scripts/map-scan.mjs) then verify against source -->

Full structure map for pi-aftc-toolset (v1.19.1), a pi coding-agent extension package. Every documented node at every level. Sub-maps: `1.6_ssh_map.md`, `1.7_aftc_codex_map.md`, `1.8_docx_map.md` (in `docx/docs/`). File convention: `<id>_<area>_documentation.md` per map ID, `<id>_<area>_map.md` for sub-maps.

## Full Tree

```
pi-aftc-toolset/
|-1 - Application Source (extensions/aftc-toolset/)
| |-1.1 - pi Extension Runtime [framework]
| |-1.2 - Orchestrator & Core Infrastructure
| |-1.3 - UI Framework
| |-1.4 - Footer Widget & Usage Tracking
| |-1.5 - Feature Modules (slash commands)
| |-1.6 - SSH Subsystem (ssh/) [sub-map]
| | |-1.6.1 - SSH Orchestration & Model Tools
| | |-1.6.2 - Session Manager
| | |-1.6.3 - Carrier Bridge
| | |-1.6.4 - Python SSH Carrier
| | |-1.6.5 - Connection Store
| | |-1.6.6 - SSH UI Overlays
| | \-1.6.7 - Redaction
| |-1.7 - aftc-codex Knowledge Base (aftc-codex/) [sub-map]
| | |-1.7.1 - Codex Coordinator
| | |-1.7.2 - Codex Store
| | |-1.7.3 - System-Prompt Injection
| | |-1.7.4 - Technology Detection
| | |-1.7.5 - Learn Loop
| | |-1.7.6 - Entry Tools
| | |-1.7.7 - Compatibility Guard
| | |-1.7.8 - Codex Commands
| | \-1.7.9 - Maintenance Scripts
| |-1.8 - docx Generator (docx/) [sub-map]
| | |-1.8.1 - /docx Command & Orchestration
| | |-1.8.2 - Deterministic Backup
| | |-1.8.3 - Documentation Guide
| | \-1.8.4 - Model-Run Scripts
| |-1.9 - Intro Animations (intros/)
| |-1.10 - Providers (providers/) [disabled]
| \-1.11 - Audio Player Binaries (bin/)
|-2 - Shipped Data (data/)
|-3 - Skills (skills/)
|-4 - Themes (themes/)
|-5 - Tests (tests/)
| |-5.1 - Local Test Suites
| \-5.2 - Docker Test Fixtures [dev-tool, container]
\-6 - Package & Distribution
```

## Annotations

- 1 Application Source — all extension TypeScript, loaded by pi via jiti (no build) — status: done
- 1.1 pi Extension Runtime [framework] — peer-dep runtime the extension is built on (`@earendil-works/pi-coding-agent`, pi-ai, pi-tui, typebox) — [1.1_pi_runtime_documentation.md](docs/1.1_pi_runtime_documentation.md) — status: done
- 1.2 Orchestrator & Core Infrastructure — index.ts wiring, shared types, paths, config, db — [1.2_orchestrator_core_documentation.md](docs/1.2_orchestrator_core_documentation.md) — status: done
- 1.3 UI Framework — GRUB-style dialogs (aftc-ui) + severity console facade (aftc-console) — [1.3_ui_framework_documentation.md](docs/1.3_ui_framework_documentation.md) — status: done
- 1.4 Footer Widget & Usage Tracking — 1Hz diagnostics widget, SQLite recording, allowance quotas, HTML usage report — [1.4_footer_usage_documentation.md](docs/1.4_footer_usage_documentation.md) — status: done
- 1.5 Feature Modules — 15 self-contained slash-command modules — [1.5_feature_modules_documentation.md](docs/1.5_feature_modules_documentation.md) — status: done
- 1.6 SSH Subsystem — credential-isolated SSH via packaged Python Paramiko carrier — [1.6_ssh_documentation.md](docs/1.6_ssh_documentation.md), [1.6_ssh_map.md](docs/1.6_ssh_map.md) — status: done
- 1.7 aftc-codex Knowledge Base — opt-in rules/guidance injection + self-education tools — [1.7_aftc_codex_documentation.md](docs/1.7_aftc_codex_documentation.md), [1.7_aftc_codex_map.md](docs/1.7_aftc_codex_map.md) — status: done
- 1.8 docx Generator — /docx project documentation generator — [1.8_docx_documentation.md](docs/1.8_docx_documentation.md), [1.8_docx_map.md](docs/1.8_docx_map.md) — status: done
- 1.9 Intro Animations — startup wordmark animation (factory disconnected) — [1.9_intros_documentation.md](docs/1.9_intros_documentation.md) — status: done
- 1.10 Providers [disabled] — QwenCloud provider module, superseded by pi's native provider support — [1.10_providers_documentation.md](docs/1.10_providers_documentation.md) — status: done
- 1.11 Audio Player Binaries — bundled miniaudio players + C source — [1.11_audio_binaries_documentation.md](docs/1.11_audio_binaries_documentation.md) — status: done
- 2 Shipped Data — package-shipped assets: codex seed, audio MP3s, intro audio, extension-config.json — [2_shipped_data_documentation.md](docs/2_shipped_data_documentation.md) — status: done
- 3 Skills — 34 Agent Skills packages — [3_skills_documentation.md](docs/3_skills_documentation.md) — status: done
- 4 Themes — 3 pi themes — [4_themes_documentation.md](docs/4_themes_documentation.md) — status: done
- 5 Tests — local Node suites + Docker fixtures — [5_tests_documentation.md](docs/5_tests_documentation.md) — status: done
- 6 Package & Distribution — manifest, lockfiles, ignore rules, images, license — [6_package_distribution_documentation.md](docs/6_package_distribution_documentation.md) — status: done

Sub-map branch IDs (1.6.x, 1.7.x, 1.8.x, 5.x) are annotated in their owning sub-maps.

## Status legend

- `done` — documented and verified against source
- `placeholder` — file exists, content pending
- `missing` — expected doc not yet written
- `reserved` — deleted ID, never reused

## Node tags

- `framework` — 1.1 (pi extension runtime)
- `dev-tool` — 5.2 (Docker test fixtures)
- `container` — 5.2 (compose/Dockerfile fixtures)
- (no `sub-project`, `wrapper`, `shared` or `container` runtime branches — the Python carrier is load-bearing for SSH, so it is a module at 1.6.4)

## Index By Kind

- **Modules:** 1.2, 1.3, 1.4, 1.5, 1.9, 1.10, 1.11
- **Major branches (sub-maps):** 1.6 (SSH), 1.7 (aftc-codex), 1.8 (docx)
- **Sub-projects:** none
- **Containers / dev-tools:** 5.2 (ssh-test-server, pi-linux, pi-client + ssh-target, install-test image)

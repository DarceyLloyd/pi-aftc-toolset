# pi-aftc-toolset — Project Map

The single structural index for pi-aftc-toolset: the full ID tree of every
documented node, at every level. Convention: deep doc
`<id>_<area>_documentation.md`, sub-map `<id>_<area>_map.md`, leaf
`<id>_<artefact>.md`, partner docs (`_sitemap` / `_layout` / `_design`) carry
the owning node's ID. The on-disk `docx/` tree mirrors this map — a node's
folder path IS its ID ancestry.

<!-- structure-map - last-verified: 2026-08-10 14:57 - regenerate: run /docx (pi-aftc-toolset documentation generator) -->

> Do not follow these links until your work touches that area — load only the
> doc for the area you are about to work on (discovery via the master's
> Documentation Index or the annotations below).

## Full Tree

```
pi-aftc-toolset (pi extension package v1.20.2)
|- 1 Extension source (extensions/aftc-toolset)                    module
|  |- 1.1 Entry & orchestration (index.ts, types.ts)
|  |- 1.2 Core infrastructure & config (paths, config, db, debug-log, help-registry)
|  |- 1.3 UI framework (ui/)                                       module
|  |  |- 1.3.1 aftc-console (transcript + diagnostic output)
|  |  |- 1.3.2 aftc-ui (overlay dialogs, menus, forms, viewer)
|  |  \- 1.3.3 terminal-screen (VT100 virtual screen)
|  |- 1.4 Footer, cache & usage                                    module
|  |  |- 1.4.1 Cache diagnostics core (core.ts)
|  |  |- 1.4.2 Footer widget (widget surface + /aftc-footer menus)
|  |  |- 1.4.3 Subscription allowance (allowance.ts, footer line 5)
|  |  |- 1.4.4 Usage recording (usage-recording.ts, turns.db writer)
|  |  \- 1.4.5 Usage report (usage-report app + server, 5 tabs)
|  |- 1.5 Feature modules                                          module
|  |  |- 1.5.1 Keyboard shortcuts (keys.ts)
|  |  |- 1.5.2 Help & discovery (help.ts)
|  |  |- 1.5.3 Installer (/aftc-install)
|  |  |- 1.5.4 Audio notifications (notify.ts)
|  |  |- 1.5.5 Response divider (response.ts)
|  |  |- 1.5.6 Emergency stop (stfu.ts)
|  |  |- 1.5.7 Directory & navigation (/dir /ls /cwd /qd)
|  |  |- 1.5.8 Replay (/save-replay-prompt /replay /r)
|  |  |- 1.5.9 Keep it short (/keep-it-short /kis)
|  |  |- 1.5.10 Theme picker (/theme)
|  |  |- 1.5.11 Think-tag parser (think-parser.ts)
|  |  |- 1.5.12 run_script tool (run-script.ts)
|  |  |- 1.5.13 Startup intros (intros/)
|  |  |- 1.5.14 Providers (providers/ — DISABLED)
|  |  \- 1.5.15 aftc-resume (resume.ts)
|  |- 1.6 SSH feature (ssh/)                                       module
|  |  |- 1.6.1 Command & tool surface (ssh/index.ts)
|  |  |- 1.6.2 Sessions & lifecycle (session.ts)
|  |  |- 1.6.3 Connection store (ssh.json)
|  |  |- 1.6.4 Redaction & safe errors (redaction.ts)
|  |  |- 1.6.5 Connection manager screen (/ssh-cm)
|  |  |- 1.6.6 New connection dialog
|  |  |- 1.6.7 Connection form & auth overlays
|  |  |- 1.6.8 Confirm overlay
|  |  |- 1.6.9 Interactive terminal overlay (/ssh-shell)
|  |  \- 1.6.10 Python carrier (ssh/carrier/)                      sub-project
|  |     |- 1.6.10.1 Daemon & JSON-RPC (daemon.py, rpc.py, __main__.py)
|  |     |- 1.6.10.2 Sessions & modes (session.py, shell_mode.py, exec_mode.py, monitor.py)
|  |     |- 1.6.10.3 SFTP & port forwarding (sftp_ops.py, port_forward.py)
|  |     \- 1.6.10.4 Safety (keys.py, redaction.py, errors.py)
|  |- 1.7 aftc-codex knowledge base (aftc-codex/)                  module
|  |  |- 1.7.1 Store, seeding & version lifecycle (aftc-codex.ts, codex-store.ts, codex-compat.ts, codex-sync.ts)
|  |  |- 1.7.2 System-prompt injection & detection (codex-inject.ts, codex-detect.ts)
|  |  |- 1.7.3 Commands (/aftc-codex-* menus & commands)
|  |  |- 1.7.4 Model tools (codex_load/add/edit/remove)
|  |  \- 1.7.5 Learn & live-to-seed scripts (codex-learn.ts, scripts/)
|  |- 1.8 docx documentation generator (docx/)                     module
|     |- 1.8.1 /docx command & flow (docx.ts)
|     |- 1.8.2 Backup (docx-backup.ts)
|     |- 1.8.3 Shipped guide & type packs (documentation_guide.md, prompts/)
|     \- 1.8.4 Helper scripts (scripts/: map-scan, link-audit, ui-hints, zip-old)
|  \- 1.9 Sub-agents, codename 007 (subagents/)                   module
|     |- 1.9.1 Config (subagent-config.ts)
|     |- 1.9.2 Catalog + seed/sync (subagent-catalog.ts)
|     |- 1.9.3 RPC child transport (subagent-rpc-child.ts)
|     |- 1.9.4 Child runtime (child-runtime.ts)
|     |- 1.9.5 Supervisor (subagent-supervisor.ts)
|     |- 1.9.6 Tool + factory (subagents.ts)
|     \- 1.9.7 Commands & UI (subagent-commands.ts, subagent-ui.ts)
|- 2 Packaging & shipped assets                                    module
|  |- 2.1 Shipped data (extensions/aftc-toolset/data/)
|  |- 2.2 Bundled skills (skills/)
|  |- 2.3 Bundled themes (themes/)
|  \- 2.4 Release & maintainer scripts (shipit.ps1, backup.ps1, clear-docker.bat)
\- 3 Tests (tests/ - not committed; usage rules in AGENTS.md)         module
\- 4 Project website & feedback (dev.aftc.uk/)                      module
```

## Annotations

| ID | Name | Tags | Deep doc | Sub-map | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Extension source | `module` | [1_extension_documentation.md](1_extension_source/1_extension_documentation.md) | [1_extension_map.md](1_extension_source/1_extension_map.md) | done |
| 1.3 | UI framework | `module`, `shared` | [1.3_ui_documentation.md](1_extension_source/1.3_ui/1.3_ui_documentation.md) | [1.3_ui_map.md](1_extension_source/1.3_ui/1.3_ui_map.md) | done |
| 1.4 | Footer, cache & usage | `module` | [1.4_footer_usage_documentation.md](1_extension_source/1.4_footer_usage/1.4_footer_usage_documentation.md) | [1.4_footer_usage_map.md](1_extension_source/1.4_footer_usage/1.4_footer_usage_map.md) | done |
| 1.5 | Feature modules | `module` | [1.5_feature_modules_documentation.md](1_extension_source/1.5_feature_modules/1.5_feature_modules_documentation.md) | [1.5_feature_modules_map.md](1_extension_source/1.5_feature_modules/1.5_feature_modules_map.md) | done |
| 1.6 | SSH feature | `module` | [1.6_ssh_documentation.md](1_extension_source/1.6_ssh/1.6_ssh_documentation.md) | [1.6_ssh_map.md](1_extension_source/1.6_ssh/1.6_ssh_map.md) | done |
| 1.6.10 | Python carrier | `sub-project` | [1.6.10_carrier_documentation.md](1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10_carrier_documentation.md) | [1.6.10_carrier_map.md](1_extension_source/1.6_ssh/1.6.10_carrier/1.6.10_carrier_map.md) | done |
| 1.7 | aftc-codex knowledge base | `module` | [1.7_aftc_codex_documentation.md](1_extension_source/1.7_aftc_codex/1.7_aftc_codex_documentation.md) | [1.7_aftc_codex_map.md](1_extension_source/1.7_aftc_codex/1.7_aftc_codex_map.md) | done |
| 1.8 | docx documentation generator | `module` | [1.8_docx_documentation.md](1_extension_source/1.8_docx/1.8_docx_documentation.md) | [1.8_docx_map.md](1_extension_source/1.8_docx/1.8_docx_map.md) | done |
| 1.9 | Sub-agents (007) | `module` | [1.9_subagents_documentation.md](1_extension_source/1.9_subagents/1.9_subagents_documentation.md) | [1.9_subagents_map.md](1_extension_source/1.9_subagents/1.9_subagents_map.md) | done |
| 2 | Packaging & shipped assets | `module` | [2_packaging_documentation.md](2_packaging/2_packaging_documentation.md) | [2_packaging_map.md](2_packaging/2_packaging_map.md) | done |
| 3 | Tests | `module` | [3_tests_documentation.md](3_tests/3_tests_documentation.md) | — | done |
| 4 | Project website & feedback | `module` | [4_project_website_documentation.md](4_project_website_documentation.md) | — | done |

Leaf-node annotations (1.1, 1.2, 1.3.x, 1.4.x, 1.5.x, 1.6.x, 1.6.10.x,
1.7.x, 1.8.x, 2.x, 3.x) live in the owning sub-map listed above.

### Status legend

- `done` — doc exists and was verified against source this pass.
- `placeholder` — stub awaiting depth.
- `missing` — node identified, doc not yet written.
- `reserved` — deleted ID, never reused.

### Node tags

- `module` — internal module of the extension package.
- `sub-project` — own manifest/runtime/entry point; folder read-only for docs (1.6.10).
- `shared` — shared utility imported by many features (1.3).
- `framework` — runtime foundation (pi itself is a peer dependency, documented by reference in 1.1; no wrapper).
- `wrapper`, `container`, `dev-tool` — unused: this package ships no containers (Docker exists only inside the tests/ suites).

## Index By Kind

- Modules: 1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 3, 4
- Sub-projects: 1.6.10 (Python SSH carrier)
- Containers: none (test-only Docker lives in the tests/ folder)
- Dev tools: Docker containers of the Linux gates — see [development.md](development.md)

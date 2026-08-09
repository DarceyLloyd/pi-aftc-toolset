# Dependency Map

<!-- last-verified: 2026-08-07 21:35 -->

The cross-ID view no deep doc owns. Table-heavy, keyed by map ID, no
prose. Package/library deps are NOT listed here (see `package.json` and
`ssh/carrier/pyproject.toml`).

## References

- Master: [project_documentation.md](./project_documentation.md)
- Full project map: [project_map.md](./project_map.md)
- Map: [project_map.md](./project_map.md)

## 1. Runtime graph

Process/component dependencies and startup order:

| From | To | Relation |
| --- | --- | --- |
| pi host | 1 (`extensions/aftc-toolset/index.ts`) | jiti-loads the default export once |
| 1 | 1.2 `migrateLegacyData` | MUST run before any module reads the data dir |
| 1 | 1.3.1 `aftcConsole.init` | once per session, before any output |
| 1.4.2 footer widget | 1.4.1 core | via `FooterDataProvider` (injected by 1) |
| 1.4.1 core | 1.4.4 recorder | `TurnRecorder` (injected by 1) |
| 1.4.1 core | 1.4.3 allowance | `AllowanceProvider` (injected by 1) |
| 1.4.4 / 1.4.5 | 1.2 `db.ts` | shared SQLite singleton (null-safe) |
| 1.6.1 | 1.6.2 `SshSessionManager` | all commands/tools |
| 1.6.2 | 1.6.10 carrier | lazy spawn `uv run --locked … python -m aftc_ssh_carrier`; ready handshake ≤15 s; reaped 30 s after last session; terminated on session_shutdown |
| 1.7 (all) | 1.7.1 store | live copy `<dataDir>/aftc-codex` + seed under `data/` |
| 1.5.3 installer | npm + uv | installs 1.2 db binding + 1.6.10 env |
| 1.8.1 /docx + /docx-update | 1.8.2 backup | backup errors abort BEFORE the model runs |
| 1.9.6 subagent tool | 1.9.5 supervisor | schedules runs; one foreground run per tool call |
| 1.9.5 supervisor | 1.9.3 RPC child | spawns `pi --mode rpc` children (1.9.4 runtime via `-e`); tree-kill on every exit path |
| 1.9.6 | 1.4.3 allowance | spend confirm gate before spawn |
| 1.9.6 footer builder | 1.4.2 footer widget | line 6 via the orchestrator's `extras.subAgentLine(colors)` callback (wired by 1) |

Health gates: carrier `ready` handshake; `/aftc-install` verification
probe (`import paramiko, aftc_ssh_carrier`); db null-degradation.

## 2. Mount map (persistent files ↔ readers/writers)

Host path base: `<dataDir>` = `%APPDATA%\pi-aftc-toolset\data` (override
`AFTC_TOOLSET_DATA_ROOT`) — rw for all; nothing mounts read-only.

| File | Written by (ID) | Read by (ID) |
| --- | --- | --- |
| `<dataDir>/config.json` | 1.2 (setPreference/migration) | every feature with a preference (1.4, 1.5.x, 1.7) |
| `<dataDir>/ssh.json` | 1.6.3 | 1.6.1/1.6.5/1.6.6/1.6.7 |
| `<dataDir>/turns.db` | 1.4.4 (turns+tasks) | 1.4.1 (timeframe stats), 1.4.5 (report) |
| `<dataDir>/usage-report/` (app folder + generated `data.json`) | 1.4.5 | browser via local server |
| `<dataDir>/debug.log` | 1.3.1 | user |
| `<dataDir>/aftc-codex/**` | 1.7.1 seeding/sync + 1.7.4 entry tools | 1.7.2 injection, 1.7.4 codex_load |
| `<dataDir>/subagents-config.json` | 1.9.1 | 1.9.x (fresh read on every access) |
| `<dataDir>/subagents/agents/**` | 1.9.2 seed/sync/reset | 1.9.2 catalog, 1.9.6 spawn |
| `<dataDir>/subagents/runs/<id>/**` | 1.9.5 (meta, transcript, report) | 1.9.7 status UI |
| `<package>/extensions/aftc-toolset/data/**` (seed) | 1.7.5 live-to-seed (maintainer) | 1.7.1 seeding/sync (read), 1.9.2 agent seed (read) |
| `<package>/extensions/aftc-toolset/docx/**` | maintainers | 1.8.1 prompt assembly (read) |

## 3. Build-output contract

| Builder | Output | Owns | Must preserve |
| --- | --- | --- | --- |
| npm pack/publish (2.4, `.npmignore`) | npm artifact | everything shipped | never ships `.env`, credentials, dev folders; carrier SOURCE included (npm-package-check asserts) |
| /docx generation (1.8) | target project's `docx/` + README | generated docs | AGENTS.md (edit in place), code-adjacent partner readmes (backup skips them) |
| `sync-codex-resources.mjs` | live `codex-resource-list.md` | the generated list | never copies it into the seed (1.7.5) |
| zip-old.mjs | `docx/backups/<labelled timestamp>.zip` | the zip | deletes `old_docs/` only after the zip entry count verifies |

## 4. Feature trace matrix

| Feature | UI/surface ID(s) | Command/tool ID(s) | Storage ID(s) |
| --- | --- | --- | --- |
| Footer dashboard | 1.4.2 | 1.4.1 commands, `/aftc-footer` | 1.2 (config prefs), 1.4.4 (turns.db read via 1.4.1) |
| Subscription allowance | 1.4.2 line 5 | — (event-driven) | 1.4.3 in-memory snapshot |
| Usage report | 1.4.5 tabs | `/usage-report`, `/usage-clear` | 1.4.4 turns/tasks, `usage-report/` app + `data.json` |
| SSH | 1.6.5–1.6.9 | 1.6.1 (16 cmds + 20 tools) | 1.6.3 ssh.json |
| aftc-codex | 1.7.3 menus | 1.7.3 commands, 1.7.4 tools | 1.7.1 live copy + seed (2.1), config prefs |
| docx generator | 1.8.1 modals | `/docx`, `/docx-update` | target project docx/ (not this package) |
| Sub-agents (007) | 1.9.7 menus/status/kill | `subagent` tool, `/007` family | 1.9.1 config, 1.9.2 live agents + seed (2.1), 1.9.5 run records; spend in-memory only |
| Audio notifications | 1.5.4 hub | `/aftc-audio-notifications`, `/aftc-notify-time` | 1.2 config prefs; assets 2.1 |
| Shortcuts | — | 1.5.1 | — |
| Help | 1.5.2 viewer | `/aftc-help` | 1.2 help-registry (module state) |
| Theme picker | 1.5.10 | `/theme` | pi-owned |
| Replay | — | 1.5.8 | `replayPrompt` pref (1.2) |
| Intros | 1.5.13 widget | `/aftc-intro-on|off` | `aftc-intro` pref (1.2); assets 2.1 |
| Think parser | — | enable/disable cmds | `thinkProcessingEnabled` pref |
| run_script | — | `run_script`, on/off cmds | `runScriptEnabled` pref |

## 5. API consumer matrix

No HTTP APIs — this is an extension package. Consumer relationships that
play the same role:

| Consumer | Provider surface |
| --- | --- |
| The AI model | 1.6.1 ssh_* tools · 1.7.4 codex_* tools · 1.5.12 run_script · 1.9.6 subagent · prompt snippets/guidelines of all tools |
| pi TUI | 1.3.2 overlay components · 1.4.2 widget · 1.5.13 intro widget · entry renderers (1.3.1, 1.5.5, 1.5.7, 1.5.8) |
| pi event bus | every module's `pi.on` hooks (enumerated per module in 1.4.1, 1.5.4, 1.5.11, 1.7.2) |
| Browser | 1.4.5 report app (via local server) |
| Child pi processes | 1.9.3/1.9.4 JSONL over stdio (`pi --mode rpc`) |
| OS file manager / clipboard / audio | 1.5.7 open · 1.5.1 clipboard · 1.5.4 player binary (2.1) |

## Related

- [project_map.md](project_map.md) · [contributing.md](contributing.md)

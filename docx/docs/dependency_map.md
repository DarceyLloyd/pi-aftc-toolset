# Dependency Map

The cross-ID dependency view. Table-heavy, keyed by map ID; prose lives in the deep docs.

<!-- structure-map - last-verified: 2026-08-05 02:05 - regenerate: run /docx -->

## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [project_map.md](../project_map.md)


## 1. Runtime graph

| ID | Component | Depends on (by ID) | Startup order / health gates |
| --- | --- | --- | --- |
| 1.1 | pi runtime | — (peer) | pi loads the package at startup |
| 1.2 | orchestrator/core | 1.1 | factory runs first; `migrateLegacyData()` before any module reads data |
| 1.3 | UI framework | 1.1 | `aftcConsole.init(pi)` first in the factory |
| 1.4 | footer/usage | 1.1, 1.2 | better-sqlite3 present (else degrade with a log line) |
| 1.5 | feature modules | 1.1, 1.2, 1.3 | registered by the factory; notify needs no deps |
| 1.6 | SSH subsystem | 1.1, 1.2, 1.3 | carrier lazily spawned on first SSH use; ready handshake gates `ready`; 30s grace stop after last disconnect |
| 1.7 | aftc-codex | 1.1, 1.2, 1.3 | off by default; enable seeds; compat guard gates all features |
| 1.8 | docx | 1.1, 1.3 | adm-zip present (npm install / `/aftc-install`) for zip-old |
| 1.9 | intros | 1.1, 1.2 | plays on `session_start` when enabled |
| 1.10 | providers | 1.1 | DISABLED — not started |
| 1.11 | audio binaries | — | spawned detached per sound |
| 5.2 | docker fixtures | Docker Desktop | built/healthy before suites run |

## 2. Mount map

| Host path | Consumer path | ro/rw | Which IDs read/write |
| --- | --- | --- | --- |
| OS data dir (`%APPDATA%\pi-aftc-toolset\data` win) | extension runtime | rw | 1.2 (config/db/ssh.json/report), 1.7 (live codex) |
| `extensions/aftc-toolset/data/` | extension runtime | ro (in place) | 1.5 (MP3s), 1.7 (seed), 1.9 |
| tests fixtures → container `/opt/pi-aftc-toolset` | docker fixtures | rw (container-local) | 5.2 |

## 3. Build-output contract

| Builder | Output dir | Owns vs must preserve |
| --- | --- | --- |
| npm install | `node_modules/` | owns (gitignored) |
| `uv sync --locked` | `ssh/carrier/.venv/` | owns (gitignored; platform-local — never mix host/container) |
| usage-report | `<dataDir>/report.html` | owns |
| sync-codex-resources.mjs | `<dataDir>/aftc-codex/codex-resource-list.md` | owns (never ship in the seed) |
| docx (in a USER's project) | `./docx/` + root README.md + AGENTS.md block | owns `./docx/`; must preserve the rest of AGENTS.md verbatim; never touches other folders |
| tests | `tests/docx/docx_test_*` | own (recreated per run) |

## 4. Feature trace matrix

| Feature | UI ID(s) | Logic ID(s) | Storage ID(s) |
| --- | --- | --- | --- |
| Footer widget | 1.4 (setWidget) | 1.4 core | 1.2 (turns.db, config) |
| Usage report | 1.4 (report.html) | 1.4 | 1.2 (turns.db) |
| SSH | 1.6.6 | 1.6.1–1.6.4 | 1.6.5 (ssh.json) |
| aftc-codex | 1.7.8 | 1.7.1–1.7.7, 1.7.9 | 1.2 (config), 2 (seed), live dir |
| docx | 1.8.1 | 1.8.1–1.8.4 | user's project (./docx/) |
| Audio notifications | 1.5 (notify menus) | 1.5 (notify events) | 1.2 (config), 2 (MP3s), 1.11 (players) |
| Shortcuts/commands | 1.3 | 1.5 | 1.2 (config) |
| Skills/themes | pi pickers | 3, 4 | — |

## 5. API consumer matrix

No HTTP APIs. Model-tool consumers instead:

| Tool group | Consumed by | Provided by ID |
| --- | --- | --- |
| `ssh_*` tools | the model | 1.6.1 |
| `codex_*` tools | the model | 1.7.1, 1.7.6 |
| `run_script` | the model | 1.5 |
| slash commands | the user | 1.5, 1.6.1, 1.7.8, 1.8.1 |

## Related

- [contributing.md](./contributing.md), [development.md](./development.md), and every deep doc by ID

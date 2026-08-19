# Development

Dev environment for pi-aftc-toolset: toolchain, running the extension
from source, and the dev-only tooling.

<!-- last-reviewed: 2026-08-09 22:30 -->

## References

- Master: [project_documentation.md](./project_documentation.md)
- Full project map: [project_map.md](./project_map.md)
- Map: [project_map.md](./project_map.md)

## Overview

Windows-only development (the maintainer machine). TypeScript runs
directly under pi's jiti loader — there is no compile/build/bundle step and
no `dist/`.

## Prerequisites

| Tool | Why |
| --- | --- |
| pi (`@earendil-works/pi-coding-agent` ≥ 0.81; developed vs 0.83.0) | host; provides jiti + the extension API |
| Node.js + npm | package manifest, `npm install` for better-sqlite3 |
| Python 3.10+ and `uv` | SSH carrier locked env (`uv sync --locked`) |
| WinRAR (optional) | `backup.ps1` repo snapshots |

Install the runtime deps from inside pi: `/aftc-install` (1.5.3).

## Running from source

pi loads the package via its `pi` manifest (`./extensions`, `./skills`,
`./themes`). Develop by pointing pi at this checkout (pi packages /
`pi install <path>`); `/reload` inside pi re-reads changed TS through
jiti. Debug chatter: `/aftc-debug-log-on` (stdout) — everything is always
filed to `<dataDir>/debug.log` (1.2/1.3.1).

## Dev tools

| Tool | Summary | Host access | Disable | Doc |
| --- | --- | --- | --- | --- |
| `.dev` marker folder | Gates maintainer dev tooling | n/a | Delete the folder | [1_extension_source/1.7_aftc_codex/1.7.5_learn_sync_scripts.md](1_extension_source/1.7_aftc_codex/1.7.5_learn_sync_scripts.md) |

## Data locations while developing

- Live data: `%APPDATA%\pi-aftc-toolset\data` (override with
  `AFTC_TOOLSET_DATA_ROOT`) (1.2).
- Quick access: `/qd` menu (1.5.7).

## Troubleshooting

- `better-sqlite3 not available` → `/aftc-install`.
- Carrier won't start → check uv on PATH; `/aftc-install` prints
  platform-specific recovery guidance (never exposes connection data).
- Module won't load → a jiti import/type error; check the load smoke check.

## Related

- [contributing.md](contributing.md) · [deployment.md](deployment.md) · [dependency_map.md](dependency_map.md)

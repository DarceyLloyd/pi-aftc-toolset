# Development

Dev environment for pi-aftc-toolset: toolchain, running the extension
from source, and the dev-only tooling.

<!-- last-reviewed: 2026-08-05 22:05 -->

## References

- Master: [project_documentation.md](./project_documentation.md)
- Full project map: [project_map.md](./project_map.md)
- Map: [project_map.md](./project_map.md)

## Overview

Windows-first development (the maintainer machine), Linux verified via
Docker gates. TypeScript runs directly under pi's jiti loader — there is
no compile/build/bundle step and no `dist/`.

## Prerequisites

| Tool | Why |
| --- | --- |
| pi (`@earendil-works/pi-coding-agent` ≥ 0.81; developed vs 0.83.0) | host; provides jiti + the extension API |
| Node.js + npm | package manifest, `npm install` for better-sqlite3 |
| Python 3.10+ and `uv` | SSH carrier locked env (`uv sync --locked`) |
| Docker Desktop | SSH fixture suites (3.3), Linux gates (3.4), `clear-docker.bat` |
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
| SSH fixture containers (tests/ssh-* Docker suites) | Disposable sshd container driven by the suites | Local Docker only; no published ports | Skip the suites | [3_tests/3.3_docker_suites.md](3_tests/3.3_docker_suites.md) |
| `pi-linux` gate (tests/pi-linux-integration) | Compose service running pi on Linux; consumes provider allowance via transient auth.json | Compose network only | Skip the gate | [3_tests/3.4_linux_gates.md](3_tests/3.4_linux_gates.md) |
| `pi-client` + `ssh-target` (tests/pi-linux-ssh-verify) | Allowance-free Linux client→target SSH gate | Compose network only | Skip the gate | [3_tests/3.4_linux_gates.md](3_tests/3.4_linux_gates.md) |
| install-test container (tests/install-test) | Clean-image /aftc-install verification | Local Docker only | Skip | [3_tests/3.3_docker_suites.md](3_tests/3.3_docker_suites.md) |
| `.dev` marker folder | Gates maintainer commands (`/codex-live-to-seed`) | n/a | Delete the folder | [1_extension_source/1.7_aftc_codex/1.7.5_learn_sync_scripts.md](1_extension_source/1.7_aftc_codex/1.7.5_learn_sync_scripts.md) |

Cleanup after container work: `clear-docker.bat` (2.4).

## Data locations while developing

- Live data: `%APPDATA%\pi-aftc-toolset\data` (override with
  `AFTC_TOOLSET_DATA_ROOT` — tests use temp dirs) (1.2).
- Quick access: `/qd` menu (1.5.7).

## Examples

```powershell
node tests/help-registry-check/help-registry-check.mjs
node tests/ssh-replacement/ssh-replacement.mjs
.\clear-docker.bat
```

## Troubleshooting

- `better-sqlite3 not available` → `/aftc-install`.
- Carrier won't start → check uv on PATH; `/aftc-install` prints
  platform-specific recovery guidance (never exposes connection data).
- Test loads the wrong pi → set `PI_CODING_AGENT_PATH`.

## Related

- [contributing.md](contributing.md) · [deployment.md](deployment.md) · [dependency_map.md](dependency_map.md)

# Development

Dev environment setup and every dev tool this project uses (host access, how to disable).

<!-- last-reviewed: 2026-08-05 02:05 -->

## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [project_map.md](../project_map.md)

## Overview

The project is plain TypeScript loaded by pi through jiti — no build step, no watch mode. Development = edit the module, run its test suite, `/reload` in pi.

## Prerequisites

- Node.js 22+ and npm
- pi coding agent (global)
- Python 3.10+ and uv (SSH carrier)
- Docker Desktop (integration fixtures)

## Dev tools

| Tool | Summary | Host access | Disable |
| --- | --- | --- | --- |
| Local test suites (5.1) | `node tests/<suite>/<suite>.mjs` | direct | n/a (not shipped) |
| ssh-replacement fixture (5.2) | disposable Ubuntu SSH server for e2e | `docker compose -f tests/ssh-replacement/docker-compose.yml up -d` (port 22 in-container; drivers connect over the fixture network) | `docker compose ... down -v` |
| pi-linux-integration (5.2) | full Linux pi container gate | `node tests/pi-linux-integration/pi-linux-integration.mjs` | not shipped |
| pi-linux-ssh-verify (5.2) | two-container SSH verify, no provider allowance | via its suite | not shipped |
| install-test image (5.2) | minimal install check | via its suite | not shipped |
| backup.ps1 | maintainer's pcloud backup script | run from repo root | n/a |

## Examples

```bash
npm install
node tests/codex-entries-check/codex-entries-check.mjs
node tests/pi-linux-integration/pi-linux-integration.mjs   # full Linux gate (long)
```

## Troubleshooting

- **EACCES stat on `ssh/carrier/.venv/...` after a container run** — a Linux venv was written into the Windows tree (container-side install against a rw mount); delete `.venv` from the host tree and re-run.
- **Docker fixture build times out on Ubuntu downloads** — slow archive mirror; re-run, the layer cache resumes.

## Related

- 5 Tests, 5.2 Docker Test Fixtures, 6 Package & Distribution

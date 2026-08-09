# 2 - Packaging & shipped assets

<!-- last-reviewed: 2026-08-09 22:30 -->

## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [2_packaging_map.md](./2_packaging_map.md)

## Purpose

Everything that ships in the npm artifact beside the extension code: the
`data/` seed + assets folder (2.1), 34 bundled pi skills (2.2), 3 bundled
themes (2.3), and the maintainer release tooling (2.4). Owns the
seed→live inputs consumed by aftc-codex (1.7) and notify/intro assets
consumed by 1.5.4/1.5.13. Does NOT own live per-user files (those are
1.2 data-dir territory) — live and seed are never to be confused.

## The npm artifact

`package.json` (repo root): name `pi-aftc-toolset`, version 1.20.2,
license MIT, author Darcey Lloyd. `pi` manifest points at `./extensions`,
`./skills`, `./themes`. Dependencies: `better-sqlite3` 12.11.1 (pinned;
`allowScripts` granted), `adm-zip` ^0.6.0. Peer deps (any): the three pi
packages + `typebox`. `.npmignore` (110 lines) excludes credentials,
env files, dev folders, tests fixtures' secrets etc.; carrier SOURCE is
included (verified by the tests/ folder - see AGENTS.md). Install:
`pi install pi-aftc-toolset` (npm) or from GitHub — see the README.

## Live vs seed (terminology)

- **live** = per-user copy in the persistent OS data dir (1.2): config.json,
  aftc-codex/, turns.db, ssh.json, usage-report/, debug.log. Survives
  `pi update`.
- **seed / shipped** = source-only defaults + assets inside
  `extensions/aftc-toolset/data/`. Replaced on every `pi update`. Flow is
  one-way: seed → live, copy-only.

## Related

- Sub-map: [2_packaging_map.md](./2_packaging_map.md) · Data-dir: [../1_extension_source/1.2_core_infrastructure_documentation.md](../1_extension_source/1.2_core_infrastructure_documentation.md)

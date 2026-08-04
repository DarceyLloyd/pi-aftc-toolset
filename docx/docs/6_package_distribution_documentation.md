# 6 - Package & Distribution

The npm/pi package surface: manifest, lockfiles, ignore rules, images, license, release flow.

<!-- last-reviewed: 2026-08-04 20:37 -->

## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [project_map.md](../project_map.md)

## Purpose

**Owns:** `package.json` (name `pi-aftc-toolset`, version, `pi` manifest pointing at `./extensions`, `./skills`, `./themes`; deps `better-sqlite3` 12.11.1 + `adm-zip` ^0.6.0; peer deps on the pi packages + typebox), `package-lock.json`, `.gitignore` / `.npmignore` / `.dockerignore`, `images/` (README screenshots), `LICENSE` (MIT), `backup.ps1` (maintainer's pcloud backup), `change-log.txt`.
**Does not own:** runtime data (1.2/2), code (1).
**Depends on:** npm/GitHub. **Dependents:** users (`pi install npm:pi-aftc-toolset`).

## Public API & contracts

Install: `pi install npm:pi-aftc-toolset` then `/aftc-install` + `/reload`. Release flow: tests green → `change-log.txt` entry under `Updates v<major>.<minor>.x` (newest first) → version bump (patch = fix/enhancement, minor = new feature, major = overhaul) → if the codex seed changed, bump `codexVersion` in the SAME release → `npm pack --dry-run` sanity → commit `vX.X.X` (house style) → push → GitHub release with tag/name `vX.X.X`.

## Internal architecture & data flow

`pi update` replaces the whole package dir — nothing runtime-mutable may live inside it (the persistent data dir exists for exactly this reason, 1.2). `.npmignore`/`.gitignore` keep `tests/`, `.pi-aftc-toolset/`, and dev tooling out of the tarball/repo permanently (no negation rules — a past negation leaked config/report artifacts into the tarball). `allowScripts` whitelists the better-sqlite3 postinstall.

## Configuration

Version policy per AGENTS.md "Documentation and releases".

## Setup, seeding & first run

`npm install` for dev; `/aftc-install` in pi for users.

## Testing

`tests/npm-package-check` (manifest/pack rules) + `npm pack --dry-run` before every release.

## Operational notes & known limitations

- tests/README.md is tracked although `tests/` is ignored (tracked before the rule); all other test files stay local.

## Related

- 2 Shipped Data, 5 Tests

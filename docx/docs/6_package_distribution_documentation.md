# 6 - Package & Distribution

The npm/pi package surface: manifest, lockfiles, ignore rules, images, license, release flow.

<!-- last-reviewed: 2026-08-05 07:35 -->

## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [project_map.md](../project_map.md)

## Purpose

**Owns:** `package.json` (name `pi-aftc-toolset`, version, `pi` manifest pointing at `./extensions`, `./skills`, `./themes`; deps `better-sqlite3` 12.11.1 + `adm-zip` ^0.6.0; peer deps on the pi packages + typebox), `package-lock.json`, `.gitignore` / `.npmignore` / `.dockerignore`, `.github/workflows/publish.yml` (npm publish automation), `images/` (README screenshots), `LICENSE` (MIT), `backup.ps1` (maintainer's pcloud backup), `change-log.txt`.
**Does not own:** runtime data (1.2/2), code (1).
**Depends on:** npm/GitHub. **Dependents:** users (`pi install npm:pi-aftc-toolset`).

## Public API & contracts

Install: `pi install npm:pi-aftc-toolset` then `/aftc-install` + `/reload`. Release flow: tests green → `change-log.txt` entry under `Updates v<major>.<minor>.x` (newest first) → version bump (patch = fix/enhancement, minor = new feature, major = overhaul) → if the codex seed changed, bump `codexVersion` in the SAME release → `npm pack --dry-run` sanity → commit `vX.X.X` (house style) → push → GitHub release with tag/name `vX.X.X` → publishing the release triggers `.github/workflows/publish.yml`, which publishes to npm automatically (see below).

## npm publish automation (GitHub Actions + trusted publishing)

`.github/workflows/publish.yml` publishes the package to npmjs.com on every
**published GitHub release** (plus manual `workflow_dispatch` from the Actions
tab). Auth is npm **trusted publishing** (OIDC + `--provenance`) — no
`NPM_TOKEN` secret exists anywhere. The workflow: checkout → node 22 → npm
upgraded to latest (trusted publishing needs npm >= 11.5.1) → tag/version
guard (fails the run when the release tag != `package.json` version, so a
mis-tagged release can never publish a wrong version) → `npm publish
--provenance --access public`. Tests do NOT run in CI: the suites are
local-only (`tests/` is gitignored, 5), and the package needs no build
(pi loads raw `.ts`).

One-time npmjs.com setup (package → Settings → Trusted Publisher):
select **GitHub Actions**, then:
- Owner/user: `DarceyLloyd`
- Repository: `pi-aftc-toolset`
- **Workflow filename: `publish.yml`** (filename only; must exist at
  `.github/workflows/publish.yml` in the repo)
- **Environment name: leave EMPTY** — the workflow uses no GitHub
  environment. That field is encouraged for team setups where a protected
  environment gates publishing for maintainers without npm access; this is a
  solo project, so it is not needed.

After saving, every published GitHub release auto-publishes to npm; confirm
the run is green under the repo's Actions tab.

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

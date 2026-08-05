# 6 - Package & Distribution

The npm/pi package surface: manifest, lockfiles, ignore rules, images, license, release flow.

<!-- last-reviewed: 2026-08-05 07:35 -->

## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [project_map.md](../project_map.md)

## Purpose

**Owns:** `package.json` (name `pi-aftc-toolset`, version, `pi` manifest pointing at `./extensions`, `./skills`, `./themes`; deps `better-sqlite3` 12.11.1 + `adm-zip` ^0.6.0; peer deps on the pi packages + typebox; `publishConfig.access: public`), `package-lock.json`, `.gitignore` / `.npmignore` / `.dockerignore`, `publish.bat` (local npm publish) + `.env` (gitignored + npmignored npm token), `images/` (README screenshots), `LICENSE` (MIT), `backup.ps1` (maintainer's pcloud backup), `change-log.txt`.
**Does not own:** runtime data (1.2/2), code (1).
**Depends on:** npm/GitHub. **Dependents:** users (`pi install npm:pi-aftc-toolset`).

## Public API & contracts

Install: `pi install npm:pi-aftc-toolset` then `/aftc-install` + `/reload`. Release flow: tests green → `change-log.txt` entry under `Updates v<major>.<minor>.x` (newest first) → version bump (patch = fix/enhancement, minor = new feature, major = overhaul) → if the codex seed changed, bump `codexVersion` in the SAME release → `npm pack --dry-run` sanity → commit `vX.X.X` (house style) → push → GitHub release with tag/name `vX.X.X` → publish to npm locally with `publish.bat` (see below).

## npm publishing (local token, no CI)

Publishing runs LOCALLY via `publish.bat` — no GitHub Actions, no Docker.
The npm token lives in `.env` at the repo root (one line: the raw token or
`NPM_TOKEN=<token>`; `.env` is gitignored AND npmignored — never committed,
never shipped; `.npm-token` works as a fallback name). The script writes it
into
a TEMP `.npmrc` (`NPM_CONFIG_USERCONFIG`) for the publish call only and
deletes it after, so the token never lands in the global or project .npmrc
either. `publishConfig.access` in `package.json` is `public` (no
`provenance` — provenance signing requires OIDC and fails with token auth).

One-time token setup (npmjs.com → Access Tokens → Generate New Token →
**Granular Access Token**): publish permission for `pi-aftc-toolset` with
**bypass 2FA** enabled; the package's "Publishing access" setting must allow
bypass-2FA tokens (the "Require two-factor authentication OR a granular
access token with bypass 2FA" option, not the strict disallow option). Paste
the token into `.env`.

History: a GitHub Actions + npm trusted-publishing (OIDC) workflow was tried
first and abandoned — the OIDC exchange kept failing (E404/ENEEDAUTH) despite
a correct npmjs trusted-publisher entry, node 24 and latest npm (known
footguns: setup-node's registry-url writes an empty `_authToken` that
short-circuits OIDC — npm/documentation#1960; bundled npm < 11.5.1 silently
falls back to token auth — npm/cli#8976, npm/cli#8730).

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

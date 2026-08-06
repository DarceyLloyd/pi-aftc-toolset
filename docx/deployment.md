# Deployment

How pi-aftc-toolset reaches users: npm publication, GitHub releases, and
what happens on the user's machine at update time.

<!-- last-reviewed: 2026-08-05 22:05 -->

## References

- Master: [project_documentation.md](./project_documentation.md)
- Full project map: [project_map.md](./project_map.md)
- Map: [project_map.md](./project_map.md)

## Overview

No CI, no Docker in the release path. The maintainer ships from Windows
via `shipit.ps1` / `publish.bat` (2.4). Distribution channels: npm
(`pi install pi-aftc-toolset`) and GitHub (git URL install).

## Environments

- **Dev checkout**: the repo with the `.dev` marker folder — enables
  maintainer-only commands (`/codex-live-to-seed`, 1.7.5).
- **Installed package**: under pi's extension install dir (npm global or
  git clone); the package dir is REPLACED on `pi update` — which is why
  all live state lives in the persistent data dir (1.2), not the package.

## Pipeline (manual, scripted)

1. Tests green: Windows suites first, Linux gates (3.4).
2. Changelog entry + version bump in `package.json` (+ `codexVersion`
   when the codex seed changed — 2.1).
3. `shipit.ps1`: git commit `v<version>` → push → `gh release create
   vX.X.X --title vX.X.X` (notes: changelog entry; skipped when it
   exists) → `publish.bat`.
4. `publish.bat`: token from `.env` (gitignored + npmignored) fed through
   a TEMP `.npmrc` deleted afterwards; never touches global/project
   npmrc. Verify: `npm view pi-aftc-toolset version`.

Secrets handling: the npm granular access token lives ONLY in `.env`
(publish permission for pi-aftc-toolset, bypass-2FA enabled). No token in
the repo, the npm artifact, or CI (there is no CI).

## Rollback

Unpublish is not the tool: ship a forward patch. Users can pin/install an
older version from npm or check out an older git tag. Live user data
(config.json, ssh.json, turns.db, live codex) is version-independent and
survives downgrades (write-back migration backfills missing keys, 1.2).

## What `pi update` does to users

Package dir replaced → seed assets refreshed (2.1); `migrateLegacyData`
(1.2) runs at next startup; aftc-codex auto-sync merges new seed content
into the live copy when `aftcCodexAutoSync` is on (1.7.1) — a version
mismatch otherwise surfaces `/codex-sync` / `/codex-install` guidance.

## Related

- Release scripts: [2_packaging/2.4_release.md](2_packaging/2.4_release.md) · Data persistence: [1_extension_source/1.2_core_infrastructure_documentation.md](1_extension_source/1.2_core_infrastructure_documentation.md) · Codex sync: [1_extension_source/1.7_aftc_codex/1.7.1_store_lifecycle.md](1_extension_source/1.7_aftc_codex/1.7.1_store_lifecycle.md)

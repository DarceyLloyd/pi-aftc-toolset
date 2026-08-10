# Deployment

How pi-aftc-toolset reaches users: npm publication, GitHub releases, and
what happens on the user's machine at update time.

<!-- last-reviewed: 2026-08-10 19:00 -->

## References

- Master: [project_documentation.md](./project_documentation.md)
- Full project map: [project_map.md](./project_map.md)
- Map: [project_map.md](./project_map.md)

## Overview

No CI, no Docker in the release path. The maintainer ships from Windows
via `ship-it.bat` (2.4) and publishes to npm MANUALLY (the AI never runs
`npm publish` — AGENTS.md Shipping). Distribution channels: npm
(`pi install pi-aftc-toolset`) and GitHub (git URL install).

## Environments

- **Dev checkout**: the repo with the `.dev` marker folder — enables
  maintainer-only commands (`/codex-live-to-seed`, 1.7.5).
- **Installed package**: under pi's extension install dir (npm global or
  git clone); the package dir is REPLACED on `pi update` — which is why
  all live state lives in the persistent data dir (1.2), not the package.

## Pipeline (manual, scripted)

1. Tests green: Windows suites first, Linux gates.
2. Changelog entry + version bump in `package.json` (+ `codexVersion`
   when the codex seed changed — 2.1).
3. `ship-it.bat`: git commit `v<version>` → push → `gh release create
   vX.X.X --title vX.X.X` (no notes; skipped when it exists). npm
   publishing is NOT part of the pipeline.
4. The MAINTAINER publishes to npm manually (outside the repo — no
   publish script or token file exists in it). Verify:
   `npm view pi-aftc-toolset version` after the maintainer says it is
   done.

Secrets handling: the npm granular access token lives ONLY with the
maintainer — `.env` / `publish.bat` were removed from the repo 2026-08.
The maintainer's npm access token (publish permission for
pi-aftc-toolset, bypass-2FA enabled) is configured in the maintainer's own
npm session. No token exists in the repo, the npm artifact, or CI (there
is no CI).

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

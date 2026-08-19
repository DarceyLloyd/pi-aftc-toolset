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
via `ship-it.bat` (2.4). Distribution channels: npm
(`pi install pi-aftc-toolset`) and GitHub (git URL install).

## Environments

- **Dev checkout**: the repo with the `.dev` marker folder — enables
  maintainer-only dev tooling.
- **Installed package**: under pi's extension install dir (npm global or
  git clone); the package dir is REPLACED on `pi update` — which is why
  all live state lives in the persistent data dir (1.2), not the package.

## Pipeline (manual, scripted)

1. Hands-on Windows verification by the user.
2. Changelog entry + version bump in `package.json`.
3. `ship-it.bat`: git commit `v<version>` → push → `gh release create
   vX.X.X --title vX.X.X` (no notes; skipped when it exists).

Secrets handling: nothing is stored in the repo or CI (there is no CI) -
the maintainer's credentials live only with the maintainer.

## Rollback

Unpublish is not the tool: ship a forward patch. Users can pin/install an
older version from npm or check out an older git tag. Live user data
(config.json, ssh.json, turns.db, live codex) is version-independent and
survives downgrades (write-back migration backfills missing keys, 1.2).

## What `pi update` does to users

Package dir replaced → seed assets refreshed (2.1); `migrateLegacyData`
(1.2) runs at next startup; the codex fixed docs re-copy into the live
codex when the package version changes (1.7.1). User codex resources and
the SQLite usage DB are never touched.

## Related

- Release scripts: [2_packaging/2.4_release.md](2_packaging/2.4_release.md) · Data persistence: [1_extension_source/1.2_core_infrastructure_documentation.md](1_extension_source/1.2_core_infrastructure_documentation.md) · Codex fixed-doc refresh: [1_extension_source/1.7_aftc_codex/1.7.1_store_lifecycle.md](1_extension_source/1.7_aftc_codex/1.7.1_store_lifecycle.md)

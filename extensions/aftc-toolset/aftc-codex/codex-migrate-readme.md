# codex-migrate.ts

Structural resource-layout migration (plan.md D18): moves the LIVE resources
tree from the legacy layout to the v1 layout, preserving learned entries.
Pure data module — no pi imports.

## What it does

`runCodexResourceMigration(store)` applies the plan.md 4.1 move map, then the
live-only evaluation sweep:

- `design/` -> `ui-ux/` (rename + platform nesting: web/, desktop/, mobile/,
  plugin/; design-common.md -> ui-ux-common.md)
- `design/documentation-generation.md` + `design/planning.md` merged into the
  root-level `documentation-and-planning.md`
- `design/path-classification.md` merged into `languages/languages-common.md`
- 3 cross-language entries ([EHm7AF, D3eoMz, dx18VQ]) moved out of
  `languages/python.md` into `languages-common.md` (kv9k6Y stays)
- `tools/mysql.md` -> `database/`; apache/nginx/vsftpd/docker ->
  `servers-and-containers/`
- **Live-only file evaluation sweep (design/ -> ui-ux/)**: any topic file the
  move map does NOT know about — a USER-CREATED topic (eg
  `design/user-notes.md`, `design/custom/x.md`) or a variant no published
  seed matched — would orphan in the legacy `design/` folder, which does not
  exist in the v1 layout. It is RELOCATED into `ui-ux/` preserving its
  relative path (flat -> `ui-ux/<name>.md`; nested `design/<sub>/<x>.md` ->
  `ui-ux/<sub>/<x>.md`, so a `<sub>` that IS a platform name lands in that
  platform folder). When the target already exists, entries merge by [ID]
  and the source is removed. Never deletes user content. This is what makes
  the upgrade from the PUBLISHED package (which ships the legacy layout)
  lossless for users' own topics — without it, `design/` leftovers linger in
  a category that no longer exists (the 81-file duplicate-union regression).
- the emptied legacy `design/` folder is pruned

## Contract (locked)

- Runs from the codex startup path (first session_start, wired in
  aftc-codex.ts), BEFORE any seed sync / removal-list application. NEVER in
  the factory. When the migration ran but could not finish, the auto-sync is
  skipped for that run (removals must never delete un-migrated learned
  entries).
- Idempotent + resumable: every move/merge is a no-op when already done; a
  crash mid-migration completes on the next run.
- Merge semantics (append by [ID]): absent ID -> appended at the end of its
  section; same ID + same text -> skipped; same ID + different text -> BOTH
  kept (incoming entry gets a fresh ID). No user text is ever dropped, no
  duplicate IDs in one file.
- `aftcCodexResourceVersion` (config, default 0 = legacy) is stamped
  `CODEX_RESOURCE_VERSION` (1) ONLY on full completion. Fresh seeds stamp 1
  directly (codex-store seed()).
- Fail-soft per step; one failed move never aborts the rest.

Tests: `tests/codex-migrate-check/` (62 checks incl. crash-resume) and
`tests/codex-upgrade-check/` (35 checks — the REAL published-package upgrade:
published seed fixture + synthetic user entries -> migration + sync, entries
land in the right v1 homes, user-created design/ files relocate to ui-ux/,
no legacy paths, no orphans, version stamps, idempotent).

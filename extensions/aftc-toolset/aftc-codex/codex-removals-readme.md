# codex-removals.ts

Shipped-seed resource removals — the deletion half of the seed -> live
update. The merge (`scripts/seed-to-live-sync.mjs`) is strictly additive
and never deletes anything from the user's live codex; this module
removes topics the maintainer deleted or renamed in the seed, so stale
files do not linger (and do not keep appearing in the regenerated
`codex-resource-list.md`).

## Mechanism

The SEED ships `codex-resource-removal-list.json` — a cumulative JSON
array of paths relative to `resources/`, forward slashes on every
platform:

```json
["frameworks/aftc-framework.md"]
```

- Read from the **seed dir only**, every sync — never copied to live,
  users never need or see it.
- Deletion is idempotent, so the list only ever grows; no history
  tracking is needed (an already-removed file is a silent no-op).

## Export

`applySeedRemovals(store): CodexRemovalResult` — synchronous, never
throws. Returns `{ removed, lines }` where `lines` are report strings
(`REMOVED    <rel> (obsolete shipped resource)`) for the sync output /
viewer.

## Callers

Exactly one: `runSeedToLiveUpdate()` in `codex-sync.ts` — the shared
core behind startup auto-sync AND `/codex-sync`. NOT applied by
`/codex-live-to-seed` (opposite direction) or `/codex-install`
(wipe + re-seed; nothing survives anyway).

## Safety (fail-soft, never escapes the live resources dir)

- Only `.md` files under `<live>/resources/` can be removed.
- Entries are split on `/` (backslashes normalised first); empty, `.`
  and `..` segments, drive letters and absolute paths are rejected; the
  resolved target is re-checked to stay inside the resources dir.
- Missing list file, bad JSON, non-array or non-string entries -> empty
  result, no error.
- fs failures (file vanished mid-run, unreadable) are swallowed.
- A category folder left empty by a removal is removed too (never
  touches `resources/` itself or non-empty folders).
- Learned entries inside a removed file are deleted with it — an
  explicit maintainer decision (the topic is gone), per user direction.

## Cross-platform

List entries are validated as slash-separated strings, then joined with
`node:path` (`path.resolve` + `path.sep` containment check), so they
resolve correctly on Windows, Linux and macOS.

## Rules

- No pi imports (pure logic), no state, no caching.
- Fail-soft everywhere: removals can delay or skip files but must never
  break a sync.

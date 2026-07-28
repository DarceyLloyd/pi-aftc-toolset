# codex-merge.ts

Seed → live merge behind the `/aftc-codex-sync` command (alias `/codex-sync`).
Brings the user's live codex dir up to date with the shipped package seed
after a `pi update`, WITHOUT ever destroying the user's own entries. Pure
deterministic TypeScript — the AI model is never involved.

## Contract

- **Pure module.** No pi imports, no store imports. The single export
  `mergeCodexSeedIntoLive(seedDir, liveDir)` takes the two codex ROOTS (the
  dirs containing `codex-rules.md` + `resources/`), so it is unit-testable
  against plain temp dirs.
- **Never throws.** Every I/O op is best-effort try/catch; problems land in
  `report.errors` and the merge continues.
- **Idempotent.** Re-running with nothing new is a no-op ("already up to
  date"). Never deletes a live file. The three FIXED maintainer docs
  (`codex-rules.md`, `markdown-guidance.md`, `thought-and-action-guidance.md`) ARE
  overwritten from the seed when their content differs (shipped rule/guidance updates
  win); all learned content (`resources/`) is preserved.

## Steps (in order)

1. Live codex dir missing → copy the whole seed over, STOP.
2. `codex-rules.md` → FIXED doc: ALWAYS overwrite from the seed (if content
   differs or it is missing).
3. `markdown-guidance.md` → FIXED doc: ALWAYS overwrite from the seed.
4. `thought-and-action-guidance.md` → FIXED doc: ALWAYS overwrite from the seed.
5. `resources/` missing → copy the whole seed resources tree, STOP.
6. Merge pass over the seed `resources/` tree (category folders discovered
   dynamically, any depth):
   - Seed `.md` missing on the live side → copy it (mkdir as needed).
   - File exists in both → parse the SEED entries and append any whose
     `[ID]` is absent from the live file. An ID present anywhere in the live
     content (even with edited text) keeps the USER'S version untouched.
     ID-less legacy seed entries are skipped (nothing to match on).
   - Live-only files/folders → never touched.

The command handler (in `codex-commands.ts`) then ALWAYS spawns
`sync-codex-resources.mjs` (via `store.runSyncScript()`), even when nothing
changed, and reports a summary (viewer in TUI, console lines in print mode).

## Entry parsing

An entry starts at a top-level bullet matching `- [xxxxxx]` (6 alphanumeric
chars) and continues through following lines that are blank or indented (the
`Cause:` / `Fix:` continuation lines), stopping before the first non-blank,
non-indented line (the next entry, a heading, etc). Trailing blank lines are
trimmed. Missing entries are appended to the end of the live file separated
by blank lines.

## Report

```typescript
interface CodexMergeReport {
    createdLiveDir: boolean;       // step 1 fired (full seed copy)
    createdResourcesDir: boolean;  // step 5 fired (full resources copy)
    copiedFiles: string[];         // rel paths (forward slashes)
    merged: Array<{ file: string; ids: string[] }>;  // per-file appended IDs
    errors: string[];              // non-fatal problems
}
```
```

## `codexNeedsSync(seedDir, liveDir)`

Read-only counterpart: would the merge change anything? Returns `true` when a FIXED
doc (`codex-rules.md` / `markdown-guidance.md` / `thought-and-action-guidance.md`) is
missing OR its content differs from the seed, `resources/` is missing, a seed resource
file is missing on the live side, or a seed entry `[ID]` is absent from the matching
live file. User edits to learned files (resources/) and user-only files/entries do NOT
count as out-of-sync.
Fail-soft: any read problem answers `false` (never nag on error). Used by
`codex-inject.ts` to add a white `NOTICE: ... run /codex-sync` line to the
fresh-session prep notice when the live copy is behind the shipped seed.

# codex-sync.ts

The shared seed -> live update core — ONE implementation of the
non-destructive codex update so the two callers can never drift apart.

## Callers

| Caller | Adds |
| --- | --- |
| `/codex-sync` command (codex-commands.ts) | Guards (seeded? out of date?), the TUI viewer / headless print of the merge output, the conflict warning, the state-based success message (disabled -> `/codex-enable`; prepped -> `/codex-refresh`; else `/codex-init`). |
| Startup auto-sync (aftc-codex.ts coordinator) | The `aftcCodexAutoSync` pref (default ON), `session_start` reason `"startup"` gate (a pi update lands between processes, so reload/resume can never see a newer seed), fire-and-forget background run, and the "AFTC Codex auto-synced vX -> vY" transcript notice. |

## Export

`runSeedToLiveUpdate(store): Promise<CodexSyncResult>` — never throws:

1. Spawn `seed-to-live-sync.mjs` via `store.runSeedToLiveSync()`.
2. Empty output = spawn/script failure -> return immediately (callers treat
   it as "sync failed"; the version guard and its messages stay as fallback).
3. Stamp the live version pref (`aftcCodexVersion`) to the shipped seed
   version (`readCodexSeedVersion`) so the guard clears — same as a seed.
4. `runEnsureIds()` + `runSyncScript()` (ID backfill + resource-list regen).

`CodexSyncResult = { output, newVersion, conflicts }` — `conflicts` is true
when the merge reported same-[ID]-different-text entries (the LIVE version is
always kept on conflict; the user reviews by hand).

## Rules

- The merge itself (what is non-destructive, what gets copied/merged) lives in
  `scripts/seed-to-live-sync.mjs` — this module owns only the run mechanics.
- Fail-soft everywhere: a thrown anything returns `{ output: "", ... }`.
- No pi imports (pure logic), no state, no caching (config reads/writes are
  fresh disk hits per the project config rule).

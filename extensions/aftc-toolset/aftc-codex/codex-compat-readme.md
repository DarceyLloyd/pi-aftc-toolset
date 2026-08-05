# codex-compat.ts

Codex version compatibility guard.

## What it does

Compares the shipped seed's version against the version the user's live
copy was seeded from:

- **Seed version** — integer `codexVersion` in the package's
  `extensions/aftc-toolset/data/extension-config.json` (one level UP from the codex seed
  dir; never copied to the live side).
- **Live version** — the `aftcCodexVersion` preference in the user's
  `config.json`, stamped by every full seed (`codex-store.seed()`).

## Exports

| Export | Purpose |
| --- | --- |
| `CodexCompatResult` | `{ isSafe: boolean; message: string }` |
| `readCodexSeedVersion(seedDir)` | Seed version, or `null` when missing/unreadable/not a number (callers MUST treat `null` as "unknown" and skip all version logic). |
| `bumpCodexSeedVersion(seedDir)` | `codexVersion` + 1 in the shipped `extension-config.json` (fresh read-modify-write; returns the NEW version, `null` on missing/unreadable/non-number — fail-soft, nothing written). Called by `/codex-live-to-seed` after an apply that actually wrote seed files. |
| `checkCodexCompatibility(seedDir, liveVersion, liveSeeded)` | Central guard. `isSafe = true` when never seeded, seed version unknown, or versions match. On mismatch the message directs the user to `/codex-sync` first (non-destructive merge of the new shipped resources into the live copy — learned entries kept), with `/codex-install` as the destructive alternative (wipes the live codex, installs a full fresh copy of the seed, no backup, by design). |

## Wiring

- The coordinator (`aftc-codex.ts`) wraps `checkCodexCompatibility` as
  `ctx.checkCompat()`; every codex feature calls it before touching the live
  codex: `before_agent_start` injection and `codex_load` pause when unsafe, and
  the `/aftc-codex-*` commands show the message (except `/codex-sync` and
  `/codex-install` — the fixes — plus `/codex-disable` and `/codex-status`).
- `codex-inject.ts` adds a NOTICE line to the fresh-session prep notice when
  the guard reports a mismatch.
- Fail-soft everywhere: an unknown seed version never blocks.

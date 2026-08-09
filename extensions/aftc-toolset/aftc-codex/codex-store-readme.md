# codex-store.ts

Data-dir layout, seeding, and resource access for the aftc-codex feature.
Pure data module — no pi imports, no event subscriptions, no commands.

## What it adds to the extension

The "live copy" side of a strict **one-way** model (seed → live; the live copy is
merged back into the seed only by the maintainer's dev-gated live->seed tool,
and the seed never overwrites a USER-edited live file — untouched entries do
follow shipped improvements):

- **Shipped seed (source only):** `<packageRoot>/extensions/aftc-toolset/data/aftc-codex/`
- **User live copy (per-user):** `<dataDir>/aftc-codex/` (always — there is no
  override; `%APPDATA%\pi-aftc-toolset\data\aftc-codex\` on Windows). Survives
  `pi update`.

The shipped seed mirrors the live-copy layout — seed `data/aftc-codex/<x>` maps
1:1 to the live `<dataDir>/aftc-codex/<x>`; only its CONTENT is copied into the
live codex root, and only when the live file does not already exist (copy-only).

## Public API

`createCodexStore()` returns a `CodexStore`:

- `getRoot()` — the live codex root, always `<dataDir>/aftc-codex`.
- `getResourcesDir()` / `getSeedDir()` / `getSeedResourcesDir()` — path helpers.
- `isSeeded()` — true when the live copy has a `codex-rules.md` (reconciled
  against reality, not just the pref).
- `seed(mode)` — copy-only seed. `"pretrained"` copies the whole seed tree;
  `"fresh"` copies only the top-level guidance files (rules + guidance) and
  creates empty category folders. Never overwrites an existing file. Sets
  `aftcCodexSeeded = true` AND records the shipped version into
  `aftcCodexVersion` (any seed path leaves the live copy at the shipped
  version, so the version bookkeeping lives here centrally) AND stamps
  `aftcCodexResourceVersion = CODEX_RESOURCE_VERSION` (the shipped seed is the
  v1 structural layout; legacy live copies are migrated by codex-migrate.ts,
  never by seeding).
- `ensureSeeded(mode)` — seed only if not already seeded.
- `readResource(topic)` — resolve a topic across ALL category folders (flat
  AND nested one level deep, eg `ui-ux/web/web-app.md`) + loose root-level
  topics (eg `documentation-and-planning.md`) + top-level guidance; fuzzy
  aliases (`ts`→typescript, `py`→python, `js`→javascript,
  `rules`/`guidance`/`list`/`markdown` specials); strips a leading `@`; drops a
  trailing `.md`; supports explicit `category/name` and `category/sub/name`.
  Returns `{ absPath, relPath, content }` or `null`.
- `listTopics()` — all valid topic names (basename without `.md`), sorted.
- `readRules()` / `readGuidance()` / `readList()` — read the always-on files.
- `listCategories()` — all category folders under `resources/` (known order
  first, extras sorted; only folders that exist). The known order
  (`CODEX_CATEGORIES`): languages, libraries, frameworks, engines, runtimes,
  tools, servers-and-containers, database, os, ui-ux. Used by the codex entry
  tools for new-topic guidance and by `listTopics()`/`getCounts()` internally.
- `getCounts()` — resource counts by category + totals (recursive: nested
  topics count towards their top-level category; loose root-level topics count
  towards the total and `getCategoryCount()`).
- `runSyncScript()` — spawn `node sync-codex-resources.mjs` to regenerate
  `codex-resource-list.md` (arg array, no shell; falls back to
  `process.execPath` if `node` is not on PATH; 10s watchdog). Never throws.
  Callers: the resource-touching commands AND `codex_add_entry` (internally,
  only when it creates a new topic file). The model never runs the script.
- `runEnsureIds()` — spawn `node ensure-entry-ids.mjs <resourcesDir>` to add
  missing unique `[ID]`s to the live resources. Never throws. Backstop for
  hand-edits only — the codex entry tools generate IDs themselves.
- `runLiveToSeedSync(apply)` — spawn `live-to-seed-sync.mjs` (dry run, or
  `--apply` when `apply` is true) and return its captured stdout (`""` on
  spawn failure; 30s watchdog). Maintainer-only: called by the dev-gated
  `/codex-live-to-seed` command (1.7.8's command surface in codex-commands.ts).
- `runSeedToLiveSync()` — spawn `seed-to-live-sync.mjs` (always applies; the
  NON-DESTRUCTIVE seed -> live update) and return its captured stdout (`""`
  on spawn failure; 30s watchdog). Called by `/codex-sync`. Both sync spawns
  share one spawn+capture helper (arg array, no shell, `node` on PATH with a
  `process.execPath` retry).

There is **no** drift detection, no `.sync.json`, no backup/restore in this
module — the codex is a one-way seed->live copy, and user edits (e.g. via
`/aftc-codex-learn`) live only in the live copy. "Start Fresh" / re-install
simply delete the live copy and re-seed it; `/codex-sync` is the
non-destructive alternative (entry-level merge by `[ID]`; entries the user
never touched are updated to new shipped wording via the sync manifest
`codex-live-manifest.json`, user-edited entries kept on conflict).

Also exports `CODEX_CATEGORIES` and the `CodexStore` / `CodexResourceRead` /
`CodexCounts` types.

## Files persisted

Under `<dataDir>/aftc-codex/`:

- `codex-rules.md`, `thought-and-action-guidance.md`, `markdown-guidance.md` —
  top-level guidance (seeded copy-only).
- `resources/**` — the live knowledge base (seeded copy-only from the package).
- `resources/codex-resource-list.md` — auto-generated by `runSyncScript()`.

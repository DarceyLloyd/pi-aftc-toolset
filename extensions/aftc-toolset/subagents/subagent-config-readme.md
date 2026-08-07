# subagents/subagent-config.ts — readme

Preferences for the sub-agent feature (codename 007), in the feature's OWN file
`<dataDir>/subagents-config.json` — deliberately not the shared
`config.json` (self-contained, droppable; the `ssh.json` precedent).

## Contract

- **No in-memory cache.** Every read hits disk. pi keeps extension
  modules alive across `/new`; a cache would serve stale values after a
  hand edit, and a later write would flush the stale cache back over
  the user's edits (same binding rule as `config.ts`).
- **Fresh read-modify-write.** `setSubAgentPref(key, value)` re-reads
  the live file, changes one key, saves atomically (tmp + rename).
- **Existing values are sacred.** The load-merge backfills only
  MISSING / wrong-type keys (write-back migration); it never
  overwrites a saved value.
- **Project override.** `<cwd>/.pi/subagents-config.json` merges on
  load with project values winning. The override file is read-only for
  the extension — writes always go to the live file.
- **Disabled by default.** `enabled` ships `false`; `/007` option 1
  enables (AGENTS.md new-feature rule).
- **Keys are unprefixed** (`enabled`, `footerLineEnabled`,
  `maxConcurrent`, ...) — the file is the namespace. The prefixed code
  identifiers map onto them here and only here.

## API

- `SubAgentsConfig` — full key set (design section 14), including
  later-phase keys that stay inert until their feature lands.
- `DEFAULT_SUBAGENTS_CONFIG` — single source of truth for a fresh file.
- `getSubAgentPref(key, default)` / `setSubAgentPref(key, value)`.
- `getSubAgentsConfigJson()` / `getProjectSubAgentsConfigJson(cwd?)`.
- `SUB_AGENT_PRESETS` + `setSubAgentPreset(preset)` — Light (2/8/10),
  Standard (4/16/20), Heavy (8/32/40) set the three capacity caps
  together; individual caps still override per-field.

All operations are best-effort: errors are logged and callers fall back
to defaults rather than crashing pi.

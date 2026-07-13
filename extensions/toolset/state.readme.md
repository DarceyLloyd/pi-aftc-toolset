# state.ts

Persistent state for the extension. One file, one concern:

- `state.json` — cross-session USER PREFERENCES that persist forever.
  Holds: footer timeframe, footer on/off, response divider on/off.
  Loaded on every `session_start` regardless of reason. Survives
  `/reload`, `/new`, fresh pi startup, and machine reboot.

There is NO per-session resumption state anymore. An earlier design
persisted cache accumulators / model info / per-turn timings to a
second `session_state.json` and tried to restore them on resume, but
it never reliably restored the footer counters across a real pi
session resume and was over-engineered, so it was removed. Cache
accumulators, timing, model info, and the context-window clock are
all per-session and live only in the `core.ts` closure — reset on
every `session_start`.

## Default generation

`DEFAULT_PREFERENCES` (exported) is the single source of truth for a
fresh `state.json`. On the first `getPreference`/`setPreference` call,
if `state.json` does not exist, the module creates it with
`DEFAULT_PREFERENCES` (atomic tmp + rename). After that the file is
ONLY re-written when one of the three preferences actually changes via
`setPreference` — never on a timer, never per turn, never on shutdown.

## Public API

### Preferences (state.json)

```typescript
// Generic typed getter - returns the saved value or the supplied
// default if the key is missing from disk (e.g. on first run, or
// after the file is added in a later release). Read-only: does NOT
// create state.json.
const timeframe = getPreference("footerTimeframe", "3d");

// Persist a single preference. Cache is updated and the file is
// written atomically. Errors are logged, never thrown. This is the
// ONLY path that writes state.json after the initial ensure.
setPreference("footerTimeframe", "7d");

// The default object - used to generate a fresh state.json and to
// merge against a partial one. Exported so tests can verify the
// shape.
export const DEFAULT_PREFERENCES: Preferences = {
    footerTimeframe: "3d",
    footerEnabled: true,
    responseDividerEnabled: true,
};
```

## Events subscribed

None.

## Public factory

None - this module exports only top-level functions and types.
Feature modules import `getPreference` / `setPreference`.

## Files persisted

- `<package-root>/.pi-aftc-toolset/data/state.json`

Gitignored (under `.pi-aftc-toolset/`).

## Atomic writes

Every save goes through `tmp + rename`:

1. Write the JSON to `<file>.tmp`
2. Rename `<file>.tmp` to `<file>`

A crash mid-write leaves the original file intact (rename is atomic
on POSIX and Windows), so we never see half-written state. No
throttling is needed — writes only happen on user actions (toggle,
set timeframe), which are rare.

## Cache

Preferences are cached in-memory. `loadPreferencesInternal` reads
disk once (creating the file with defaults if missing), then every
`getPreference` returns the cached value. `setPreference` updates
the cache and writes through to disk. Restarting pi invalidates the
cache (process restart).

## Failure modes

- **state.json missing** - first run. Created with defaults on the
  first access (ensure). `getPreference` returns defaults without
  writing (read-only).
- **state.json corrupt** - logs an error, returns defaults. The bad
  file is left on disk; user can hand-fix it.
- **state.json has unknown extra fields** (e.g. a leftover `version`
  from an earlier release) - silently ignored. Only known keys are
  surfaced through `getPreference`. The user's saved values for
  known keys are never lost.
- **Disk write fails** - logs an error, the in-memory cache reflects
  the new value but the file is stale. Next successful save will
  catch up.
- **Permission denied on read** - logs an error, falls back to
  defaults. pi does not crash.

## Cross-platform

All paths go through Node's `path.join`, all file ops use `fs.*Sync`.
Atomic rename works on both POSIX and Windows NTFS. No shell, no
native deps.

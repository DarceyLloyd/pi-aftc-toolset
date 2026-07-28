# config.ts

Persistent configuration for the extension. One file, one concern:

- `config.json` - cross-session extension configuration that persists forever.
  Holds: footer timeframe, footer on/off, response divider on/off,
  think-tag processing, startup animation, and the aftc-codex
  knowledge-base preferences (`aftcCodex*` — master switch, guidance
  inject, auto-load, seeded
  flag; off by default).
  Loaded on every `session_start` regardless of reason. Survives
  `/reload`, `/new`, fresh pi startup, and machine reboot.

There is no per-session resumption data. Cache accumulators, timing,
model info, and the context-window clock are all per-session and live
only in the `core.ts` closure — reset on every `session_start`.

## Default generation

`DEFAULT_PREFERENCES` (exported) is the single source of truth for a
fresh `config.json`. On the first `getPreference`/`setPreference` call,
if `config.json` does not exist, the module creates it with
`DEFAULT_PREFERENCES` (atomic tmp + rename). After that the file is
ONLY re-written when a tracked value actually changes via
`setPreference` — never on a timer, never per turn, never on shutdown.

## Public API

### Preferences (config.json)

```typescript
// Generic typed getter - returns the saved value or the supplied
// default if the key is missing from disk (e.g. on first run, or
// after the file is added in a later release). Read-only: does NOT
// create config.json.
const timeframe = getPreference("footerTimeframe", "3d");

// Persist a single preference. Cache is updated and the file is
// written atomically. Errors are logged, never thrown. This is the
// ONLY path that writes config.json after the initial ensure.
setPreference("footerTimeframe", "7d");

// The default object - used to generate a fresh config.json and to
// merge against a partial one. Exported so tests can verify the
// shape.
export const DEFAULT_PREFERENCES: Preferences = {
    footerTimeframe: "3d",
    footerEnabled: true,
    responseDividerEnabled: true,
    thinkProcessingEnabled: false,
    "aftc-intro": true,
    // ... qwencloud*, notify*, warGames*, and aftcCodex* prefs
    aftcCodexEnabled: false,        // master switch (off by default)
    aftcCodexInjectGuidance: true,  // inject thought-and-action-guidance.md
    aftcCodexAutoLoad: true,        // auto-detect techs + fetch their docs
    aftcCodexSeeded: false,         // first-run seed choice done
};

```

## Events subscribed

None.

## Public factory

None - this module exports only top-level functions and types.
Feature modules import `getPreference` / `setPreference`.

## Files persisted

- `<persistent-data-dir>/config.json` (OS-specific; see `paths-readme.md` —
  eg `%APPDATA%\pi-aftc-toolset\data\config.json` on Windows)

Created lazily with `DEFAULT_PREFERENCES` on first access. Lives in the
persistent OS data dir (outside the installed package), so it now
SURVIVES `pi update --extensions`. New preference fields are migrated
into an existing file on load (see `config.ts`); a legacy package-local
config is copied forward by `migrateLegacyData()` on startup.

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

## SSH connection records

SSH connections are stored separately in `ssh.json` under the extension data
directory. That file is excluded from git and npm publishing. `config.json`
contains no SSH connection data.

## Failure modes

- **config.json missing** - first run. Created with defaults on the
  first access (ensure). `getPreference` returns defaults without
  writing (read-only).
- **config.json corrupt** - logs an error, returns defaults. The bad
  file is left on disk; user can hand-fix it.
- **config.json has unknown extra fields** (e.g. a leftover `version`
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

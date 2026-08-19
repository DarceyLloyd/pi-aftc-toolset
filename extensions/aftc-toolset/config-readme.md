# config.ts

Persistent configuration for the extension. One file, one concern:

- `config.json` - cross-session extension configuration that persists forever.
  Holds: footer timeframe, footer on/off, response divider on/off,
  think-tag processing, startup animation, and the aftc-codex
  knowledge-base preferences (`aftcCodex*` — feature switch, guidance
  inject, auto-load, installed version; off by default).
  Read FRESH FROM DISK on every access (no in-memory cache — see
  "No in-memory cache" below). Survives `/reload`, `/new`, fresh pi
  startup, and machine reboot.

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
// after the file is added in a later release). Creates config.json
// from the defaults on first access.
const timeframe = getPreference("footerTimeframe", "3d");

// Persist a single preference. Fresh read-modify-write of the file
// (hand edits made since the last write survive), written atomically.
// Errors are logged, never thrown. This is the ONLY path that writes
// config.json after the initial ensure and the load-merge migration
// (missing-key backfill + retired-key strip).
setPreference("footerTimeframe", "7d");
```

### Adding / retiring preferences

- **Add**: `Preferences` interface + `DEFAULT_PREFERENCES` + done. The
  load-merge backfills any missing (or wrong-typed) defaults key and
  re-saves — no per-key migration code. Only a value that must be
  DERIVED (not the default) gets a special case (today: `notifyEnabled`).
- **Retire**: remove from the interface + defaults and add ONE line to
  `RETIRED_KEYS` in config.ts; the strip re-saves on its own. Never prune
  `RETIRED_KEYS` — a user may skip many releases, and a leftover dead key
  is inert anyway (stripping is hygiene, not correctness).

```typescript

// The default object - used to generate a fresh config.json and to
// merge against a partial one. Exported so tests can verify the
// shape.
export const DEFAULT_PREFERENCES: Preferences = {
    footerTimeframe: "3d",
    footerEnabled: true,
    footerAveragesEnabled: true,
    responseDividerEnabled: true,
    thinkProcessingEnabled: false,
    "aftc-intro": true,
    // ... qwencloud*, notify*, warGames*, and aftcCodex* prefs
    aftcCodexEnabled: false,        // feature on/off (off by default)
    aftcCodexInjectGuidance: true,  // inject thought-and-action-guidance.md
    aftcCodexAutoLoad: true,        // auto-detect techs + fetch their docs
    aftcCodexInstalledVersion: "",  // package version the fixed docs were last copied from
    aftcCodexAutoInsertAgentsEnabled: false, // allow the AI to auto-insert the codex load list into AGENTS.md (off by default)
    runScriptEnabled: true,          // run_script tool (off = tool absent)
    backgroundTerminalsEnabled: false, // bg_* tools + /bt family (off by default)
    fileSearchEnabled: true,         // fd + rg search tools
    chatAutoReplyEnabled: true,      // peer-chat auto-reply
    debugLoggingEnabled: false,      // stdout diagnostic chatter gate
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

## No in-memory cache (BINDING)

Preferences are NEVER cached in module memory. Every `getPreference`
reads the file from disk (creating it with defaults if missing), and
every `setPreference` is a fresh read-modify-write. Rationale: pi
keeps extension modules alive across `/new`, so a cache would serve
stale values after the user hand-edits config.json — worse, the next
`setPreference` would flush the stale cache back and silently clobber
those edits. The file is tiny and local; reading it each time is
free. The same rule applies to the shipped
`data/extension-config.json`.
Full contract: `docx/1_extension_source/1.2_core_infrastructure_documentation.md`.

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
- **Disk write fails** - logs an error; the file keeps its previous
  content. The next read returns the old on-disk value (there is no
  cache to drift), and the next successful save catches up.
- **Permission denied on read** - logs an error, falls back to
  defaults. pi does not crash.

## Cross-platform

All paths go through Node's `path.join`, all file ops use `fs.*Sync`.
Atomic rename works on both POSIX and Windows NTFS. No shell, no
native deps.

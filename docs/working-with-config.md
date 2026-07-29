# Working with config files (live vs shipped)

**Read this before touching ANY config file or the config module.** Two
different JSON config files exist in this project — mixing them up has already
caused a production bug. This doc is the binding contract for both.

---

## The two config files

| | LIVE config | SHIPPED config |
| --- | --- | --- |
| File | `<dataDir>/config.json` | `<packageRoot>/extensions/aftc-toolset/data/extension-config.json` |
| Windows example | `%APPDATA%\pi-aftc-toolset\data\config.json` | `W:\Dev\pi-aftc-toolset\extensions\aftc-toolset\data\extension-config.json` |
| Owned by | The user (per-user OS data dir, survives `pi update`) | The package (ships in the npm tarball, wiped + replaced on `pi update`) |
| Contents | All user preferences (`Preferences` interface, camelCase keys, eg `warGamesEnabled`, `aftcCodexVersion`) | Package-shipped values: `codexVersion` today; future shipped-only keys |
| Source of truth for defaults | `DEFAULT_PREFERENCES` in `extensions/aftc-toolset/config.ts` | The file itself (edited by the maintainer before release) |
| Read/write API | `getPreference` / `setPreference` (`config.ts`) | `readCodexSeedVersion` (`codex-compat.ts`) today; read it directly with a fresh `fs.readFileSync` + try/catch |
| Copied to the other side? | Never shipped | **Never copied to the live side** |

Terminology used across the codebase and docs:

- **live** — the user's per-user copy in the persistent OS data dir
  (`<dataDir>/...`). Applies to config.json, the codex copy, turns.db, ssh.json.
- **seed / shipped** — the source-only defaults and assets inside the package
  (`extensions/aftc-toolset/data/...`). One-way flow: seed -> live, copy-only.
- `<dataDir>` resolves via `paths.ts` (`AFTC_TOOLSET_DATA_ROOT` override for
  tests); see `docs/data-and-packaging.md` for the per-OS table.

Why the rename: both files used to be called `config.json`, which invited
mix-ups (a version-mismatch debug session edited the wrong one's mental model).
The shipped file is now `extension-config.json`. The live file keeps the name
`config.json` (it is the one users and docs mean when they say "config.json").

---

## BINDING RULE: never cache config in memory

**Every read hits the file on disk. Every time. No module-level cache, no
"loaded once at session_start", no memoisation — for BOTH files.**

Rationale (the bug that caused this rule):

- pi keeps extension modules alive across `/new` (the factory does NOT re-run),
  so a module-level cache survives for the whole process.
- A user hand-editing the live `config.json` while pi runs then saw stale
  cached values — the aftc-codex version guard could not see a manually
  reset `aftcCodexVersion: 0`, so the mismatch went undetected.
- Worse: the next `setPreference` would flush the whole stale cache back to
  disk, silently reverting the user's edits.

These are small local files on the user's machine — a sync read is free, even
at 1 Hz. Do not "optimise" this back.

Consequences:

- `getPreference(key, default)` reads the file fresh on every call.
- `setPreference(key, value)` is a fresh **read-modify-write**: it re-reads the
  file, applies the one key change, writes back. External (hand) edits to other
  keys are preserved.
- Features must never keep their own copy of a preference in closure state
  across reads when the current value matters — re-call `getPreference`.
- Exception that is NOT caching: reading a value once to use within a single
  synchronous operation (eg building one menu render) is fine.

---

## Writing rules (both files)

- **Never overwrite user values.** The defaults-merge is
  `{...DEFAULT_PREFERENCES, ...parsed}` — existing saved values are sacred.
- **Atomic writes only**: write `<file>.tmp`, then `rename`. A crash mid-write
  must never leave a half-written file.
- **Never clobber a corrupt file.** If JSON parsing fails, return defaults and
  leave the bad file on disk for the user to hand-fix (logged, never thrown).
- **All config I/O is fail-soft**: try/catch, log via `[aftc-toolset]` stdout,
  fall back to defaults. pi must never crash over config.

---

## Adding / changing a preference (live config.json)

1. Add the key to the `Preferences` interface (`config.ts`), camelCase.
2. Add the default to `DEFAULT_PREFERENCES`.
3. Add a `needsXMigration` type-check + spread entry in
   `loadPreferencesInternal()` so older files get the key written back
   (missing keys only — existing values are never discarded).
4. Update the defaults table in `docs/data-and-packaging.md`.
5. New user-facing features are disabled by default.

The write-back migration runs inside the normal read path: the first read that
notices a missing/wrong-typed key re-saves the file with the key added. With no
cache this costs nothing extra — the next read finds the key on disk.

---

## Edge cases (decided, do not re-litigate)

| Case | Behaviour |
| --- | --- |
| File missing | Live: created lazily from `DEFAULT_PREFERENCES` on first access. Shipped: reader returns null/absent — callers fail soft (eg codex version logic disables itself). |
| File corrupt (bad JSON) | Return defaults, log, leave the file untouched on disk. Never rewrite it from the read path. |
| Unknown extra keys | Silently ignored; preserved on write-back (spread of `parsed`). |
| Wrong-typed key | Treated as missing: default returned, write-back fixes the type on disk. |
| External edit while pi runs | Picked up on the very next read (that is the whole point of this doc). |
| Two pi processes sharing one data dir | Last-writer-wins per `setPreference` call (read-modify-write keeps the window microscopic). Best-effort; not a supported setup. |
| Disk write fails | Logged, swallowed. Next read returns the old on-disk value (no cache to drift); the next successful save catches up. |
| `AFTC_TOOLSET_DATA_ROOT` changed mid-process (tests) | Works: `paths.ts` resolves the env var on every call, and with no cache the next read hits the new root. |

---

## Tests

- `tests/config-fresh-read-check/` — regression for the stale-cache bug:
  external edits visible immediately, `setPreference` preserves them, migration
  still writes back missing keys, corrupt files never clobbered.
- `tests/codex-compat-check/` — shipped `extension-config.json` version reads
  (fresh from disk, fail-soft on missing/malformed).

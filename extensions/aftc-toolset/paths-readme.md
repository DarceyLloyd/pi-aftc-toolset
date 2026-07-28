# paths.ts

Path helpers for the extension's owned files. The extension's runtime
data (SQLite DB, config, SSH store, replay prompt, HTML report) lives in
a **per-user persistent OS directory OUTSIDE the installed package** so
it survives `pi update --extensions` (which replaces the whole package
dir). It is never anchored to the user's project cwd - pi may be opened
from any folder, but the extension's data is global to the user.

## Persistent data location

Resolved by `getPersistentRoot()` / `getDataDir()`:

| Platform | Data dir |
| --- | --- |
| Windows | `%APPDATA%\pi-aftc-toolset\data\` |
| macOS | `~/Library/Application Support/pi-aftc-toolset/data/` |
| Linux | `$XDG_DATA_HOME/pi-aftc-toolset/data/` (fallback `~/.local/share/pi-aftc-toolset/data/`) |

Set `AFTC_TOOLSET_DATA_ROOT` to override the root (used by tests and
power users). The data dir holds `config.json`, `ssh.json`,
`turns.db`, and `report.html`, all created lazily at runtime.

## What it exports

```typescript
getPackageRoot(): string
```

Returns the `<package-root>` of this extension. Walks up from
`__dirname` looking for a `package.json` whose `name` field is
`"pi-aftc-toolset"` (or, as a structural fallback, that has
`extensions/aftc-toolset/index.ts` underneath). Falls back to
`__dirname/../..` if nothing matches.

```typescript
getRuntimeRoot(): string
```

`<package-root>/.pi-aftc-toolset/`. LEGACY runtime root (pre-persistent
releases kept data here). Now used only as the migration source. Still
gitignored/npm-ignored.

```typescript
getPersistentRoot(): string
```

Per-user persistent root OUTSIDE the package (see table above). Honours
`AFTC_TOOLSET_DATA_ROOT`.

```typescript
getDataDir(): string
```

`<persistent-root>/data/`. Holds `config.json`, `ssh.json`,
`turns.db`, and `report.html`.

```typescript
getLegacyDataDir(): string
```

`<package-root>/.pi-aftc-toolset/data/`. LEGACY data dir; migration
source only.

```typescript
getDbFile(): string
```

`<data-dir>/turns.db`. The SQLite database.

```typescript
getConfigJson(): string
```

`<data-dir>/config.json`. Cross-session extension configuration.

```typescript
getSshJson(): string
```

`<data-dir>/ssh.json`. Local SSH connection store.

```typescript
getReportFile(): string
```

`<data-dir>/report.html`. Latest generated usage report.

```typescript
migrateLegacyData(legacyDir?, newDir?): void
```

Idempotent, lock-safe migration from the legacy package-local data dir
to the persistent data dir. Phase 1 copies any legacy file that has no
persistent counterpart (copy-only, so a locked source never blocks it).
Phase 2 best-effort deletes the legacy files, retrying on the next run
if a file is still locked. Called once at startup from `index.ts`
before any module reads the data dir. Params default to the real
legacy/persistent dirs; injectable for tests.

## Why a persistent OS dir, not the package or cwd

- Not cwd: if the user opens pi from `/home/user/project-A` then
  `/home/user/project-B`, both sessions must see the same usage data -
  not two isolated DBs.
- Not the package dir: pi replaces the whole package directory on
  `pi update --extensions` (verified with `tests/install-test/`), which
  used to destroy `turns.db` and friends on every update. The persistent
  OS dir is outside the package, so user data now survives updates.

## Caching

`getPackageRoot()` caches the result in a module-level variable on first
call. All other helpers are pure derivations.

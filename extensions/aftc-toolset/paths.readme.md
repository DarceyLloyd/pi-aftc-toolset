# paths.ts

Path helpers for the extension's package-anchored files. The
extension's runtime data (SQLite DB, HTML report) must live in a
package-relative location, not in the user's project cwd - pi may
be opened from any folder, but the extension's data is global to
the installed package.

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

`<package-root>/.pi-aftc-toolset/`. Hidden directory for all
extension-owned runtime state. Gitignored.

```typescript
getDataDir(): string
```

`<package-root>/.pi-aftc-toolset/data/`. Holds `config.json`,
`ssh.json`, `replay.json`, `turns.db`, and `report.html`. All
created lazily at runtime; the whole directory is gitignored and
npm-ignored.

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

`<data-dir>/ssh.json`. Local SSH connection store. This file is excluded from git and npm publishing.

```typescript
getReplayJson(): string
```

`<data-dir>/replay.json`. Saved replay prompt. This file is excluded from git and npm publishing.

```typescript
getReportFile(): string
```

`<data-dir>/report.html`. Latest generated usage report.

## Why package-root, not cwd

Per .dev/dev_guide.md section 10 - the extension's runtime data must remain
global to the installed package, not per-project. If the user
opens pi from `/home/user/project-A` and then from
`/home/user/project-B`, both sessions should see the same usage
data - not two isolated DBs.

## Caching

`getPackageRoot()` caches the result in a module-level variable
on first call. All other helpers are pure derivations.

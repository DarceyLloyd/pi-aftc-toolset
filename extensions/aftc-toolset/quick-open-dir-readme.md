# quick-open-dir.ts

`/qd` — a menu of directories opened in the OS file manager. Absorbs the
retired `open-data-dir.ts` (`/aftc-open-data-dir`, `/aftc-odd` — both
removed; menu option 1 is the same action).

## The menu

```
Title:   AFTC Quick Dir Access
Message: Choose your poison:
  - Open users data dir
  - Open .pi data dir
```

| Option | Opens | Notes |
| --- | --- | --- |
| Open users data dir | `getDataDir()` — `%APPDATA%\pi-aftc-toolset\data` (win), `~/Library/Application Support/...` (mac), `$XDG_DATA_HOME/...` (linux) | Created with `mkdir -p` first if missing (it is lazy-created) |
| Open .pi data dir | `join(homedir(), CONFIG_DIR_NAME)` — pi's own config dir | Uses pi's `CONFIG_DIR_NAME` export, never the literal `.pi` (rebrand-safe) |

Esc resolves `null` and does nothing. A successful open ends with an
`aftcConsole.emphasis` line showing the full path; a missing directory
warns instead of opening.

The old third option ("Open pi-aftc-toolset dir", dev-gated by a `.dev`
marker folder) was removed: it opened the wrong directory in installed
copies. The `.dev` marker no longer gates anything in this module.

## Adding more options

Append one entry to the `TARGETS` array in `quick-open-dir.ts`:

```ts
{ value: "logs", label: "Open logs dir", resolve: () => join(getDataDir(), "logs"), ensure: true },
```

Fields: `value` (menu key), `label` (row text), `resolve()` (absolute
dir), optional `ensure` (mkdir -p first). Nothing else to touch.

## Cross-platform open

`openInFileManager` (absorbed from open-data-dir.ts): `explorer.exe`
(win32), `open` (darwin), `xdg-open` (linux/other), spawned detached +
unref'd so it never blocks pi.

## Public factory

```typescript
export interface QuickOpenDirDeps {
    open?: (dir: string) => void;   // tests only
    menu?: typeof showMenu;         // tests only
}
export function createQuickOpenDir(pi: ExtensionAPI, deps: QuickOpenDirDeps = {}): void
```

No return value. Self-contained: registers one command (with its
help-registry entry, category Navigation) and is done.

## Commands registered (1)

- `/qd` — quick dir access menu

# open-data-dir.ts

Opens the pi-aftc-toolset persistent data directory in the OS file manager.

## Commands

| Command | Alias | Action |
| --- | --- | --- |
| `/aftc-open-data-dir` | `/aftc-odd` | Opens the data dir in the platform file manager |

## Platform file managers

| OS | Command used |
| --- | --- |
| Windows | `explorer.exe <dir>` |
| macOS | `open <dir>` |
| Linux | `xdg-open <dir>` (freedesktop standard) |

## Data directory location

Resolved via `getDataDir()` from `paths.ts`:

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\pi-aftc-toolset\data\` |
| macOS | `~/Library/Application Support/pi-aftc-toolset/data/` |
| Linux | `$XDG_DATA_HOME/pi-aftc-toolset/data/` or `~/.local/share/pi-aftc-toolset/data/` |

Override: `AFTC_TOOLSET_DATA_ROOT` env var.

## Behaviour

- Creates the directory if it doesn't exist (lazy creation).
- Spawns the file manager detached + unref (doesn't block pi, survives pi exit).
- Notifies the user with the resolved path.

# install.ts

Dependency installer for the runtime packages the extension needs
but `pi install <package>` does not set up automatically.

## What it owns

1. `/aftc-install` command — runs `npm install` in the package
   root to fetch `better-sqlite3` (native binding required for
   `usage-report.ts` and `usage-recording.ts`).
2. `session_start` warning — emits a one-time notification per
   session if `better-sqlite3` is not loadable, pointing the user
   at `/aftc-install`.
3. Python GUI dependencies — if `internal-python-gui/.venv/`
   doesn't have PyQt6 + Flask + paramiko, `/aftc-install` runs
   `uv sync` (downloading a bundled `uv.exe` if needed) so the SSH
   tools in `ssh.ts` can launch the local GUI.

## Why this exists

`pi install <package>` does NOT run `npm install` for runtime
dependencies. `better-sqlite3` has a native binding so a real
npm install is unavoidable — but the user shouldn't have to leave
pi and run it by hand. `/aftc-install` does it from inside the
TUI, in the correct directory.

## Package-root discovery

Walks up from `__dirname` until it finds a `package.json` whose
`name` field matches the package. This works whether the package
is installed globally (`~/.pi/agent/git/...`) or project-locally
(`.pi/...`) because jiti sets `__dirname` to the file's actual
disk location in both cases.

## Python GUI discovery

Walks up looking for `internal-python-gui/`. If found, resolves
the uv executable (preferring the bundled `bin/uv.exe`,
downloading one if neither local nor system uv is available).

## Commands registered (1)

- `/aftc-install` — interactive install with a confirmation
  dialog. Asks the user before running `npm install` or
  `uv sync`. Reports success/failure via `ctx.ui.notify` and a
  final `ctx.ui.select` dialog.

## Failure modes

- `npm install` exit code non-zero — shown via `ctx.ui.notify`
  with the last 15 lines of stderr/stdout.
- `uv sync` exit code non-zero — same.
- `uv.exe` download fails — shown via `ctx.ui.notify`.
- better-sqlite3 not loadable after install — the user is told
  to run `/reload` to pick up the new module.

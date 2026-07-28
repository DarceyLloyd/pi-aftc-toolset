# install.ts

Dependency installer for runtime packages that Pi package installation does not prepare automatically.

## What it owns

- `/aftc-install` installs Node.js runtime dependencies with `npm install --no-audit --no-fund`.
- It resolves `uv.exe` on Windows and `uv` on Linux and macOS.
- It resolves a Python 3 interpreter (`py`/`python` on Windows, `python3`/`python` elsewhere) required by the packaged carrier.
- It runs `uv sync --locked` in the packaged SSH carrier directory.
- It verifies the carrier's protocol-ready frame through the same local stdio
  spawn path used at runtime.
- Session-start dependency warning (intelligent): it checks every
  dependency declared in package.json (`require.resolve`) AND the SSH
  carrier Python environment (uv present + locked env synced, probed with
  `uv run --no-sync ... python -c "import paramiko, aftc_ssh_carrier"`
  so the probe never installs anything). The warning only appears when
  something is actually missing and names the missing pieces; a fully
  installed package stays silent.

## Safety and platform behavior

- Commands are launched through `pi.exec` with argument arrays. No shell-specific quoting, activation script, or development-checkout path is used.
- The installer uses a packaged `carrier/bin/uv` or `carrier/bin/uv.exe` when present, otherwise it resolves the platform-native executable from `PATH`.
- Concurrent `/aftc-install` calls share one in-progress installation.
- Installation failures use generic recovery guidance and never display process diagnostics or connection data.
- The carrier remains a local stdio process. The installer does not open a network listener.

## Commands registered

- `/aftc-install` asks for confirmation in UI mode, installs dependencies, and displays a final status dialog.

## Failure modes

- Missing package or carrier files produces a reinstall instruction.
- Missing npm produces a Node.js and npm installation instruction.
- Missing uv produces platform-specific uv installation guidance.
- Missing Python produces platform-specific Python 3 installation guidance.
- Failed `npm install`, `uv sync --locked`, or carrier ready verification displays bounded output and leaves the user able to retry.
- A successful `better-sqlite3` install requires `/reload` before the extension loads it.

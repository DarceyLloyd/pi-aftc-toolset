# codex-detect.ts

Project technology auto-detection for the aftc-codex feature (spec D5).

## What it adds to the extension

Scans a working directory and maps signals to codex topic docs:

- **File extensions** — `.ts`→typescript, `.py`→python, `.gd`→godot, `.pine`→pinescript,
  `.css/.scss`→css, `.html`→html, `.js/.mjs`→javascript, `.ps1`→powershell, `.vue`→vue, …
- **package.json deps** — `three`→threejs, `chart.js`→chartjs, `gsap`, `puppeteer`,
  `vite`, `gradio`, `torch`→pytorch, `webpack`, …
- **Marker files** — `Dockerfile`/`docker-compose.yml`→docker, `composer.json`→php+composer,
  `pyproject.toml`/`requirements.txt`→python, `project.godot`→godot, `vite.config.*`→vite,
  `bunfig.toml`→bun, a `pi` manifest in package.json→pi-extension.

The result is intersected with the resources actually present (`store.listTopics()`)
so only fetchable docs are suggested, and the always-injected guidance files
(rules/guidance/list/markdown) are excluded.

## Public API

`createCodexDetect(ctx)` returns `CodexDetectApi`:

- `detectTopics(cwd)` — sorted topic names relevant to `cwd`; cached per cwd.
- `resetCache()` — drop the per-session cache (called on `session_start`).

## Bounded scan (spec M-M3)

Skips heavy dirs (`node_modules`, `.git`, `dist`, `build`, `.venv`, `__pycache__`,
any dot-dir, …), caps depth (6) and files visited (8000) so a large tree cannot hang
a command. Reads only the root `package.json`.

## Integration (step 4.2)

`aftcCodexAutoLoad` is honoured by the caller: when on, `/codex-init` names the
detected topics in the marker instruction. Detection never touches the cached
system-prompt prefix (session-specific data stays out of it).

## Failure modes

Unreadable dirs / malformed `package.json` are skipped (best-effort). Returns `[]`
when nothing is detected or no resources are seeded.

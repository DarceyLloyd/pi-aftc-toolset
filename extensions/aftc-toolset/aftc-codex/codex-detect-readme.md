# codex-detect.ts

Project technology auto-detection for the aftc-codex feature (spec D5).

## What it adds to the extension

Scans a working directory and maps signals to codex topic docs:

- **File extensions** — `.ts`→typescript, `.py`→python, `.gd`→godot, `.scss/.sass`→scss,
  `.cpp/.cc/.cxx/.hpp/.h`→cpp, `.cs/.csx/.sln/.csproj`→cs, `.razor`→blazor,
  `.rs`→rs, `.java`→java, `.twig`→twig, `.sh`→bash, `.bat/.cmd`→batch,
  `.wxs/.wixproj`→wix, `.jucer`→juce, `.ps1`→powershell, `.vue`→vue, …
- **package.json deps** — `three`→threejs, `chart.js`→chartjs, `gsap`, `puppeteer`,
  `vite`, `gradio`, `torch`→pytorch, `webpack`, `electron`,
  `@shoelace-style/shoelace`→shoelace, …
- **package.json scripts / fields** — keys AND values word-scanned for
  `bun`/`bunx`/`vite`/`webpack`/`node` (word-boundary, so `"bundle"` never triggers
  `bun`); a `bin` field or `engines.node` → nodejs; a `pi` manifest → pi-extension.
- **Marker files** — `Dockerfile`/`docker-compose.*`→docker, `composer.json`→php+composer,
  `pyproject.toml`/`requirements.txt`→python, `project.godot`→godot,
  `deno.json/deno.jsonc`→deno, `nginx.conf`→nginx, `.htaccess`→apache,
  `CMakeLists.txt`→cmake, `Cargo.toml`→rs, `pom.xml`/`build.gradle`→java,
  `bunfig.toml`/`bun.lock*`→bun, …
- **Marker dirs** — an `aftc-framework/` directory→aftc-framework.
- **Content scan** (bounded: ≤64 KB per file, ≤24 files) — `*.csproj` text →
  blazor / dotnet-maui; `CMakeLists.txt` text → juce; compose files → mysql / nginx
  images.
- **Auto-inject docs** (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`,
  `.windsurfrules`, `.github/copilot-instructions.md`; ≤64 KB each):
  - the marked `<!-- AFTC-CODEX-STACK \n topics: a, b, c \n -->` block — explicit
    pins, unioned across all files present (this is the ONLY detection path for the
    design domains and target OS, and the escape hatch for stoplisted topics);
  - a strict whole-word keyword scan of the full text against the live topic list,
    with a stoplist of ambiguous English words (`go`, `deno`, `vue`, `batch`, `bun`,
    `twig`, `cs`, `rs`, `composer`, `windows`) that are ignored in prose.
- **Implied topics** — any design domain → `design-common`; `mysql` → `database-common`.

## topics vs missing

The result splits in two:

- `topics` — a live resource exists; named in the marker as loadable.
- `missing` — mapped but no resource file yet (eg `.cs` files → `cs` before
  `cs.md` is born); named in the marker as a "no codex resource yet" hint so the
  model can bootstrap one with `codex_add_entry` when it has a durable lesson.

The always-injected guidance files (rules/guidance/list/markdown) are excluded
from both.

## Public API

`createCodexDetect(ctx)` returns `CodexDetectApi`:

- `detect(cwd)` — `{ topics, missing }` (both sorted); cached per cwd.
- `resetCache()` — drop the per-session cache (called on `session_start`).

## Bounded scan (spec M-M3)

Skips heavy dirs (`node_modules`, `.git`, `dist`, `build`, `.venv`, `__pycache__`,
any dot-dir, …), caps depth (6) and files visited (8000) so a large tree cannot hang
a command. The root `package.json` is parsed first (guaranteed even if the walk
budget runs out); every other `package.json` found in the walk is parsed too, so
tools declared in a nested app (eg `web/package.json`) are still detected.
Auto-inject docs are read at the root (+ `.github/`) only, never walked for.

## Integration (step 4.2)

`aftcCodexAutoLoad` is honoured by the caller: when on, `/codex-init` names the
detected topics (and the "no resource yet" hints) in the marker instruction.
Detection never touches the cached system-prompt prefix (session-specific data
stays out of it).

## Failure modes

Unreadable dirs / malformed `package.json` / oversized files are skipped
(best-effort). Returns `{ topics: [], missing: [] }` when nothing is detected or
no resources are seeded.

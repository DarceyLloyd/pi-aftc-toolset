# tests/

Test harnesses for the pi-aftc-toolset extension. No API calls, no TUI —
every test loads the extension through pi's bundled `jiti` with a stub
`ExtensionAPI` and exercises the factory, every event handler, every
slash command, and the widget render path.

## Layout

Each test has its own subfolder: `tests/<test-name>/`. The subfolder
holds the test script (named `<test-name>.<ext>`) and any helpers it
needs. See `rules.md` §11.

```
tests/
├── parse-check/parse-check.mjs          # parse-only smoke for usage.ts
├── full-check/full-check.mjs            # usage module: DB + projections + HTML
├── widget-render-check/                 # orchestrator pattern + footer widget
│   └── widget-render-check.mjs
└── load-test/load-test.cjs              # end-to-end: factory + events + commands + widget
```

## Why these exist

`extensions/toolset/index.ts` runs under pi's jiti at runtime, with no
build step (see `rules.md` §1.3). These harnesses give a fast,
dependency-free way to catch runtime errors (parse failures, bad
event-shape access, widget render crashes) and verify the cache math
(hit rates, write ROI, churn detection) without launching pi or making
provider calls.

## Run

Each test runs independently from any cwd. Use `node <script>` from the
project root (or anywhere — paths resolve from the script itself).

```bash
node tests/parse-check/parse-check.mjs
node tests/full-check/full-check.mjs
node tests/widget-render-check/widget-render-check.mjs
node tests/load-test/load-test.cjs
```

Exits `0` on success. Any error in the extension factory, an event
handler, a command handler, or the widget render path fails the run
with a stack trace.

## Adding tests

Create `tests/<name>/<name>.<ext>`. Resolve paths from the script
(`__dirname` / `fileURLToPath(import.meta.url)`), not from `process.cwd()`
— tests must run from any cwd. Keep harnesses dependency-free (`node` +
pi's bundled jiti only) so they run anywhere pi is installed.

When a refactor changes the public surface an existing test exercises
(event shapes, tool signatures, widget factory signature, command
names), update the test in the same change.
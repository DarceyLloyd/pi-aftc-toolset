# Bun

## Rules

- [nkMsv0] for password-hash interop between PHP (password_hash argon2id) and Bun, use Bun.password directly - Bun.password.verify accepts standard encoded argon2id strings with ANY parameter set (eg PHP's m/t/p values), so existing DB hashes verify unchanged with no native argon2 fallback package

## Gotchyas

- [Tz7IcI] bun test` runs ALL test files in ONE process with a SHARED module cache - a once-initialised singleton/static (eg a Config.init() guarded by a flag) keeps the FIRST file's env values for every later file, so a suite passes alone but fails in the full run (paths/roots point at the wrong file's env); give init code a resetForTests() escape hatch and call it before init in every test file that depends on per-file env

- [CTG1bm] fs copyFileSync throws ENOENT on Windows paths with MIXED separators (backslashes + forward slashes + `..` segments, eg `/path/to/tests/../tmp/data/file`) even though existsSync/readdirSync/mkdirSync accept the same string - so a move flow fails while every pre-check passes. Countermeasure: normalise every path with path.resolve() before fs calls.

- [loL8YQ] bun test` has no `--preload` CLI flag - `bun test --preload ./setup.ts` is rejected/ignored and the setup never runs (browser globals stay undefined), so DOM-dependent tests all fail with `window is not defined`; declare the preload in a `bunfig.toml` `[test]` `preload = ["./tests/setup.ts"]` array instead.

- [nBlbva] happy-dom fires `error` on script/link/style elements appended to the document - it attempts to load non-resolvable `src`/`href` resources and dispatches an error event, which rejects loadCss/loadScript-style promise helpers during tests; in tests assert the element was appended and attach `.catch(() => {})` to swallow the expected rejection.

## Issues & Solutions


- [8Rv8iD] Bun cannot compile scss
  Cause: a TS entry importing `.scss` fails `Bun.build`.
  Fix: stub the import with plugin `build.onLoad({ filter: /\.scss$/ }, () => ({ contents: "", loader: "js" }))` and compile the css separately with the `sass` npm package. (2026-07)
- `[YEjHPd] Bun.build` output path can be fixed exactly, no `[name]`/`[hash]` tokens needed
  Cause: an exact, predictable output path is needed (no token substitution).
  Fix: set `naming: { entry: "path/to/output.js" }` - Bun uses the literal string as the output filename, no token substitution needed. (2026-07)
- [pExsHJ] three.js resolves in `Bun.build` without aliases
  Cause: three/webgpu, three/tsl and three/addons/* all resolve through the package's exports map.
  Fix: import them directly; no alias configuration is needed. (2026-07)
- [ga1vrW] Static file server in ~15 lines
  Cause: a minimal static server is needed without a framework.
  Fix: use `Bun.serve` + `Bun.file(path)`; check `await file.exists()` and fall back to index.html for unknown paths. (2026-07)
- [870K9o] Bun runs CommonJS-style .js scripts (require) with top-level await natively
  Cause: Bun supports `require` and top-level await together in a plain .js file.
  Fix: no transpile or .mjs rename is needed. (2026-07)
- `[CyJVKU] Blocked 1 postinstall. Run bun pm untrusted`
  Cause: bun blocks esbuild's postinstall by default; vite esbuild-minify then fails with missing binary.
  Fix: run `bun pm untrusted` to list, `bun pm trust esbuild`, or minify with bun/terser instead. (2026-07)
- [AsOkfQ] Bundling a third-party CSS lib (eg Quill WYSIWYG) with the scss-stub + separate-sass-compile setup: a `.css` `import` in TS is NOT bundled
  Cause: the stub plugin only handles `.scss`, and a plain-CSS sass `@import` emits a runtime `@import url()` pointing at a non-served node_modules file.
  Fix: copy the lib's CSS into the SCSS pipeline (eg `scss/includes/_quill.scss`) and `@use "./includes/quill";` so sass inlines it into the CSS bundle. (2026-07)
- [Q7cM3P] `bun build` with a `.scss` import in the entry TS silently emits a 0-byte CSS bundle even though the build reports `success: true`
  Cause: the SCSS-stub plugin covers the entry's import but a NESTED `@import` inside the scss (eg `@import 'pkg/dist/style.css'`) is still passed to sass as a string and sass returns it verbatim as a runtime `@import url(...)` to a non-served node_modules path. The CSS bundle exists but is effectively empty.
  Fix: the bun stub returns `contents: ''` for every `.scss` import, so the SCSS pipeline you wire up MUST compile ALL the SCSS (entry + every nested library stylesheet) in a single pass before bun sees it. The standard pattern: write a tiny build.js script that does (1) `sass.compile('src/styles/index.scss')` to produce the final CSS, (2) write that CSS to your output dir, (3) hand the SAME path to the HTML template's `<link rel="stylesheet" href="...">` injection, (4) pass the stub plugin to bun. Or use Sass's "load paths" to add `node_modules` so `@import` resolves to real files. (2026-07)
- [L5nT8K] After `bun run build`, the JS bundle works locally but fails in the Docker container with `Cannot find module '...'` for a package that's clearly in `node_modules`
  Cause: bun's bundler creates an output that resolves bare imports via the BUILD-TIME node_modules tree, and when you mount the output dir into a container that does NOT have those packages, the runtime `require/import` fails. Common when the front-end dist dir is bind-mounted into `php:8.5-apache-bookworm` (no node_modules in the image).
  Fix: this is a valid design - the browser bundle should be self-contained. Diagnose: check that the missing module is NOT in your `import` statements (a real bug) by looking at the error stack. If it's a third-party, you likely need to ADD it to the `external` list of `Bun.build({ external: [...] })` and serve it from a CDN, or add an `install` step in the Docker image that copies `node_modules` alongside the dist. For most SPA cases the bundle is self-contained and the error is a stale dist - rebuild after `bun install`. (2026-07)

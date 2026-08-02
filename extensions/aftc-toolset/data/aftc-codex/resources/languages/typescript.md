# TypeScript

## Rules

## Gotchyas

## Issues & Solutions


- `[RqFfJF] Cannot read properties of undefined (reading 'fileExists')` from ts-loader
  Cause: ts-loader 9.x is incompatible with typescript 7.
  Fix: pin typescript to ^6 until ts-loader adds support. (2026-07)
- [iQuKUd] Bind/placeholder names containing digits silently mismatch validators that scan SQL with `/:[a-zA-Z_]+/` (eg AFTC PDOQueryLib::checkPlaceholders reports undefined/unused binds for `:cat0`)
  Cause: the pattern matches `[a-zA-Z_]+` only, so a digit in a bind name falls outside the match.
  Fix: use alphabetic suffixes for generated placeholders (:cata, :catb). (2026-07)
- [N4wM2K] `bun build` reports `Could not resolve: "@src/..."` (or any `@alias/...`) even though `tsconfig.json` `paths` and `baseUrl` are set correctly
  Cause: the bun bundler does NOT honour `tsconfig.json` `compilerOptions.paths` for module resolution during `Bun.build` - webpack with `ts-loader` does, but bun treats the alias as a literal specifier. So a project that builds cleanly under webpack starts failing the moment you switch to `bun build/bun/build.js`.
  Fix: either (a) replace every `@src/...` import with a relative import (`./models/State`, `../controllers/Pages`), or (b) declare the aliases to bun itself via a `bunfig.toml` at the repo root: `[install]\nbunfig.toml` does not handle aliases - use the `tsconfig.json` `paths` AND a bun-native `tsconfig-paths` plugin in `Bun.build({ plugins: [tsconfigPaths()] })`, or the simpler `Bun.build({ alias: { '@src': './src' } })`. Pick (a) unless the codebase is huge - relative imports survive every bundler switch with zero config. (2026-07)

- [zX3kL9] Undo/redo restores stale or wrong state even though every command "looked right" - commands captured LIVE mutable objects
  Cause: a command that stores a reference to (or shallow-copies fields of) a live model object, or inserts its stored object back into the model on restore, lets LATER commands mutate that stored object - so a future undo/redo cycle restores a corrupted "snapshot" (eg a delete command's stored node gets moved by a later move command's undo, and the node comes back at the wrong position).
  Fix: commands must own immutable snapshots and insert FRESH clones on every apply/restore: capture with a deep clone (JSON.parse(JSON.stringify(x)) for plain data) and insert clone(snapshot) in BOTH do() and undo() - never the same object twice. Value-only captures (plain rects/ids) are safe. (2026-07)

- [dRcH9k] Proving code is DEAD before deleting it (large legacy cleanup) - grep shows usage but can miss, and "no import found" by eye is unreliable at scale
  Cause: in a copied/renamed project, whole controller trees may be unrouted and unimported, but manually checking each file is error-prone; deleting a file that IS still imported only fails at build/typecheck time.
  Fix: build the import-reachability graph: walk from the entry point (src/index.ts), follow every `import` specifier (relative AND path aliases like `@src/`), mark visited files; every source file NOT visited is dead. Then cross-check the dead set against the route table (no routes), the html templates (no template for the page) and string-based instantiation before deleting; run typecheck + the full e2e after. The route table and templates existing WITHOUT the controllers being imported is normal when the router has a template-only default case. (2026-07)

- [bV9nM4] `RangeError: Maximum call stack size exceeded` from a singleton's own init chain - `getInstance()` re-entered before the first instance was assigned
  Cause: the App singleton constructor called `this.init()`, and init SYNCHRONOUSLY constructed controllers whose base constructor calls `App.getInstance()`. `App.instance` is only assigned when `new App()` returns - still in flight - so getInstance() starts another `new App()` -> init -> controller -> getInstance()... The hazard stays hidden as long as init happens to `await` something before the first controller construction; removing that await detonates it.
  Fix: never call init() from the singleton constructor. `getInstance()` must return a fully-constructed (but not yet initialised) instance; the entry point then calls `void app.init()` after assignment. Then any controller built during init finds App.instance already set. (2026-07)

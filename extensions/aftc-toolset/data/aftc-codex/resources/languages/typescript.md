# TypeScript

- `[RqFfJF] Cannot read properties of undefined (reading 'fileExists')` from ts-loader
  Cause: ts-loader 9.x is incompatible with typescript 7.
  Fix: pin typescript to ^6 until ts-loader adds support. (2026-07)
- [iQuKUd] Bind/placeholder names containing digits silently mismatch validators that scan SQL with `/:[a-zA-Z_]+/` (eg AFTC PDOQueryLib::checkPlaceholders reports undefined/unused binds for `:cat0`)
  Cause: the pattern matches `[a-zA-Z_]+` only, so a digit in a bind name falls outside the match.
  Fix: use alphabetic suffixes for generated placeholders (:cata, :catb). (2026-07)
- [N4wM2K] `bun build` reports `Could not resolve: "@src/..."` (or any `@alias/...`) even though `tsconfig.json` `paths` and `baseUrl` are set correctly
  Cause: the bun bundler does NOT honour `tsconfig.json` `compilerOptions.paths` for module resolution during `Bun.build` — webpack with `ts-loader` does, but bun treats the alias as a literal specifier. So a project that builds cleanly under webpack starts failing the moment you switch to `bun build/bun/build.js`.
  Fix: either (a) replace every `@src/...` import with a relative import (`./models/State`, `../controllers/Pages`), or (b) declare the aliases to bun itself via a `bunfig.toml` at the repo root: `[install]\nbunfig.toml` does not handle aliases — use the `tsconfig.json` `paths` AND a bun-native `tsconfig-paths` plugin in `Bun.build({ plugins: [tsconfigPaths()] })`, or the simpler `Bun.build({ alias: { '@src': './src' } })`. Pick (a) unless the codebase is huge — relative imports survive every bundler switch with zero config. (2026-07)

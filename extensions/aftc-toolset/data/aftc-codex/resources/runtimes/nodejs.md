# Node.js

## Rules

## Gotchyas

## Issues & Solutions


- [J5tW9E] Node runs a .ts file but then fails on `enum`, `namespace`, parameter properties, or `@paths/...` alias imports
  Cause: Node's native type-stripping (22.6+ experimental, default in 23.6+/24) only supports ERASABLE syntax — no enums/namespaces/parameter properties — and does not resolve `tsconfig` `compilerOptions.paths` aliases.
  Fix: if you need those features, keep a real build step (bun/tsc) or use a runtime that fully supports TS (Deno); also note `tsc` EMIT itself does not rewrite path aliases in output JS either — emitted files keep the literal `@src/...` specifier and break at runtime unless you add `tsc-alias`, bundle instead, or use relative imports. (2026-07)

- [ntL8x3] createRequire(__filename) throws ERR_INVALID_ARG_VALUE ("...Received '[eval]'") under node -e / --eval
  Cause: in `node -e` / `--eval` there is no source file, so `__filename` is the literal string `[eval]`; module.createRequire needs a file URL / absolute path and rejects `[eval]`.
  Fix: don't bootstrap require/jiti inline with `-e`. Write the snippet to a temp .mjs and run `node tmp.mjs`, using createRequire(import.meta.url) (a valid file URL) — this is why one-off jiti-load checks are loaded from a file, not inline eval. (2026-07)

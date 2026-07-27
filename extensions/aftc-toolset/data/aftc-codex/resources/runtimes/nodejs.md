# Node.js

- [J5tW9E] Node runs a .ts file but then fails on `enum`, `namespace`, parameter properties, or `@paths/...` alias imports
  Cause: Node's native type-stripping (22.6+ experimental, default in 23.6+/24) only supports ERASABLE syntax — no enums/namespaces/parameter properties — and does not resolve `tsconfig` `compilerOptions.paths` aliases.
  Fix: if you need those features, keep a real build step (bun/tsc) or use a runtime that fully supports TS (Deno); also note `tsc` EMIT itself does not rewrite path aliases in output JS either — emitted files keep the literal `@src/...` specifier and break at runtime unless you add `tsc-alias`, bundle instead, or use relative imports. (2026-07)

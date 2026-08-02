# Node.js

## Rules

- [Fo4Goe] Never use execSync/exec with shell:true for known commands - use execFileSync(file, args[]) with the command and arguments as an array; this eliminates shell-injection risk, quoting surprises, and cross-platform shell-syntax differences.

## Gotchyas

- [ne6aay] Detached child process keeps running after `child.kill()` on POSIX — `child.kill()` only sends a signal to the (already-detached) parent; the child is its own session leader and ignores it. Countermeasure: spawn detached, track the pid, and kill the whole process group with `process.kill(-pid, "SIGKILL")` (POSIX) or `taskkill /pid X /T /F` (Windows); also `.unref()` the watchdog setTimeout so a slow child does not keep the host alive past its own exit.

- [lHP5Bm] npm v12 blocks dependency install scripts (postinstall, native builds) unless package.json allowScripts matches the EXACT installed version - after a dependency version bump the old entry silently stops covering it and scripts are blocked again; watch for the 'had install scripts blocked' warning and update the version in allowScripts.

## Issues & Solutions


- [J5tW9E] Node runs a .ts file but then fails on `enum`, `namespace`, parameter properties, or `@paths/...` alias imports
  Cause: Node's native type-stripping (22.6+ experimental, default in 23.6+/24) only supports ERASABLE syntax - no enums/namespaces/parameter properties - and does not resolve `tsconfig` `compilerOptions.paths` aliases.
  Fix: if you need those features, keep a real build step (bun/tsc) or use a runtime that fully supports TS (Deno); also note `tsc` EMIT itself does not rewrite path aliases in output JS either - emitted files keep the literal `@src/...` specifier and break at runtime unless you add `tsc-alias`, bundle instead, or use relative imports. (2026-07)

- [ntL8x3] createRequire(__filename) throws ERR_INVALID_ARG_VALUE ("...Received '[eval]'") under node -e / --eval
  Cause: in `node -e` / `--eval` there is no source file, so `__filename` is the literal string `[eval]`; module.createRequire needs a file URL / absolute path and rejects `[eval]`.
  Fix: don't bootstrap require/jiti inline with `-e`. Write the snippet to a temp .mjs and run `node tmp.mjs`, using createRequire(import.meta.url) (a valid file URL) - this is why one-off jiti-load checks are loaded from a file, not inline eval. (2026-07)

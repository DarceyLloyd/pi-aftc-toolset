# Deno

- [K7mP2X] Responses from `Deno.serve` are sent uncompressed even though older code relied on automatic gzip
  Cause: automatic response compression was changed to opt-in in Deno 2.9 (previously on by default).
  Fix: pass `automaticCompression: true` in the serve options, or set `DENO_SERVE_AUTOMATIC_COMPRESSION=1`. (2026-07)
- [T4rN8Q] `const id: number = setTimeout(...)` type-errors / `typeof timer === "number"` branches never run (Deno 2.8+)
  Cause: `setTimeout`/`setInterval` now return Node's `Timeout` object instead of a number, matching `node:timers`.
  Fix: type timer ids as `NodeJS.Timeout` (available by default via `lib.node` since 2.8) and clear unconditionally; never arithmetic or typeof-check timer ids. (2026-07)
- [W9sB3M] Tests that used to fail on leaked timers/resources now pass silently (Deno 2.8+)
  Cause: `sanitizeOps` and `sanitizeResources` on `Deno.test()` changed from default `true` to default `false`.
  Fix: re-enable per test (`{ sanitizeOps: true, sanitizeResources: true }`), per file via `Deno.test.sanitizer({ ops: true, resources: true })`, or globally in `deno.json` under `test`. (2026-07)
- [Z6vC1R] `deno install` refuses a just-published npm package version ("too new" / resolution failure) (Deno 2.9+)
  Cause: `min-release-age` is enabled by default with a 24-hour window as a supply-chain guard; versions younger than that are refused.
  Fix: tune or disable in `.npmrc` (`min-release-age=72h` or `min-release-age=0`). (2026-07)
- [Q2nD5Y] `deno add express` fails on Deno < 2.8 with "missing a prefix" but works on 2.8+
  Cause: since 2.8 the CLI treats unprefixed names as npm packages by default; before that `npm:` was required at the CLI too.
  Fix: use `deno add npm:express` on older versions; note `npm:`/`jsr:` prefixes are still required inside `import` specifiers on all versions. (2026-07)
- [H8kF4V] `import chalk from "npm:chalk"` fails lint even though it runs
  Cause: the `no-unversioned-import` lint rule (on by default since 2.5) requires a version in every `npm:`/`jsr:` specifier; the `workspace`-set `no-import-prefix` rule also pushes deps into `deno.json` instead of inline specifiers.
  Fix: declare deps in `deno.json` `imports` with a version (`"chalk": "npm:chalk@^5"`) and import the bare specifier. (2026-07)

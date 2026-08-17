# file-search-args — pure CLI argument construction

Side-effect-free arg builders for the `fd` and `rg` tools, so the exact
argv can be asserted in tests without any binary or process.

## Contract

- Patterns are ALWAYS placed after a `--` separator — model input can never
  be parsed as a flag.
- `normalizeSearchPath` strips a leading `@` (some models prepend it) and
  expands `~` / `~/...` to the home dir.
- Numeric options are clamped (`limit`, `max_depth`, `context`) to the
  exported bounds.
- `buildFdArgs` / `buildRgArgs` return a plain `string[]` ready for
  `spawn(command, args)`.

Tests: `tests/file-search-check/` asserts the exact argv for representative
params (flag safety, clamping, path normalisation).

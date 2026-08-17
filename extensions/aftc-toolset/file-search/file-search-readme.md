# file-search — first-class `fd` + `rg` tools

The coordinator: two model tools (`fd`, `rg`) over the Rust `fd`/`ripgrep`
binaries, plus the on/off commands. Plain TS, no Effect.

## Binary resolution (lean)

`resolveBinary` probes PATH (`fd`/`fdfind`, `rg`) with a `--version` run
(5 s cap). The result is cached for the session. A missing binary makes the
tool throw a clear error with platform install hints — no auto-download.

## Execution

`executeSearch` spawns the binary directly with an args array (never a
shell), `windowsHide`, cwd = `ctx.cwd`, stdout/stderr captured to a bounded
in-memory cap (5 MB / 64 KB). 60 s timeout, honours the abort signal
(SIGKILL on timeout/abort). ripgrep's exit-1 "no matches" is handled; any
other non-zero exit throws `tool failed: <stderr>` (which the tool-error
tracker records). Output is `truncateHead` to pi's 2000-line/50 KB limits,
the full result persisted to a temp file when cut.

## Rules

- `fileSearchEnabled` preference, default on; `/file-search-on|off` +
  `/reload`.
- Arg safety (patterns after `--`, `@`/`~` path handling, clamped limits)
  lives in `file-search-args.ts`.
- Model guidance steers fd (names) vs rg (content) vs bash (pipelines) and
  `fixed_strings` for literal snippets.

Tests: `tests/file-search-check/` (arg building + classifier; the search
itself needs fd/rg installed).

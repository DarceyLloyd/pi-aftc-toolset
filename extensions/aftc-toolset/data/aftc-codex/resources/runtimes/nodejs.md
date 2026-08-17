# Node.js

## Rules

- [Fo4Goe] Never use execSync/exec with shell:true for known commands - use execFileSync(file, args[]) with the command and arguments as an array; this eliminates shell-injection risk, quoting surprises, and cross-platform shell-syntax differences.

- [V8IHyT] Generating a once-per-install id file: write with flag 'wx' (exclusive-create); on EEXIST re-read the file to take the winner's value - concurrent processes agree on one id, unlike a plain write (last-writer-wins).

- [5Tmj5Q] Zero-dependency headless browser screenshots: launch Edge/Chrome with --headless=new --remote-debugging-port=0, parse the 'DevTools listening on' line from stderr, fetch the page target from the debugger's /json/list endpoint, and drive it over Node's built-in WebSocket (22+); full-page capture = Page.getLayoutMetrics contentSize then Page.captureScreenshot with captureBeyondViewport:true and a clip sized to that content. A hash-only navigation does not reload an SPA that reads location.hash at boot - set the hash then location.reload() for each route.

## Gotchyas

- [ne6aay] Detached child process keeps running after `child.kill()` on POSIX — `child.kill()` only sends a signal to the (already-detached) parent; the child is its own session leader and ignores it. Countermeasure: spawn detached, track the pid, and kill the whole process group with `process.kill(-pid, "SIGKILL")` (POSIX) or `taskkill /pid X /T /F` (Windows); also `.unref()` the watchdog setTimeout so a slow child does not keep the host alive past its own exit.

- [lHP5Bm] npm v12 blocks dependency install scripts (postinstall, native builds) unless package.json allowScripts matches the EXACT installed version - after a dependency version bump the old entry silently stops covering it and scripts are blocked again; watch for the 'had install scripts blocked' warning and update the version in allowScripts.

- [ljmCKT] execFileSync on a .cmd/.bat shim (node_modules/.bin/<tool>.cmd) fails silently on Windows without shell:true - the shim is not a real executable, and the child exits 1 with empty stdout/stderr; countermeasure that keeps the no-shell rule: execFileSync(process.execPath, [path/to/node_modules/<pkg>/bin/<entry>.cjs|.mjs, ...args]) so the current runtime (node or bun) runs the tool's JS entry directly.

- [1DhIle] Operating systems recycle PIDs quickly — asserting "distinct PIDs" across short-lived children spawned one after another is flaky (a new child can reuse a dead sibling's PID); assert concurrent liveness instead (two processes alive at the same moment).

- [botS3x] A `*/` sequence inside a block comment (easy to type in glob-like text such as a/*/b) terminates the comment early and produces a SyntaxError pointing at innocent later code; keep asterisk-slash pairs out of comments.

- [Q2Pcc7] A module that resolves its data-dir/paths at import time (module-level const) caches them for the whole process - changing an env override and re-calling in the same process still opens the original path; get a fresh module instance (child process, or clear the require/jiti cache) to honour a new path.

- [4KeWab] Line-based parsing of an append-only file with resume offsets: text ending in '\n' makes split('\n') emit a phantom '' element, and consuming it as a stray line pushes the resume offset PAST where the next record's header lands — so newly appended records are never parsed again; exclude the trailing phantom element when computing line counts/offsets and treat empty input as zero lines.

## Issues & Solutions


- [J5tW9E] Node runs a .ts file but then fails on `enum`, `namespace`, parameter properties, or `@paths/...` alias imports
  Cause: Node's native type-stripping (22.6+ experimental, default in 23.6+/24) only supports ERASABLE syntax - no enums/namespaces/parameter properties - and does not resolve `tsconfig` `compilerOptions.paths` aliases.
  Fix: if you need those features, keep a real build step (bun/tsc) or use a runtime that fully supports TS (Deno); also note `tsc` EMIT itself does not rewrite path aliases in output JS either - emitted files keep the literal `@src/...` specifier and break at runtime unless you add `tsc-alias`, bundle instead, or use relative imports. (2026-07)

- [ntL8x3] createRequire(__filename) throws ERR_INVALID_ARG_VALUE ("...Received '[eval]'") under node -e / --eval
  Cause: in `node -e` / `--eval` (and piped-stdin scripts) there is no source file, so `__filename` is the literal string `[eval]`; likewise `require.resolve("module")` returns the bare specifier `module` — createRequire needs a file URL / absolute path and rejects both.
  Fix: don't bootstrap require/jiti from `[eval]` or a bare specifier. Write the snippet to a temp .mjs and run `node tmp.mjs` with createRequire(import.meta.url), or pass an absolute real file path (eg join(packageRoot, "noop.cjs")) to createRequire. (2026-08)

- [9Ohp5A] ERR_FS_EISDIR from cpSync during a recursive directory copy
  Cause: Dirent.isDirectory() returns false for a symlink pointing at a directory, so the entry falls through to the file-copy branch and cpSync dereferences it as a file.
  Fix: In any recursive copy/walk, guard `entry.isSymbolicLink()` first (skip or handle explicitly) before the isDirectory/file branches; harden further by only copying when entry.isFile() so sockets/FIFOs are skipped too. (2026-08)

- [g5e4gH] A long-running Node server with a stdin-EOF shutdown hook exits instantly when spawned from a script/automation
  Cause: outside a real console the child's stdin is a pipe or ignored handle that reaches EOF immediately, so an unconditional `stdin.on('end', stop)` fires at startup and kills the server.
  Fix: make the stdin-EOF guard opt-in (env flag or explicit parameter), and rely on an idle-timeout watchdog plus normal window-close/SIGINT for leak protection instead. (2026-08)

- [ESEp6B] A node child_process tree-kill via `taskkill /pid X /T` (no /F) leaves the process "running" — the grandchild tree survives and keeps holding inherited stdio pipes open, so the child's 'close' never fires and settle/timeout logic never runs
  Cause: Windows has no POSIX signals, so a graceful taskkill (no /F) cannot terminate console processes (node, bash) and the fallback child.kill(signal) kills only the DIRECT child (the shell); the grandchildren keep the inherited stdout/stderr pipes open, so the stdio 'close' event never fires even though the leader exited.
  Fix: On Windows always force-kill the whole tree with `taskkill /pid X /T /F` — a graceful phase is meaningless there. Reserve the SIGTERM→SIGKILL escalation for POSIX process-group kills (process.kill(-pid, signal)). (2026-08)

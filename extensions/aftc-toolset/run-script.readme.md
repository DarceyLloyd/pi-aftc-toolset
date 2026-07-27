# run-script.ts

Reliable large-script execution — a workaround for a pi `bash`-tool bug.

## Why it exists

pi's built-in `bash` tool feeds an inline command to the shell through standard
input and, for a large command (a few KB+), **silently truncates** it: the first
part runs, everything after the cut does NOT, and no error is reported (silent
partial execution). This is an upstream pi bug (reported against
`@earendil-works/pi-coding-agent`, `dist/core/tools/bash.js` — the stdin-transport
path writes the command with `child.stdin.end(command)` and swallows the error).

`run_script` sidesteps it: the model passes the whole script BODY as a parameter,
this tool writes it to a temporary file and runs `bash <file>`. The only inline
command is the tiny `bash /tmp/xyz.sh`, so there is no inline-size limit and
nothing to truncate.

## What it adds to the extension

- A `run_script` model tool — run a multi-line / large bash script reliably.
- Two toggle commands: `/run-script-on`, `/run-script-off`.
- The `runScriptEnabled` preference (config gate).

## The tool

`run_script(script, cwd?, timeout?)`:

- `script` (required) — the full bash script. Written to a temp file
  (`<tmpdir>/aftc-run-script-<uuid>.sh`) and executed with `bash <file>`.
- `cwd` (optional) — working directory (default: current). A leading `@` is
  stripped; a non-existent dir throws a clear error.
- `timeout` (optional) — seconds (default 120, max 1800). Past it, the script's
  whole process TREE is killed.

Returns the combined stdout/stderr (truncated with `truncateTail` like the bash
tool; full output saved to a temp file when truncated) plus a footer with the
exit code, and timeout/abort notes. A non-zero exit code is REPORTED (in the
result), not thrown; tool-level failures (empty script, no bash, bad cwd) throw.

### Bash resolution (cross-platform)

- Windows: git-bash — `Program Files\Git\bin\bash.exe`, the x86 path,
  `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`, then `bash` on PATH.
- Linux/mac: `/bin/bash`, `/usr/bin/bash`, `/usr/local/bin/bash`, then PATH.
- If no bash is found, the spawn error is turned into a clear message ("Is Git
  for Windows (git-bash) installed?" / "Is bash installed?").

### Timeout / abort = process-tree kill

A plain `child.kill()` leaves grandchildren (eg `sleep`) running and holding the
pipes open, so `close` would wait for them. On timeout/abort this tool kills the
whole tree — `taskkill /pid <pid> /T /F` on Windows, a process-group kill
(`spawn` is `detached` on unix, then `process.kill(-pid, "SIGKILL")`) elsewhere —
with a short grace timer as a safety net so the call always returns promptly.

## Easy removal / disable (by design)

This is a workaround for an upstream bug pi may fix, so it is built to be removed
or disabled cleanly:

- **Disable without removing code:** `/run-script-off` (or set `runScriptEnabled`
  to `false` in config.json), then `/reload`. The tool is then fully absent from
  the model's tool list (it is registered conditionally at factory time); the
  toggle commands stay so you can turn it back on.
- **Remove entirely once pi ships a fix:** delete `run-script.ts` +
  `run-script.readme.md`, remove the single `createRunScript(pi)` line (and its
  import) from `index.ts`, drop `runScriptEnabled` from `config.ts`, and delete
  `tests/run-script-check/`. Nothing else references this module.

## Public API

`createRunScript(pi)` — registers the two commands always, and the `run_script`
tool only when `runScriptEnabled` is true (default).

## Configuration

`runScriptEnabled` (boolean, default `true`) — see `config.ts`. Migrated into an
existing config.json via the write-back pattern.

## Events subscribed

None (tool + commands only).

## Files persisted

None. Temporary script files (`aftc-run-script-<uuid>.sh`) are created in the OS
temp dir and deleted after each run; a full-output log (`aftc-run-script-out-*.log`)
is left in the temp dir only when output was truncated (for inspection; the OS
cleans temp).

## Failure modes

- No bash → clear error (does not run bash under another shell).
- Empty script / non-existent cwd → throws a clear error.
- Timeout / abort → process tree killed, `timedOut`/`Aborted` noted, returns the
  output captured so far.
- All temp-file cleanup is best-effort (locked/missing files are ignored).

## Cross-platform

Paths via Node `path`/`os`; execution via `node:child_process` (no shell wrapper);
Windows git-bash path discovery + `taskkill /T` tree-kill; unix process-group kill.
Verified on Windows (git-bash) and Linux.

# background-terminal-ui — /bt screen

The user-facing screen for background terminals, built entirely on the
shared aftc-ui primitives (no hand-rolled TUI components — this project
renders every dialog through `ui/aftc-ui.ts`).

## Surface

- **`/bt`** — `manageTerminals`: a scrollable list of the RUNNING
  terminals with a `TERMINATE ALL (n)` row at the top. Enter on a row
  asks a yes/no `showConfirm`, stops the selection via `manager.kill`,
  then re-renders a REFRESHED list (loop); Esc closes. Output inspection
  is the model's `bg_status` tool — /bt is the stop surface (the old
  read-only viewer and the separate `/bt-kill` command are gone).
- **`printTerminalList`** — the headless fallback (print mode / RPC
  mode): a plain-text listing via `aftcConsole.print`.

## Confirm wording

The TERMINATE ALL confirm states the factual safety: a kill signals only
the terminal's own process tree (Windows `taskkill /T` on the child pid;
POSIX signals the child's own detached process group), so it can never
stop this pi session or any other shell — only programs started INSIDE
a terminal stop with it. Kept to short lines (confirm body wraps, but
brevity is deliberate).

## Conventions

- `describeTerminal` renders a one-line summary (id, status, title, pid,
  elapsed, exit) — the short menu form; the model-facing `bg_list` tool
  uses a fuller form in the coordinator.
- Every command guards `ctx.mode === "tui"` and provides the headless
  path.

Tests: selection/describe helpers are trivial string logic; the screen
itself is visual (per AGENTS.md, visual UI is verified by the user, not
automated).

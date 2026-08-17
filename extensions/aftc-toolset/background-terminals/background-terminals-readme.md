# background-terminals — coordinator

The feature edge (wired as `createBackgroundTerminals(pi)` in index.ts):
registers the enable/disable commands always, and — only when
`backgroundTerminalsEnabled` is on — the four model tools, the `/bt`
command, the "N terminals running" widget, and the exactly-once
completion follow-up.

## Default state

**OFF by default** (project rule: new user-facing features default OFF).
`/bt-on` persists the preference; `/reload` applies it. When off, only
`/bt-on` and `/bt-off` exist — the tools are fully absent from the model's
tool list (no wasted prompt tokens, no stray calls), the same pattern as
`run-script.ts`.

## Surface

| Name | Kind | Purpose |
| --- | --- | --- |
| `bg_start` | tool | spawn a command (command, title, working_dir) |
| `bg_status` | tool | peek at one terminal's status + tail output |
| `bg_list` | tool | list all tracked terminals |
| `bg_kill` | tool | stop one or more (SIGTERM→SIGKILL tree) |
| `/bt` | command | scrollable list + stop one or all (TUI) / plain list (headless) |
| `/bt-on` / `/bt-off` | command | enable / disable (always registered) |

## Completion delivery (exactly once, no polling)

On settle the manager invokes `onSettled(snap, consumed)`. A deferred,
Map-keyed delivery (`createDeferredResultDelivery`) is drained either
immediately (when the agent is idle) or on `agent_settled`, via
`pi.sendMessage(..., { deliverAs: "followUp", triggerTurn: true })` — the
message queues until the agent has no more tool calls and wakes the model
once. `consumed` ids (a settle being returned by `bg_kill`/`bg_status`
itself) are dropped from the deferred map, so double delivery is
structurally impossible.

## Lifecycle

`session_shutdown` clears the deferred queue, hides the widget, and
`await manager.disposeAll()` — SIGKILLing every tree (bounded). Processes
never survive `/new`, `/resume`, `/fork`, `/reload`, or quit. Spill-to-disk
full-log capture from the upstream reference is dropped (lean port); each
stream keeps a bounded in-memory tail and truncation is reported honestly.

Tests: `tests/background-terminals-check/` — `manager-check.ts` (logic) and
`load-check.ts` (jiti load of every module).

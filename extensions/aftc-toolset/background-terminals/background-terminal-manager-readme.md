# background-terminal-manager — plain-TS process registry

The core of the background-terminals feature: a registry of shell processes
the model can start, inspect and stop. No pi API dependency (pure
`node:child_process`), so it is unit-testable standalone.

## Model

A "terminal" is one long-running command run through the platform shell
(git-bash on Windows, `$SHELL`/`/bin/sh` elsewhere) with **stdin ignored** at
the OS level — there is no way to send input later. stdout and stderr are
captured separately into bounded in-memory tails (newest retained; the head
is dropped and counted in `truncatedBytes`).

Statuses are final: `running` → `done` (exit 0) / `failed` (non-zero or
spawn error) / `killed` (bg_kill, the /bt UI, or session teardown).

## Why no Effect

The upstream reference builds this on Effect v4. This project has a
"no build step, few dependencies, keep it simple" rule, so the manager is
plain async/await. `start()` is synchronous (spawn + register happen before
it returns), which removes the concurrency-reservation dance: the
check-and-set has no await between it, so parallel tool calls cannot race
past `MAX_RUNNING` (8).

## Key behaviours

- **Kill tree** — `killTree` always uses `taskkill /pid X /T /F` on Windows
  (graceful taskkill fails on console processes and orphans grandchildren
  holding the pipes); POSIX signals the process group (`process.kill(-pid)`).
- **SIGTERM → SIGKILL escalation** — `signalTermination` sends SIGTERM then a
  2s deadline SIGKILL (POSIX-meaningful; harmless no-op on Windows).
- **Settle is idempotent and single-sourced** — `settle()` runs once; kill vs
  natural-exit vs spawn-error races resolve to whichever lands first.
  `killSignaled` is set only when actually signalling a live process, so a
  natural exit that wins the race keeps its truthful `done`/`failed` status.
- **Grandchild holding pipes** — after `exit` without `close`, a 3s grace
  reaps the surviving group so a "running" entry can never hang forever.
- **Consumed semantics** — `killInterest` marks an in-flight `kill()`; the
  settle hook receives `consumed=true` for those ids so the completion
  follow-up is not double-delivered.
- **Bounded teardown** — every wait is capped (`KILL_WAIT_MS`, `disposeAll`
  3s), and `disposeAll` force-settles stragglers so `session_shutdown`
  cannot hang.

## Public API

| Member | Purpose |
| --- | --- |
| `start(opts)` | spawn + register; throws on shutdown or over-cap |
| `list()` / `get(id)` / `size()` / `runningCount()` | read model (snapshots are live, do not mutate) |
| `kill(ids)` | SIGTERM→SIGKILL; resolves with per-id `KillResult` after settle |
| `requestKill(id)` | fire-and-forget kill for the UI |
| `subscribe(fn)` | any-change notification (widget, list refresh) |
| `setOnSettled(hook)` | settle hook with the `consumed` flag |
| `disposeAll()` | kill everything; idempotent |

Tests: `tests/background-terminals-check/manager-check.ts` (pure node,
no pi — runs with native TS stripping).

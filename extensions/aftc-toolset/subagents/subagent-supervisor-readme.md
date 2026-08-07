# subagents/subagent-supervisor.ts — readme

The in-extension coordinator for sub-agent runs: scheduling, child
processes, run state, watchdogs, cancellation and the termination
ladder. Foreground-only in v1 — `startRun()` resolves with the
`SubAgentRunResult` the `subagent` tool returns.

## API

- `createSubAgentSupervisor(deps)` -> `{ startRun, cancelRun, getRuns,
  getStatusSnapshot, shutdown, dispose }`.
- `startRun(params)` — profile + briefing (`task`, `context`,
  `acceptance`, `target`) + `resolveModel` hook (+ optional
  `preSpawnGate`, `parentCodexEnabled`, `onProgress`).
- Deps seams for tests: `spawner` (fake-child harness), `runsRoot`,
  `childRuntimePath`, `watchdogTickMs`, `now`.

## Run flow

queued -> starting -> running -> one terminal state
(completed / blocked / failed / cancelled / timed_out).

1. Slot reservation BEFORE spawn (invariant 7): over `maxConcurrent`
   -> queue (cap `maxQueued`); over `maxRunsPerSession` -> throw.
2. `resolveModel` runs in the parent BEFORE spawn — an unresolvable
   model is a clean pre-spawn `failed`, never an after-spawn failure.
3. Run dir `<dataDir>/subagents/runs/<run-id>/` (meta.json,
   run-config.json 0600, transcript.jsonl when enabled, report.json).
4. Spawn (detached), readiness via a real `get_state` request (a
   SIGNAL, never a sleep), then the briefing `prompt` — the ONLY data
   channel to the child.
5. Events are attributed per child handle (invariant 14): usage
   accumulates from assistant `message_end`, final assistant text is
   captured, `report_result` args captured FIRST-WINS (invariant 2),
   turn/tool/compaction counters, signatures for loop detection.
6. `agent_settled` -> best-effort `get_session_stats` (authoritative
   usage + context %) -> close stdin (graceful) -> finalise.
7. Forgiving handoff: no structured report -> the final assistant text
   IS the report.

## Termination ladder

abort (RPC) -> bounded wait for exit -> close stdin -> bounded wait
for natural exit -> SIGTERM to the process group -> deadline ->
SIGKILL to the process group (Windows: `taskkill /T /F`). A
`cancelling` flag makes the ladder own the outcome — settled/exit
handlers cannot race it.

## Watchdogs (1s tick, lazy start, stopped when idle)

- Wall clock: `timeoutSeconds` -> timed_out.
- Max turns: steer wrap-up at `maxTurns`, hard abort after `graceTurns`.
- Stall (invariant 17): no progress event for `stallTimeoutSeconds`
  (per-profile override) -> steer EXACTLY ONCE, second hit aborts
  (timed_out, `stall` diagnostic, `partial` flag). Progress resets the
  steer budget. Response ACKs are swallowed by the transport, so they
  can never fake progress.
- Loop (invariant 18): bounded signature ring (tool name + hashed key
  args); repeats >= `loopThreshold` -> steer once; threshold+2 after
  steering -> abort (cancelled, `loop` diagnostic, `partial` flag).

## Invariant net

- One child per run (invariant 1); one terminal state + one report
  (2); no orphaned trees — `shutdown()` force-kills everything, and a
  module-level process `exit` hook (registered once, PID registry)
  covers abnormal parent exit (6); startup failures finalise `failed`
  with no second execution path (16); all report/briefing/progress
  sizes bounded (12).
- NO database writes: spend lives in the in-memory session accumulator
  surfaced by `getStatusSnapshot()`.

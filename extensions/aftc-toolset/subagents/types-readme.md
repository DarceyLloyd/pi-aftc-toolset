# subagents/types.ts — readme

Shared interfaces for the sub-agent feature (codename 007). Modules inside
`subagents/` share these types instead of importing each other's
internals; the orchestrator wires `createSubAgents(pi)` from
`subagents.ts`.

Contents:

- `SubAgentProfile` — one agent definition parsed from a markdown
  file with YAML frontmatter. Capabilities live in the profile, never
  in tool arguments (design principle 3). The catalog fills every
  default; the supervisor consumes the resolved values.
- `SubAgentProfileSource` — discovery tier: `project` > `user` >
  `builtin` (no silent shadowing; qualified ids in the catalog).
- `SubAgentRunState` + `SUB_AGENT_TERMINAL_STATES` /
  `isSubAgentTerminalState` — run lifecycle. A run reaches at most
  ONE terminal state (design invariant 2).
- `SubAgentUsage` (+ `emptySubAgentUsage()`) — accumulated child model
  usage (input/output/cacheRead/cacheWrite tokens + USD cost).
- `SubAgentReport` — the bounded handoff. `structured` distinguishes a
  `report_result`-tool report from the forgiving fallback (final
  assistant text IS the report).
- `SubAgentRunView` — live UI-safe view of one run (state, timing,
  counters, usage, context %, report, diagnostics, flags).
- `SubAgentRunResult` — what the foreground `subagent` tool resolves
  with (state, report, final text, usage, diagnostics, elapsed).
- `SubAgentStatusSnapshot` — in-memory live snapshot for the footer
  line + `/007-status`. Carries `active`, `runningCount`,
  `queuedCount`, `sessionCost`, `busiest`, `runningAgents` (the
  currently running agents: name + latest context-window %), `avgElapsedMs` (average wall time of
  completed runs this session; null when none — both computed by the
  supervisor) and `warning`. Never read from a database (design: no DB
  writes).

Naming: capital-A `SubAgent` prefix everywhere (design section 21).

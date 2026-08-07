# subagents/subagent-commands.ts — readme

The sub-agent command surface (codename 007). Registers `/007` + the
`/007-*` family ONLY — no aliases (design Q3: pi has no
pre-registration collision check and silently suffixes colliding names
as `/name:1`, so distinctive names are the only safe policy). Family:
status, kill, edit, reset, install, sync, open-agent-dir,
guide, settings, doctor. All console output uses the `Sub-agents:`
prefix.

- `registerSubAgentCommands(pi, deps)` — called by `createSubAgents`.
- `/007` handler: `ctx.hasUI` -> `openSubAgentMainMenu`; headless ->
  `printSubAgentSummary` (bounded, never blocks).
- Every registered command gets its `registerHelpEntry` row here (the
  help registry is the single source of truth for `/aftc-help`),
  category `Sub-agents`.

Deps: `supervisor` + `getSnapshot` from the factory closure —
commands never import feature siblings directly.

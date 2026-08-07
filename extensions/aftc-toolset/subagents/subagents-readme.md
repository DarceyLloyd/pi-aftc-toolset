# subagents/subagents.ts — readme

Main module of the sub-agent feature (codename 007) — the
`aftc-codex.ts` analogue. Exports `createSubAgents(pi)`, wired by the orchestrator
(`index.ts`).

Responsibilities (growing with the phased build):

- Register the `subagent` model tool (foreground-only in v1 — NO `mode`
  field). Schema: `agent` / `task` / `context` / `acceptance` /
  `target` and nothing else. Unknown names throw
  `subagents: unknown sub-agent "<name>". Known: ...`. Capabilities
  live in the profile, never in tool arguments.
- Own the supervisor instance (lazy; no processes/timers in the
  factory) and kill every child tree in `session_shutdown`.
- Register the `/007` command surface via `subagent-commands.ts`.
- Expose `getSubAgentStatusSnapshot()` for the footer line (wired
  through the orchestrator — feature modules never import each other).
  `buildSubAgentFooterLine(snapshot, colors, maxConcurrent)` formats
  the line: `Sub Agents running: 2/4 | Session cost: $0.14 | Agent avg
  task time: 1m 30s | Agents running: worker 42%, explorer 18%` (+ `! ` warning
  prefix when a run is stalled/looping/over context). It is always
  visible while the feature is enabled — hidden only when disabled or
  `footerLineEnabled` is off; the caller supplies the footer c1/c2/c3
  color helpers and receives an already-themed line.

Capability Exposure (design section 11): children are hermetic. The
only exposable surfaces are codex read (default on, gated by
`codexAccessEnabled` + the agent's `codex` flag + the parent
session having codex enabled) and codex write (default off,
additionally gated by `codexWriteEnabled`). Notifications, usage DB,
docx, SSH and UI are never exposed.

Disabled by default: `enabled: false` in `subagents-config.json`; the
`/007` menu's option 1 enables the feature (seeding the agents folder
first; a seed failure aborts the enable). The enable confirm only
appears when the live data dir is missing ("Unable to detect local sub
agents data directory. Shall I create and seed?"); an existing folder
enables silently.

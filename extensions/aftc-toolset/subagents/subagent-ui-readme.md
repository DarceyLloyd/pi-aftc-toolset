# subagents/subagent-ui.ts — readme

The sub-agent aftc-ui screens (codename 007). Built ONLY from aftc-ui
primitives (`showMenu`/`showConfirm`/`showInput`/`showViewer`/
`showIntInput`) with aftc-console output; `ctx.hasUI` guards headless
mode (print mode gets a bounded `aftcConsole.print` block via
`printSubAgentSummary`). All transcript/console lines use the
`Sub-agents:` prefix; menu titles are plain `Sub-Agents ...` (no 007
theming).

Menu standards (design section 7): grouping Action -> Manage ->
Configure -> Help, verb-led labels, Enabled/Disabled toggle
vocabulary, live counts in parens, destructive actions confirm, Esc
backs out.

## Surface

- `openSubAgentMainMenu(ctx, deps)` — routes on `enabled`.
- Disabled state (the default): title `Sub-Agents [Disabled]`,
  option 1 **Enable sub-agents**. The enable confirm ONLY appears when
  the live data dir is missing: "Unable to detect local sub agents
  data directory. Shall I create and seed?" (Yes/No) — an existing
  folder enables silently (the seed is idempotent copy-only). Then
  `seedSubAgentBuiltIns()` -> `enabled: true`. **A seed failure ABORTS
  the enable** with `aftcConsole.error` — a half-seeded agents folder
  never silently enables the feature. Plus Read the guide + Help
  viewers.
- Enabled state: title `Sub-Agents [Enabled]` — Active work row
  (hidden when idle), Browse agents (`openAgentsMenu`), Open agents
  folder, Update shipped agents (only on seed mismatch), Settings,
  Read the guide, Disable sub-agents (confirm; offers let-finish /
  kill-now when runs are active), Help.
- Agents browser: `openAgentsMenu` lists discovered profiles with a
  source dot; `openAgentDetail` offers View profile, Edit
  (`editAgentFile` — built-ins are synced to a live copy first via
  `syncAgentFromSeed`), Disable (`setAgentEnabled` — flips the
  `enabled:` frontmatter flag), Delete (user/project files), Reset to
  default (non-project).
- `/007-edit` flow: `openAgentEditMenu` — agent picker when no name is
  given (includes disabled agents, marked `(disabled)`, so they can be
  re-enabled from inside pi), then `openAgentOptionsMenu`: On/Off toggles for the boolean
  frontmatter flags (codex, codex_write, stall_detection,
  loop_detection, output_transcript, persist_session, enabled; written
  by `setAgentFrontmatterFlag`, displayed via each profile's effective
  value), plus Edit the raw file (`editAgentFile`) and Reset to default
  (confirm; re-copies the shipped built-in). Built-ins are synced to a
  live copy first (`syncAgentFromSeed` — the seed is never written).
- Settings menu: `Sub-Agents — Settings` — feature toggle, capacity
  preset, numeric caps (via `showIntInput`), watchdog toggles, footer
  line, output transcript.
- Status table (`buildSubAgentStatusLines` / `openStatusViewer`):
  header columns `ID  AGENT  STATE  ELAPSED  CTX%  TOKENS  TOOLS`.
- Kill menu: `Sub-Agents — Kill runs` — multi-select + kill all, each
  goes through the full termination ladder.
- Guide viewer (`showGuide`), agents-folder opener
  (`openAgentsFolder`), `runSync`, and `openDoctor`
  (`Sub-Agents — Doctor`).

`SubAgentUiDeps.getSnapshot` comes from the supervisor (wired through
subagents.ts — no cross-feature imports).

# index.ts

The default-exported extension entry. The orchestrator.

## Responsibilities

- Imports every feature module's `create*` factory.
- Instantiates them in the right order.
- Wires `core.ts`'s `FooterDataProvider` into `footer-widget.ts` so the
  widget can read cache/timing data without importing core, and passes
  the sub-agents footer line callback (`subAgentLine(colors)` —
  always visible while the feature is enabled, hidden only when it is
  disabled or `footerLineEnabled` is off; the widget passes its
  c1/c2/c3 color helpers and gets an already-themed line) as a footer
  extra so the widget stays subagent-agnostic.
- Passes the `AllowanceProvider` into `createSubAgents` (the allowance
  gate is the sub-agent spending guard).
- Returns void - pi calls this function once on startup.

## Why it exists

AGENTS.md - feature modules do not import each other. The
orchestrator is the single place that knows about every module and
how they fit together. Adding a new feature = add a new file, then
add one `createXxx(pi)` line here.

# footer-widget.ts

The cache diagnostics bar (four lines plus a conditional fifth)
rendered as a `setWidget` below the editor. Owns the render path, the
1Hz ticker, and the `/aftc-footer` toggle.

## What it does

Renders a 4-line bar showing:
- **Line 1**: model name, thinking level, context window size, last-turn
  cache hit %, session average cache hit %, trend arrow, last-turn
  cache split (cached / new), session token totals (`Tk ↑XX Tk ↓YY`).
  Token totals come straight from pi's per-assistant-message `usage`
  (input / cacheRead / output / totalTokens), so they are token-accurate
  — not byte counts. Layout:
  `model · THINKING │ CTX Window │ Turn Cache X% / Avg Y% │ Cached A / New B │ Tk ↑P Tk ↓Q`
  The line never ends with a trailing `│` — the final segment is the
  value, never a divider.
- **Line 2**: last-turn cost, **Task Time** (wall-clock from the user
  pressing enter to the agent returning control — one user prompt's
  full run across all its turns; ticks live while the agent works, then
  holds the last task's duration (formatted like Session Time).
  An error/abort stops the timer and shows the time to that point, but
  is NOT recorded — a failed duration isn't a useful metric, so only
  completed tasks are written to the DB. Runs through questions,
  steering, retries and compaction, since none of those settle the
  agent), context-session total cost (sum
  of all turn costs in this context), **user-prompted turns vs
  AI-initiated turns** (a single user prompt with no tool calls shows
  `User 1 / AI 0`; the AI counter only increments on tool-call
  continuations), context-window time, $/hr and $/min burn rates.
- **Line 3**: active tool count + token estimate, skills
  `used/available` (skills pulled into context this session via a
  `/skill:name` command or a successful `read` of a skill file, vs
  the count in the system prompt's `<available_skills>` block),
  thinking time (last / avg), response time (last / avg).
- **Line 4** (hideable via the menu): aggregates from the SQLite
  `turns` and `tasks` tables over a configurable time window
  (default: 3 Days), prefixed by the window name — `3 Hour Averages:
  cost $X.XX | Prompts: User N / AI M | Avg Cache X% | Avg Task Time
  Xh Ym Zs`. Prefixes: 1-72 Hour (rolling windows), Today, 2/3/5/7
  Day, This Month, 3/6 Month, This Year (calendar-anchored windows).
  Prompts are SUMS over the window (AI = total turns minus
  user-prompted turns), cost is money-formatted per
  `docs/usage-report-rules.md`, and Avg Task Time averages COMPLETED
  tasks only (`stop_reason = 'complete'`, same rule as the usage
  report) with the report's duration format. The window is set in the
  `/aftc-footer` menu -> "Set averages timeframe" (10 rolling "Last"
  options + 9 date-based options: 1 Day, 2/3/5/7 Days, Month,
  3/6 Months, 1 Year) and persists across `/resume` and `/reload`.
  Refreshed at most every 10s by core.ts so the DB isn't hammered on
  every render tick.
- **Line 5** (conditional): subscription allowance — 5-hour and weekly
  used % with live reset countdowns for supported providers
  (ChatGPT/Codex OAuth, MiniMax, Z.ai GLM, Kimi for Coding, Anthropic
  OAuth via response headers). Hidden for all other providers, and
  whenever the usage endpoint fails or returns unexpected data. Data
  comes from `allowance.ts` via `data.getAllowance()`; see
  `allowance-readme.md`.

The widget uses `setWidget` (not `setFooter`) so it composes with
other footer/status extensions instead of replacing them. The
widget API does not pass pi's `footerData` slot, so the Git branch
segment is intentionally omitted.

## How it stays current

A 1Hz `setInterval` inside the component:
1. Calls `data.onTick()` (which is the combined ticker from core.ts:
   `recomputeCachedSession()` + `refreshTimeframeStats()` - the
   timeframe stats refresh is throttled to every 10s).
2. Calls `tui.requestRender()` to force a TUI re-render.

The ticker is wrapped in try/catch - a single error logs but does
not kill the timer or spam the log.

## Render structure

`render()` delegates to one builder per line — `buildModelLine`,
`buildCostLine`, `buildTimingLine`, `buildAveragesLine` — plus
`buildAllowanceLine` for the conditional line 5. Each builder computes
its values with plain if statements and assembles small named
fragments into a parts array joined with single spaces, so segments
can be moved, recoloured (swap the `c1`/`c2`/`c3` wrapper), or
re-ordered by editing one array. `coloredToken()` keeps token digits
(c1) and unit suffixes (c2) coloured independently.

## Component lifecycle

The widget factory is registered once via `setWidget`. Each time pi
needs to render the widget, it calls the factory, which:
1. Disposes the previous component (stops its 1Hz ticker).
2. Creates a new component with a fresh ticker.

The active component is tracked at module scope so `/aftc-footer`
(hide) and `session_shutdown` can call `dispose()` and stop the
ticker cleanly. Without this, recreating the widget (theme change,
`/reload`, etc.) leaks 1Hz timers - one per recreation.

## Events subscribed

- `session_start` - call `show(ctx)` if the widget was active when
  the previous session ended. The active/inactive state is loaded
  from `state.json` (a user preference) so it survives `/reload`,
  `/new`, and fresh pi startup.
- `session_shutdown` - dispose the active component.

## Public factory

```typescript
export function createFooterWidget(
    pi: ExtensionAPI,
    data: FooterDataProvider
): void
```

Wires the widget into pi and registers the `/aftc-footer` command.
The orchestrator passes `data` (a `FooterDataProvider` returned by
`createCore`) so the widget never imports core directly.

## Commands registered (1)

- `/aftc-footer` - open the footer dashboard menu (settings-screen
  style: stable label + value column, selection preserved across
  toggles, Esc closes):
  - **Enable footer** — ` | ON`/`OFF`, Enter toggles. Disposes the
    active component on hide so its 1Hz ticker stops.
  - **Show recorded averages** — ` | ON`/`OFF`, Enter toggles line 4
    visibility (`footerAveragesEnabled` preference, default ON).
  - **Set averages timeframe** — the current window's label is shown
    in the value column; Enter opens the timeframe picker (rolling
    "Last" options first, then date-based; effective row marked
    `(current)` and pre-selected; Esc returns to the menu).
  Headless (`!ctx.hasUI`) prints the current settings to stdout.

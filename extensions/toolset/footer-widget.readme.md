# footer-widget.ts

The four-line cache diagnostics bar rendered as a `setWidget` below
the editor. Owns the render path, the 1Hz ticker, and the
`/aftc-footer` toggle.

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
- **Line 2**: last-turn cost, context-session total cost (sum of all
  turn costs in this context), **user-prompted turns vs AI-initiated
  turns** (a single user prompt with no tool calls shows
  `User 1 / AI 0`; the AI counter only increments on tool-call
  continuations), context-window time, $/hr and $/min burn rates.
- **Line 3**: active tool count + token estimate, skills
  `used/available` (skills pulled into context this session via a
  `/skill:name` command or a successful `read` of a skill file, vs
  the count in the system prompt's `<available_skills>` block),
  thinking time (last / avg), response time (last / avg).
- **Line 4**: aggregates from the SQLite `turns` table over a
  configurable time window (default: Last 3 Days).
  Shows cost, prompts/turns, **average** cache hit rate over the
  window, average thinking time, average response time. The window
  is set by `/aftc-set-costs-timeframe` (Today, Last 3 Hours,
  Last 6 Hours, Last 24 Hours, Last 2 Days, Last 3 Days, Last 7 Days,
  Last 28 Days) and persists across `/resume` and `/reload`. The
  legacy alias `/aftc-footer-report-timeframe` still works.
  Refreshed at most every 10s by core.ts so the DB isn't hammered
  on every render tick.

The widget uses `setWidget` (not `setFooter`) so it composes with
other footer/status extensions instead of replacing them. The
widget API does not pass pi's `footerData` slot, so the Git branch
segment is intentionally omitted (see rules.md §10).

## How it stays current

A 1Hz `setInterval` inside the component:
1. Calls `data.onTick()` (which is the combined ticker from core.ts:
   `recomputeCachedSession()` + `refreshTimeframeStats()` - the
   timeframe stats refresh is throttled to every 10s).
2. Calls `tui.requestRender()` to force a TUI re-render.

The ticker is wrapped in try/catch - a single error logs but does
not kill the timer or spam the log.

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

- `/aftc-footer` - toggle the widget on/off. Disposes the active
  component on hide so its 1Hz ticker stops.

# Footer Widget — Technical Documentation

A 4-5 line diagnostic panel rendered via `setWidget` (below the editor).
Composes alongside other footer/status extensions (does NOT replace pi's footer).
Updates live from pi events and a 1Hz session sampler.

---

## What each line shows

### Line 1 — Current state
```
model · THINKING │ CTX Window (X%) │ Turn Cache X% / Avg Y% │ Cached A / New B │ Tk ↑P Tk ↓Q
```
- Model name + thinking level
- Context window size + how full it is (%)
- Last-turn cache hit % / session average %
- Session cache split (cached tokens / new tokens)
- Session token totals (input ↑ / output ↓) — from pi's `usage`, token-accurate

### Line 2 — Money and prompts
```
Prompts: User N / AI M │ Turn cost │ Task Time │ Session Time │ Session Cost │ $/hr │ $/min
```
- User prompts vs AI-initiated turns (tool-call continuations)
- Last turn cost
- **Task Time:** wall-clock from user pressing enter to agent returning control.
  Ticks live while agent works, holds last duration after. Error/abort shows
  time-to-failure but is NOT recorded. Runs through questions, steering, retries,
  compaction (none of those settle the agent).
- Session time + session cost
- Burn rates ($/hr, $/min)

### Line 3 — Speed and tools
```
Turn Time L / Avg A │ Turn Response Time L / Avg A │ N Tools ~X.XKt │ Skills used/avail
```
- Turn time (last / average)
- Response time (last / average)
- Active tool count + estimated token cost
- Skills loaded this session / total available (only shown if >= 1 loaded)

### Line 4 — Long-term averages (from SQLite)
```
<Window> Averages: cost $X.XX | Prompts: User X / AI Y | Avg Cache X% | Avg Task Time X
```
- Prefix names the window: "Today Averages:", "3 Hour Averages:",
  "24 Hour Averages:", "2 Day Averages:", "28 Day Averages:", etc.
- `cost` — total spend in the window (money formatted per
  `docs/usage-report-rules.md`: $0.00 / 4dp below $1 / 2dp / whole
  numbers with thousands separators at $1,000+)
- `Prompts: User / AI` — SUMS over the window, not averages; AI =
  total turns minus user-prompted turns
- `Avg Cache` — average per-turn cache hit rate over the window
- `Avg Task Time` — average wall-clock of COMPLETED tasks only
  (`stop_reason = 'complete'`, same rule as the usage report's
  Task Time); duration formatted per the report rule
  (`0s` / `1m 30s` / `2h 5m 3s`)
- Aggregates from `turns.db` (`turns` + `tasks` tables) over a
  configurable window (default: 3 Days)
- Window set in the `/aftc-footer` menu -> "Set averages timeframe"
  (persists across resume/reload)
- Line hidden entirely when "Show recorded averages" is OFF in the
  same menu
- Refreshed at most every 10s (DB not hammered on every tick)

#### Timeframe windows

19 options, two families:

- **Rolling** ("Last" options) — the window slides with the clock:
  `timestamp >= now - N hours`.
  Last 1 hour, Last 2 hours, Last 3 hours, Last 4 hours, Last 5 hours,
  Last 6 hours, Last 12 hours, Last 24 hours, Last 48 hours,
  Last 72 hours.
- **Date-based** — anchored to LOCAL calendar boundaries, NOT rolling:
  - 1 Day = since today's midnight
  - 2 / 3 / 5 / 7 Days = since the midnight that opened the Nth
    calendar day counting today (7 Days = today + previous 6 days)
  - Month / 3 Months / 6 Months = since the 1st of the current month /
    2 / 5 months back
  - 1 Year = since January 1st of the current year

Legacy preference keys migrate on load (`today` -> `1d`, `28d` ->
`month`, ...); unknown values fall back to the default (`3d`).

### Line 5 — Subscription quota (conditional)
```
5h Allowance used: X% Resets in: ... │ Weekly Allowance used: Y% Resets in: ...
```
- Only for providers with usage endpoints (ChatGPT/Codex OAuth, MiniMax, Z.ai,
  Kimi for Coding, Anthropic OAuth)
- Hidden for all other providers or when the endpoint fails
- Data from `allowance.ts`

---

## How it stays current

A 1Hz `setInterval` inside the component:
1. Calls `data.onTick()` (recompute cached session + refresh timeframe stats;
   timeframe refresh throttled to every 10s).
2. Calls `tui.requestRender()` to force a TUI re-render.

The ticker is wrapped in try/catch — a single error logs but does not kill the
timer or spam the log.

---

## Render structure

`render()` delegates to one builder per line:
- `buildModelLine` (line 1)
- `buildCostLine` (line 2)
- `buildTimingLine` (line 3)
- `buildAveragesLine` (line 4)
- `buildAllowanceLine` (line 5, conditional)

Each builder assembles small named fragments into a parts array joined with
spaces. Segments can be moved/recoloured/reordered by editing one array.
`coloredToken()` keeps digits (c1) and unit suffixes (c2) coloured independently.

---

## Component lifecycle

The widget factory is registered once via `setWidget`. Each time pi renders:
1. Disposes the previous component (stops its 1Hz ticker).
2. Creates a new component with a fresh ticker.

The active component is tracked at module scope so `/aftc-footer` (hide) and
`session_shutdown` can call `dispose()` and stop the ticker. Without this,
recreating the widget (theme change, `/reload`) leaks 1Hz timers.

---

## Events subscribed

| Event | Purpose |
| --- | --- |
| `session_start` | Show widget if it was active (state from config) |
| `session_shutdown` | Dispose active component (stop ticker) |

---

## Public factory

```typescript
export function createFooterWidget(pi: ExtensionAPI, data: FooterDataProvider): void
```

The orchestrator passes `data` (a `FooterDataProvider` from `createCore`) so the
widget never imports core directly.

---

## Commands

| Command | Action |
| --- | --- |
| `/aftc-footer` | Footer dashboard menu: **Enable footer** (ON/OFF toggle, disposes component on hide), **Show recorded averages** (ON/OFF toggle for line 4), **Set averages timeframe** (current window shown right; opens the timeframe picker submenu) |

The timeframe picker lists the rolling "Last" options first, then the
date-based ones, marks the effective row `(current)` and pre-selects
it. Esc in the picker returns to the menu; Esc in the menu closes it.
The old `/aftc-footer` toggle behaviour, `/aftc-set-costs-timeframe`
and the legacy `/aftc-footer-report-timeframe` alias were removed and
replaced by this menu.

---

## Key files

| File | Purpose |
| --- | --- |
| `footer-widget.ts` | Widget component + render + lifecycle |
| `core.ts` | Data provider: session stats, timeframe aggregates, `onTick()` |
| `allowance.ts` | Subscription quota fetching for supported providers |
| `usage-recording.ts` | Records turns/tasks to SQLite |

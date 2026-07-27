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
Cost <window>: $X.XX │ Prompts: User X / AI Y │ Cache X% │ Think time X │ Response time X
```
- Aggregates from `turns.db` over a configurable window (default: Last 3 Days)
- Window set by `/aftc-set-costs-timeframe` (persists across resume/reload)
- Refreshed at most every 10s (DB not hammered on every tick)

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
| `/aftc-footer` | Toggle widget on/off (disposes component on hide) |
| `/aftc-set-costs-timeframe` | Set the Line 4 averaging window |

---

## Key files

| File | Purpose |
| --- | --- |
| `footer-widget.ts` | Widget component + render + lifecycle |
| `core.ts` | Data provider: session stats, timeframe aggregates, `onTick()` |
| `allowance.ts` | Subscription quota fetching for supported providers |
| `usage-recording.ts` | Records turns/tasks to SQLite |

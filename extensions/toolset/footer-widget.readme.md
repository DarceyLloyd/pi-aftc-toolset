# footer-widget.ts

The three-line cache diagnostics bar rendered as a `setWidget` below
the editor. Owns the render path, the 1Hz ticker, and the
`/aftc-footer` toggle.

## What it does

Renders a 3-line bar showing:
- **Line 1**: model, thinking level, last-turn cache hit %, session
  average cache hit %, trend arrow, context window size.
- **Line 2**: input/output token totals, last-turn cache split
  (cached / new), session cost, total turns vs user-prompted turns,
  context-window time, $/hr and $/min burn rates.
- **Line 3**: active tool count + token estimate, skill/memory tool
  cost, thinking time (last / avg), response time (last / avg).

The widget uses `setWidget` (not `setFooter`) so it composes with
other footer/status extensions instead of replacing them. The
widget API does not pass pi's `footerData` slot, so the Git branch
segment is intentionally omitted (see rules.md §10).

## How it stays current

A 1Hz `setInterval` inside the component:
1. Calls `data.onTick()` (which is `recomputeCachedSession` from
   core.ts - re-reads `data.json` and updates the in-memory
   `cachedSession`).
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
  the previous session ended.
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

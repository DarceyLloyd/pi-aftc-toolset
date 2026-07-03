# core.ts

The data module. Owns every accumulator, tracker, and timer the
extension reads, and returns a `FooterDataProvider` so other modules
can read them without importing this file.

## What it owns (closure state)

- `acc: CacheAccumulator` — running totals (cacheRead, cacheWrite,
  input, output, cost, turns, userTurns, last-turn snapshots).
- `recentHits: number[]` — last N turn hit rates for the trend arrow.
- `shape: ShapeTracker` — system-prompt + tool-schema hash + churn
  detection (system / tools / unknown).
- `model: ModelInfo` — captured from `session_start` and
  `model_select` event contexts (rules.md §10 — `ctx.model` is
  undefined on early renders).
- `toolCache: ToolCostCache` — per-tool token cost estimate, sorted,
  signature-invalidated so it only recomputes when the active tool
  set actually changes.
- `cachedSession: CachedSession | null` — 1Hz-ticker-driven view of
  the current context-window time + cost rate.
- `_sessionStartTime: number | null` — wall-clock at the first
  user prompt of the current session. Set in `message_start` for
  user, cleared in `resetTiming`. In-memory only; no file I/O.
- `thinkingTimes` / `responseTimes` — last N per-turn durations.

## Events subscribed

- `session_start` — reset state, capture model + thinking level,
  refresh tool cache.
- `model_select` — capture new model (don't reset accumulators).
- `thinking_level_select` — capture new level.
- `before_agent_start` — capture system prompt (for churn hash),
  refresh tool cache.
- `input` — track streaming behavior (steer / followUp).
- `message_start` — track user prompt classification (base /
  continuation / steering / followup); on first user message set
  the in-memory `_sessionStartTime`.
- `message_update` — capture time of first non-thinking output
  (end of "thinking", start of "response").
- `message_end` — update accumulators, record to SQLite via the
  `TurnRecorder` passed in by the orchestrator, run prefix-shape
  churn detection.
- `agent_end` — in headless mode only, log per-turn stats to stdout.
- `session_compact` — reset the prefix-shape tracker.

## Public factory

```typescript
export function createCore(
    pi: ExtensionAPI,
    turnRecorder: TurnRecorder
): FooterDataProvider
```

Returns a `FooterDataProvider` (see `types.ts`) — the orchestrator
hands this to `footer-widget.ts` so the widget can read all the
above state via cheap getters on every render.

## Commands registered (4)

- `/cache-profile` — per-tool token costs, prefix shape, churn
  analysis. Output to `ctx.ui.select`.
- `/cache-stats` — current-context cache diagnostics, cost rate,
  cache-write ROI, prefix hashes.
- `/cache-reset` — zero in-memory accumulators and the in-memory
  context-window clock. Useful for benchmarking.
- `/cls` — clear the terminal screen.

## Files persisted

This module writes no files of its own. Per-session state
(accumulator, model info, context-window clock) lives in closure
variables. Historical per-turn data is recorded into SQLite by
`usage-recording.ts`; the usage report reads it back in
`usage-report.ts`.

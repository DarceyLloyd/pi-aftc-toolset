# core.ts

The data module. Owns every accumulator, tracker, and timer the
extension reads, and returns a `FooterDataProvider` so other modules
can read them without importing this file.

## What it owns (closure state)

- `acc: CacheAccumulator` - running totals (cacheRead, cacheWrite,
  input, output, cost, turns, userTurns, last-turn snapshots).
- `recentHits: number[]` - last N turn hit rates for the trend arrow.
- `shape: ShapeTracker` - system-prompt + tool-schema hash + churn
  detection (system / tools / unknown).
- `model: ModelInfo` - captured from `session_start` and
  `model_select` event contexts (rules.md §10 - `ctx.model` is
  undefined on early renders).
- `toolCache: ToolCostCache` - per-tool token cost estimate, sorted,
  signature-invalidated so it only recomputes when the active tool
  set actually changes.
- `cachedSession: CachedSession | null` - 1Hz-ticker-driven view of
  the current context-window time + cost rate.
- `availableSkills` - the `Skill[]` loaded into the system prompt
  (captured each turn from `before_agent_start.systemPromptOptions.skills`).
  Used to detect skill *usage* (see `usedSkills`).
- `usedSkills: Set<string>` - per-session set of skill names actually
  pulled into context: a `/skill:name` user command or a successful
  `read` of a skill's SKILL.md / a file under its baseDir. Exposed to
  the footer as `getUsedSkillCount()`. Reset on `session_start`.
- `_sessionStartTime: number | null` - wall-clock at the first
  user prompt of the current session. Set in `message_start` for
  user, cleared in `resetTiming`. In-memory only; no file I/O.
- `thinkingTimes` / `responseTimes` - last N per-turn durations.

## Events subscribed

- `session_start` - reset accumulators + timing, load user
  preferences (footer timeframe), capture model + thinking level,
  refresh tool cache. Always starts fresh — there is no per-session
  resumption state anymore.
- `model_select` - capture new model (don't reset accumulators).
- `thinking_level_select` - capture new level.
- `before_agent_start` - capture system prompt (for churn hash),
  refresh the tool cache against the **active** tool set, and capture
  the loaded `Skill[]` from `systemPromptOptions.skills` (feeds the
  footer's "Skills available" count + the skill-usage detector).
- `input` - track streaming behavior (steer / followUp); also detect
  `/skill:name` user commands (input fires before skill expansion, so
  the raw text is visible) and mark those skills as used this session.
- `tool_result` - for `read` tools that did not error, if the resolved
  path is a skill's `filePath` or under its `baseDir`, mark that skill
  as used (its body was loaded into context).
- `message_start` - track user prompt classification (base /
  continuation / steering / followup); on first user message set
  the in-memory `_sessionStartTime`.
- `message_update` - capture time of first non-thinking output
  (end of "thinking", start of "response").
- `message_end` - update accumulators, record to SQLite via the
  `TurnRecorder` passed in by the orchestrator, run prefix-shape
  churn detection.
- `agent_end` - in headless mode only, log per-turn stats to stdout.
- `session_compact` - reset the prefix-shape tracker.

## Public factory

```typescript
export function createCore(
    pi: ExtensionAPI,
    turnRecorder: TurnRecorder
): FooterDataProvider
```

Returns a `FooterDataProvider` (see `types.ts`) - the orchestrator
hands this to `footer-widget.ts` so the widget can read all the
above state via cheap getters on every render.

## Commands registered (5)

- `/cache-profile` - per-tool token costs, prefix shape, churn
  analysis. Output to `ctx.ui.select`.
- `/cache-stats` - current-context cache diagnostics, cost rate,
  cache-write ROI, prefix hashes.
- `/cache-reset` - zero in-memory accumulators and the in-memory
  context-window clock. Useful for benchmarking.
- `/aftc-footer-report-timeframe` - set the footer 4th-line time
  window: Today, 3h, 6h, 24h, 2d, 3d, 7d, 28d (default: Today).
  Persisted to `state.json` as a user preference (survives /new,
  /reload, and fresh pi startup).
- `/cls` - clear the terminal screen.

## Files persisted

This module writes no files of its own. Per-session state
(accumulator, model info, context-window clock) lives in closure
variables. Historical per-turn data is recorded into SQLite by
`usage-recording.ts`; the usage report reads it back in
`usage-report.ts`.

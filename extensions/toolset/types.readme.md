# types.ts

Shared structural interfaces. The type-level contract that lets
feature modules communicate through the orchestrator (rules.md
§1.5) without importing each other.

## What's in here

### Turn recording (core.ts → usage-recording.ts)

```typescript
interface TurnRecord {
    turn: number;             // session-scoped counter
    timestamp: number;        // ms since epoch
    modelName: string;
    thinkingLevel: string;    // "high" | "low" | "off" | etc.
    thinkingMs: number;       // time to first non-thinking output
    responseMs: number;       // total turn duration
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheRead: number;
    cacheWrite: number;
    isUserPrompt: boolean;    // vs automated tool-call continuation
    sessionId: string;        // stable-ish per runtime session
    promptIndex: number;      // 1-based user-prompt number
    isBasePrompt: boolean;    // top-level task-starting prompt
    isSubPrompt: boolean;     // any follow-up / refinement
    isSteeringPrompt: boolean;
    isFollowupPrompt: boolean;
    isContinuationPrompt: boolean;
    promptKind: string;       // "base" | "steer" | "followup" | "continuation" | "auto"
}

interface TurnRecorder {
    recordTurn(record: TurnRecord): void;
}
```

`usage-recording.ts` implements `TurnRecorder` structurally - as long
as the method signature matches, `core.ts` doesn't need to import
the concrete class.

### Footer widget data (core.ts → footer-widget.ts)

The widget reads data via a `FooterDataProvider` interface, never
importing core.ts. The view types are the minimal fields the
widget actually reads:

- `AccumulatorView` - snapshot of the cache accumulator (no
  methods, just fields).
- `ModelView` - model name + reasoning + context window + thinking
  level.
- `ToolCacheView` - `getCount()`, `getTotal()`, `getSkillCount()`,
  `getSkillToks()`. Count/total reflect the **active** tool set
  (intersected with `pi.getActiveTools()`); `getSkillCount()` /
  `getSkillToks()` are the **available** skills loaded into the
  system prompt, fed from `systemPromptOptions.skills`.
- `SessionView` - current context-window clock + cost rates
  (recomputed on each read so the displayed time stays fresh).
- `TimeframeStatsView` - aggregates over the active timeframe
  (Today / 3h / … / 28d) from the SQLite `turns` table: cost,
  prompts/turns, average cache hit rate, average thinking +
  response times. Drives footer line 4.

The full interface:

```typescript
interface FooterDataProvider {
    getAccumulator(): AccumulatorView;
    getRecentAvg(): number;
    getModel(): ModelView;
    getToolCache(): ToolCacheView;
    getCachedSession(): SessionView | null;
    getUsedSkillCount(): number;   // skills pulled into context this session
    getLastThinkingMs(): number;
    getAvgThinkingMs(): number;
    getLastResponseMs(): number;
    getAvgResponseMs(): number;
    getTimeframeStats(): TimeframeStatsView;  // footer line 4 (10s-throttled)
    onTick(): void;   // 1Hz ticker callback
}
```

## Why structural typing, not abstract classes

JS / TS structural typing means `core.ts` can return a plain
object literal that satisfies the interface - no need for abstract
classes, no `implements` keyword, no inheritance. Both modules
remain independent.

## Why here, not in core.ts

`types.ts` is the **neutral** ground. Neither core.ts nor
footer-widget.ts nor usage-recording.ts owns these types. They
live in a file that no feature module imports directly as a runtime
dependency - features import types only.

## Adding a new type

1. Add the interface to `types.ts`.
2. Have one feature module implement it (as a method on a returned
   object or a class method).
3. Have another feature module consume it (via the orchestrator).
4. Both files import the interface from `./types` - they don't
   import each other.

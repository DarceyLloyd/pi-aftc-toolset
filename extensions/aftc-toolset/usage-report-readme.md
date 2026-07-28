# usage-report.ts

Reads the per-turn SQLite database and writes a self-contained HTML
report. Owns the report commands.

## What it does

`/usage-report` produces a single HTML file at
`<persistent-data-dir>/report.html` (OS-specific; see `paths-readme.md`). The HTML is one
self-contained file - embedded CSS, embedded JSON, embedded JS. The
only external reference is the Chart.js CDN (pinned `chart.js@4.4.7`,
jsdelivr) used for the graphs; when offline the page degrades
gracefully to text fallbacks and every table/card still works.

The report is a dark-themed, tabbed page with an AFTC-branded header
(page title, an "All For The Code" strapline, and an orange
`Generated on: YYMMDD - HH:MM` line) and five tabs:

### Tab 1 - Overview
- Six headline stat cards: total cost, user prompts (tasks +
  follow-ups), AI prompts (self-prompting turns), avg cost per user
  prompt, avg cache hit, active days. Prompt terminology mirrors the
  footer widget: **User** = typed prompts, **AI** = self-prompted
  turns (tool-call continuations).
- **Daily spend** bar chart (last 30 local days, zero-filled; today is
  highlighted orange; tooltips show cost / calls / prompts).
- **Cost share by model** doughnut (all time, top 7 + Other, total in
  the centre).
- **Period summary** - three compact cards (last 24 h / 7 d / 28 d):
  cost, `Prompts: User N / AI M`, then a **per-model scoreboard**.
  All 11 rows are ALWAYS shown - a row whose metric is uncomputable
  for the window renders `N/A` with an info-icon tooltip giving the
  reason (nothing silently disappears). The COST rows (cheapest /
  most costly) only consider models that cost something in the
  window - a cost average over $0 (subscription) models is
  meaningless, so a subscription-only period shows N/A there with a
  tooltip explaining that providers often don't report a per-turn
  price. The usage / cache / timing rows consider ALL models - those
  metrics exist for subscription models too. Rows, in order:
  cheapest model, most costly model, most used model (by user-prompt
  count), least used model (N/A when fewer than two models have
  prompts), **Avg Task Time** (mean wall-clock prompt→settle duration
  over the window's completed tasks, from the `tasks` table; the
  value column carries the task count), best/worst cache hit (by avg
  hit rate %), best/worst response time, best/worst think time. Time
  values use `Xh Ym Zs` format (no padding, omit zero units).
  units). No colour coding on scoreboard rows — polarity lives in the
  words only. The old "Top model" total-cost line is gone; the pie
  chart legend carries the share % instead.

### Tab 2 - Models
Sortable, horizontally responsive table with a period selector
(Last 24 hours / 7 days / 28 days / All time, default All time) and a
cost-by-model horizontal bar chart that follows the selected period.
Columns: model, cost (bar), user prompts, AI prompts, AI/user,
Avg $/Pup (avg cost per user prompt), Avg cache, avg response time,
**Task time** (avg completed-task duration for that model). Non-obvious
columns (AI/user, Avg $/Pup, Avg cache, Task time) carry an info icon
that floats an on-theme tooltip explaining the metric on hover. The
Task Time tooltip carries the root-README definition: one prompt's
complete run across all its tool-call turns, enter → agent settled.

### Tab 3 - Thinking levels
Same table shape keyed by model + thinking level (one row per
combination), with avg think time and a trailing **Task time** column
(avg completed-task duration for that model × level), and the same
info tooltips.

### Paid-only cost averages
Free / $0 (subscription) turns are recorded (see
`RECORD_ZERO_COST_TURNS` in `usage-recording.ts`) and count toward
prompt, cache and timing figures, but every COST average
denominator is paid-only (`CASE WHEN cost_usd > 0`), per model and
in the lifetime totals, so free models never drag averages down. A
note under the Overview cards states this basis.

### Tab 4 - Timings
Task Time analysis, built on the per-task `tasks` table (see
`usage-recording-readme.md`) plus the per-turn timing columns. Has the
same period selector as Models / Thinking (default All time):
- Four stat cards: **Avg Task Time** (completed tasks only, over N
  completed tasks), **Longest task** (duration + model), **Avg turns /
  task**, and **Errors & aborts** (failed tasks are recorded with
  `stop_reason` error/aborted and counted here, but their durations
  are NEVER averaged into Task Time).
- **Avg Task Time by model** horizontal bar chart (top 8, tooltips
  show the avg + task count) and a **daily Avg Task Time** bar chart
  (last 30 local days, zero-filled, today orange, task-less days dim).
- **Where the task time goes** - a stacked bar splitting the window's
  total completed-task time into Thinking / Responding (summed per-turn
  figures) / Tools & overhead (the remainder - tool execution, waits,
  retries, compaction).
- **User-prompt vs AI turns** - per-turn kind: turn count, avg think,
  avg respond, avg total.
- **Longest tasks** - sortable top-10 completed tasks in the window:
  when, model, thinking level, turns, task time.
- A basis note defines Task Time (wall-clock enter → settle, spanning
  questions / steering / retries / compaction) and states that failed
  runs are counted but never averaged.

### Tab 5 - Projections
- Three burn-rate cards: avg cost/day, projected /month (x30.44),
  projected /year (x365). Basis: all-time spend / **calendar days**
  since the first recorded turn (idle days included). Flagged as an
  estimate below 14 calendar days.
- Per model x thinking table: active days, prompts (User / AI), total
  cost, $/day, $/week, $/month, $/year. Basis: spend / **active days**
  (distinct calendar days with at least one turn). Rows with fewer
  than 7 active days are marked `~` (estimate, tooltip explains why).
  Model × thinking rows with ZERO total cost are excluded entirely -
  a $0 model has nothing to project.
## Reading the SQLite DB

The DB lives at `<persistent-data-dir>/turns.db` (OS-specific; see `paths-readme.md`)
(populated by `usage-recording.ts`). The report query is read-only
via `better-sqlite3`. If better-sqlite3 isn't installed, the commands
report an error and the HTML report cannot be generated.

## Commands registered (2)

- `/usage-report` - generates + writes the HTML report, opens it
  in the user's default browser (fire-and-forget; non-UI fallback
  logs the path to stdout).
- `/usage-clear` - permanently deletes all rows from BOTH the `turns`
  and `tasks` tables (one transaction) after user confirmation. Useful
  for resetting the dataset - the Timings tab would otherwise survive
  a turns-only clear.

## Data shape (embedded JSON)

```text
{
  generatedAt: number,
  totals: { totalCost, turnCount, userPromptCount, basePromptCount,
            subPromptCount, automatedTurnCount, paidTurnCount,
            paidUserPromptCount, totalInputTokens,
            totalOutputTokens, totalCacheRead, avgCacheRate,
            avgCostPerTurn, avgCostPerUserPrompt, turnsPerUserPrompt,
            activeDays, calendarDays, avgDailySpend, firstTurnMs },
  periods: {                       // compact 3-card summaries
    daily:   { label, cost, calls, prompts, aiPrompts,
               scoreboard: [ { label, model, value } ] },
    weekly:  { ... },
    monthly: { ... },
  },
  dailySeries: [ { day, label, cost, calls, prompts } ],  // 30 days, zero-filled
  modelsByPeriod: { daily: [], weekly: [], monthly: [], all: [] },
      // ModelRow: modelName, cost, turns, userPrompts, aiPrompts,
      // aiPerUserPrompt, avgCostPerUserPrompt, avgCacheRate,
      // avgThinkingMs, avgResponseMs, avgTaskMs
  modelThinkingByPeriod: { daily: [], weekly: [], monthly: [], all: [] },
  timings: {                        // Timings tab, per period window
    daily: { taskCount, completed, errors, aborted, avgTaskMs,
             maxTaskMs, maxTaskModel, avgTurnsPerTask, totalTaskMs,
             userTurns, userAvgThinkMs, userAvgRespMs, aiTurns,
             aiAvgThinkMs, aiAvgRespMs, totalThinkMs, totalRespMs,
             taskByModel: [ { modelName, avgTaskMs, tasks } ],
             longest: [ { timestamp, modelName, thinkingLevel,
                          turnCount, taskMs } ] },   // top 10, desc
    weekly: {...}, monthly: {...}, all: {...} },
  taskDailySeries: [ { day, label, avgTaskMs, tasks } ], // 30 days
  projections: {
    avgDailySpend, projectedWeek, projectedMonth, projectedYear,
    calendarDays, estimated, note,
    rows: [ { modelName, thinkingLevel, activeDays, turns,
              userPrompts, aiPrompts, cost,
              costPerDay, costPerWeek, costPerMonth, costPerYear,
              estimated } ],        // zero-cost rows excluded
  },
}
```

## Template maintenance note

The client-side JS lives inside a TS template literal in
`generateReportHtml`, so it must never use backticks or `${}` —
string concatenation only. The only template interpolations are
`${title}` and `${json}`.

## Why "report" and not just "usage"

`usage.ts` (the previous name) was ambiguous - recording and
reporting are two different responsibilities. `usage-recording.ts`
writes to the DB, `usage-report.ts` reads from it. Two files, one
direction each.

# usage-report.ts

Reads the per-turn SQLite database, generates the report data
(`data.json`), seeds the report web app into the persistent data dir
and starts its local server. Owns the report commands.

## What it does

`/usage-report` does NOT generate a single HTML file. The report UI is
a small website that ships in the package
(`extensions/aftc-toolset/data/usage-report/` — the seed). The command:

1. `collectReportData()` - aggregates the whole turns/tasks history
   from the DB (read-only).
2. `ensureReportFiles()` - copies the seed into
   `<persistent-data-dir>/usage-report/` (OS-specific; see
   `paths-readme.md`) when the live copy is missing or its
   `.usage-report-version` stamp is older than `usageReportVersion` in
   `data/extension-config.json`. These are program files, not user
   data - a version bump re-copies them wholesale. `copyDir` skips
   `data.json` (the seed ships a `{}` placeholder; the live copy is
   always regenerated).
3. `writeReportJson()` - writes a fresh `<live>/data.json` from the
   collected data.
4. `spawnReportServer()` - starts the bundled zero-dependency server
   (`server.js`). On Windows it runs `start.bat` via `cmd /c start` so
   the report opens in its OWN terminal window - closing that window
   or Ctrl+C stops the server. Elsewhere it spawns a detached
   `node server.js` in the live dir.

The server then opens the browser and prints its info. The page is a
dark-themed, tabbed app titled **PI AFTC Toolset - Usage Report** with
an "All For The Code" strapline and an orange `Generated on: YYMMDD -
HH:MM` line (rendered client-side from `data.generatedAt`), plus five
tabs.

### Why a website + server instead of one file

The old single-file report embedded ~600 lines of JS inside a TS
template literal - an escape-mangling bug class that made the client
code effectively uneditable. Serving over localhost also makes ES
modules and `fetch()` work; both are blocked on `file://` pages. The
split gives plain, editable ES-module sources (`includes/js/`) and a
clean data contract (`data.json`).

## The shipped website (seed: data/usage-report/)

- `index.html` - page title / header, tab bar, all five tab panels.
- `favicon.png`, `includes/css/styles.css` - dark theme, AFTC brand
  colours.
- `includes/js/libs/chart.umd.min.js` - Chart.js bundled LOCALLY. No
  CDN, no internet needed; every chart, table and card works offline.
- `includes/js/app.mjs` - entry module: fetches `./data.json`, boots
  the five tab classes, wires tab switching and deep links (the active
  tab is kept in `location.hash`, and a hash in the URL opens that
  tab). If Chart.js is missing for any reason, each chart slot renders
  a text fallback and everything else still works.
- `includes/js/lib/format.mjs` - formatters/markup helpers
  (`fmtMoney`, `fmtMs`, `fmtPct`, stat cards, sortable `makeTable`,
  column info hints).
- `includes/js/lib/charts.mjs` - Chart.js palette/defaults/fallback.
- `includes/js/tabs/{overview,models,thinking,timings,projections}.mjs`
  - one ES-module class per tab.
- `server.js` - zero-dependency `node:http` static server, bound to
  127.0.0.1. Port 8713, scanning upwards for a free one
  (`USAGE_REPORT_PORT` override). Opens the browser, prints a
  server-info banner, is traversal-safe (403 outside the served root),
  and self-terminates: idle watchdog after 30 minutes without a
  request (`USAGE_REPORT_IDLE_MINUTES` override), SIGINT/SIGTERM
  (Ctrl+C / window close), and with opt-in `USAGE_REPORT_STDIN_GUARD=1`
  (non-TTY stdin) it also exits on stdin EOF.
- `start.bat` / `start.sh` - launchers (`node server.js` from the
  app's own folder; the .bat pauses with a hint if Node is missing).
- `data.json` - empty `{}` placeholder, never copied to the live dir.

`syncUsageReportFiles()` is a test seam that runs the seed->live sync
directly (tests point `AFTC_TOOLSET_DATA_ROOT` at a scratch dir).

## Tabs

### Tab 1 - Overview
- Six headline stat cards: total cost, user prompts (tasks +
  follow-ups), AI prompts (self-prompting turns), avg cost per user
  prompt, avg cache hit, active days. Prompt terminology mirrors the
  footer widget: **User** = typed prompts, **AI** = self-prompted
  turns (tool-call continuations).
- **Daily spend** bar chart (last 30 local days, zero-filled; today is
  highlighted orange; tooltips show cost / calls / prompts).
- **Cost share by model** doughnut (top 7 + Other, total in the
  centre) with an on-theme window selector styled like the Period
  selects: Last 24 Hours (rolling), 1 Day, 3 Days, 5 Days, 1 Week,
  1 Month, 3 Months, 6 Months, 1 Year, All Time — default selection
  3 Days. Calendar windows anchor to local midnight / 1st of month /
  Jan 1 (the footer timeframe semantics); only the 24 h window is
  rolling. All 10 windows are precomputed server-side in
  `collectShareWindows` as `shareWindows` (cost-by-model, paid turns
  only); picking a window updates the chart in place. The panel title
  carries no window text; the legend carries the share %.
- **Period summary** - three compact cards (last 24 h / 7 d / 28 d):
  cost, `Prompts: User N / AI M`, then a **per-model scoreboard**.
  All 13 rows are ALWAYS shown - a row whose metric is uncomputable
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
  value column carries the task count), **Longest Avg Task Time** /
  **Shortest Avg Task Time** (completed tasks only, grouped by model
  x thinking level; each names the model, and the value column
  carries the thinking level + formatted average time), best/worst
  cache hit (by avg hit rate %), best/worst response time, best/worst
  think time. The three task-time rows all render `N/A` when the
  window has no completed tasks. Time values use `Xh Ym Zs` format
  (no padding, omit zero units). No colour coding on scoreboard rows
  — polarity lives in the words only.

### Tab 2 - Models
Sortable, horizontally responsive table with a period selector
(Last 24 hours / Last 7 days / Last 28 days / All time, default All
time) and a cost-by-model horizontal bar chart (top 8) that follows
the selected period. Columns: model, cost (bar), user prompts, AI
prompts, AI/user, Avg $/Pup (avg cost per user prompt), Avg cache,
avg response time, **Task time** (avg completed-task duration for
that model). Non-obvious columns (AI/user, Avg $/Pup, Avg cache,
Task time) carry an info icon that floats an on-theme tooltip
explaining the metric on hover. The Task Time tooltip carries the
root-README definition: one prompt's complete run across all its
tool-call turns, enter → agent settled.

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

The DB lives at `<persistent-data-dir>/turns.db` (OS-specific; see
`paths-readme.md`) (populated by `usage-recording.ts`). The report
query is read-only via `better-sqlite3`. If better-sqlite3 isn't
installed, both commands report an error (pointing at `/aftc-install`)
and the report cannot be generated.

## Commands registered (2)

- `/usage-report` - collects the data, seeds/refreshes the live app,
  writes `data.json` and starts the local server, which opens the
  report in the user's default browser. Console messages: "Usage
  report server starting — your browser will open." plus the live
  dir and stop/idle behaviour. Close the server window (or Ctrl+C)
  to stop it; it also self-exits after 30 minutes idle.
- `/usage-clear` - permanently deletes all rows from BOTH the `turns`
  and `tasks` tables (one transaction) after user confirmation. Useful
  for resetting the dataset - the Timings tab would otherwise survive
  a turns-only clear.

## Data shape (data.json)

Written fresh to `<persistent-data-dir>/usage-report/data.json` on
every `/usage-report`; fetched by `app.mjs`:

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
               scoreboard: [ { label, model, value, na? } ] },
    weekly:  { ... },
    monthly: { ... },
  },
  shareWindows: [ { key, label, models: [ { name, cost } ] } ],
      // 10 entries, cost-by-model per Overview doughnut window,
      // paid turns only (collectShareWindows)
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

Scoreboard entries carry `na` when the row must render N/A with that
tooltip reason (the row stays visible).

## Why "report" and not just "usage"

`usage.ts` (the previous name) was ambiguous - recording and
reporting are two different responsibilities. `usage-recording.ts`
writes to the DB, `usage-report.ts` reads from it. Two files, one
direction each.

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
HH:MM` line (rendered client-side from `data.generatedAt`), plus seven
tabs.

### Why a website + server instead of one file

The old single-file report embedded ~600 lines of JS inside a TS
template literal - an escape-mangling bug class that made the client
code effectively uneditable. Serving over localhost also makes ES
modules and `fetch()` work; both are blocked on `file://` pages. The
split gives plain, editable ES-module sources (`includes/js/`) and a
clean data contract (`data.json`).

## The shipped website (seed: data/usage-report/)

- `index.html` - page title / header, tab bar, all seven tab panels.
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
- `includes/js/tabs/{overview,models,thinking,timings,projections,context,errors}.mjs`
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
- Six headline stat cards in a 2x3 grid: total cost, cost per
  completed task, user prompts (tasks + follow-ups), **User / AI
  Prompts** (user prompt count / AI self-prompted turns, with the
  sub-line "On average there are N AI prompts to 1 user prompt"),
  **Worst token burner** (the model that used the most tokens EVER —
  prompts, replies and cached context — all-time count in the sub-line,
  info-icon tooltip), avg cache hit. Prompt terminology mirrors the footer
  widget: **User** = typed prompts, **AI** = self-prompted turns
  (tool-call continuations). Note: the 5h/7d token-burn windows and the
  provider-reported 5h / weekly allowance live on the Context & Allowance
  tab — only subscription providers (Codex, Claude, MiniMax, Z.ai GLM,
  Kimi) report an allowance; API providers (DeepSeek etc.) have no 5h
  window, so the Overview cards are all-time figures.
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
- **Period summary** - six compact panes in a 2x3 grid, each for its own
  time window: **Last 24 hours (rolling window) · Last 3 days · Last
  Week (Mon to Sun) · This Week (Mon to Sun) · This Month · Last
  Month**. Calendar periods anchor to local midnight / Monday / 1st of
  month; lastWeek / lastMonth are bounded so this week/this month never
  leak in. Each pane shows the window's cost, `Prompts: User N / AI M`,
  then two sections split by an hr: **Best AI Models** and **Worst AI
  Models**, each with 5 per-metric rows (all ALWAYS shown - an
  uncomputable metric renders `N/A` with an info-icon tooltip giving
  the reason). Best: cheapest model ($/turn), best value per task
  ($/completed task), fastest tasks (avg task time), most efficient
  prompting (fewest AI auto-turns per prompt), best cache hit. Worst:
  most costly model, most costly per task, longest task time,
  auto-prompt hog (info-icon tooltip explains the metric), worst
  cache hit. The COST rows only consider models that cost something in
  the window - a cost average over $0 (subscription) models is
  meaningless, so a subscription-only period shows N/A there with a
  tooltip explaining that providers often don't report a per-turn
  price. The cache / timing / ratio rows consider ALL models - those
  metrics exist for subscription models too. Time values use `Xh Ym Zs`
  format (no padding, omit zero units).

### Tab 2 - Costs Per Model
Renamed v1.21.6 to say what it is. Per-model cost table with a period
selector (Last 24 hours / Last 7 days / Last 28 days / All time,
default All time) and an **avg cost per turn by model** horizontal
bar chart (top 8) that follows the selected period. Costs are the
model's average cost per turn (cost ÷ turns) — the price, independent
of how much you used it — so usage volume never skews the comparison.
Columns: model (+ **Provider** — which provider the model runs
through, so same-named models from different providers are told
apart), **Turn Cost**, **Avg Task $** (avg cost per completed
task, with the task count as a small annotation), **User / AI**
(prompts you typed / AI self-prompted turns — one merged column with
an info-icon tooltip), Avg $/Pup (avg cost per user prompt), context (avg % of the model's context window at task end —
plain percentage, no fill bar), errors (failed calls, centred),
**Task time** (avg completed-task duration), and a **Verdict** column
with badges that shame/hero the best and worst of each metric per
period: Best value / Most expensive (from $/task, paid models only),
Fastest / Slowest (task time), Most efficient / Auto-prompt hog
(AI-per-user-prompt ratio), Error-prone (most failed calls), Context
hog / Low context (context % of window). Every badge shows a "why"
tooltip on hover (same as the info icons) and the badge text is not
selectable; a model only earns a verdict when more than one model can
be compared, so one model never shows both Context hog and Low
context. Non-obvious columns carry an info icon that floats an
on-theme tooltip explaining the metric on hover. No bar fills — the table stays compact and avoids horizontal
scrolling.

### Tab 3 - Thinking levels
Same table shape keyed by model + thinking level (one row per
combination): model, thinking level, cost, **Avg Task $**, a merged
**User / AI** column (with info tooltip), Avg $/Pup, Avg cache, Avg
think, Avg response and a trailing **Task time** column — the numeric
columns are centre-aligned, with the same info tooltips.

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
- **Where the task time goes** - a bar splitting the window's total
  completed-task time into Thinking / Responding (summed per-turn
  figures); the empty tail of the bar is any unaccounted remainder (tool
  waits, retries, compaction).
- **User-prompt vs AI turns** - per-turn kind: turn count, avg think,
  avg respond, avg total.
- **Longest tasks** - sortable top-10 completed tasks in the window:
  when, model, thinking level, turns, task time.
- A basis note defines Task Time (wall-clock enter → settle, spanning
  questions / steering / retries / compaction) and states that failed
  runs are counted but never averaged.

### Tab 5 - Projections
Usage-rate cost projections, rebuilt v1.21.x. A period selector
(Last 24 hours / 7 days / 28 days / All time, default All time)
scopes the rate the math is derived from.
- Five cards: avg cost/turn, avg cost per completed task (with the
  completed-task count), tasks per active day (the pace the
  projections are built on), projected next 30 days and next 365
  days (tasks/day × $/task).
- Per-model table: active days, tasks done, turns, $/turn, $/task,
  tasks/day, $/day (spend ÷ active days), and projected 7 / 30 / 90 /
  365-day spend. Projections = completed tasks per active day × avg
  cost per completed task × N days — built from YOUR actual usage.
  Rows with fewer than 7 active days are marked `~` (estimate,
  tooltip explains why). Model rows with ZERO total cost are excluded
  entirely - a $0 model has nothing to project.
- The note states the basis: active-day pace (idle days are not
  counted); the reference burn rate that includes idle days lives on
  the Overview cards (all spend ÷ calendar days). Flagged as an
  estimate below 14 calendar days of history.

### Tab 6 - Context & Allowance
Context-window pressure and provider allowance consumption, per
period selector (default All time):
- Five cards: 5h token burn (input + output + cache-read), 7d token
  burn, **1M-window rate** (1M-token windows burned per 5h — above
  1x means a 1M context window is unsustainable at your burn rate),
  current 5h allowance used and weekly allowance used (latest
  provider snapshot, N/A when the provider reports no allowance).
- **5-hour token burn by model** bar chart: context-window
  equivalents per 5h per model (5h tokens ÷ the model's window).
- **Context use by model** table (per model × thinking level):
  context window, tasks with data, avg context at task start, avg at
  task end, % of window (coloured bar), growth per task, **Tasks to
  full** (how many tasks of the current growth would fill the
  window — red ≤ 3, amber ≤ 10), 5h burn, 5h / window equivalents,
  and the **1M flag** (red pill when the model burns ≥ 1,000,000
  tokens per 5h). The 5h / window and 1M-flag columns only apply to
  models that ACTUALLY report an allowance window (subscription plans
  — Codex, Claude, MiniMax, Z.ai GLM, Kimi); API providers (DeepSeek
  etc.) show — for them, since they have no 5h usage window. Recorded
  per task as allowance_reported (footer line-5 availability).
- **Allowance consumed per task** table (per provider): tasks with
  snapshots, avg 5h %/task, avg weekly %/task, 5h used, weekly
  used, 5h resets (tasks where the window reset mid-task), and
  **Tasks to 5h full** / **Tasks to weekly full** (tasks until the
  window hits 100% at the current rate). Only Codex, Claude, MiniMax,
  Z.ai GLM and Kimi subscriptions report an allowance; other
  providers show the empty-state note.

Context start/end come from pi's `getContextUsage()` tokens recorded
per task by `core.ts`; old rows (0) fall back to turn-derived values.

### Tab 7 - Errors
Failed calls — the unreliable models. Period selector (default All
time):
- Four cards: failed calls, error rate (failed ÷ completed tasks,
  per 100), failing models, most common error type.
- **Failed calls by model** horizontal bar and **by type** doughnut
  (rate limit, overloaded, not found, auth, timeout, network, other),
  plus a **failed calls per day** bar (last 30 days).
- Sortable table per model × error type: failed calls, % of all,
  last seen, and a fair **error rate** (failed ÷ completed tasks for
  that model — models used a lot are compared honestly).
- Basis note: a failed call is an assistant turn that ended with an
  error; user aborts (Escape) are NOT errors — they are counted as a
  stat on the Timings tab.

Errors are recorded by `core.ts` on the failing `message_end`
(`stopReason === "error"`) into the `errors` table, classified by
`classifyError()` (429/rate limit, 5xx/overloaded, 404/not found,
401-403/auth, 408/timeout, network keywords, else other).

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
- `/usage-clear` - permanently deletes all rows from ALL THREE
  tables (`turns`, `tasks`, `errors`) in one transaction after user
  confirmation. Useful for resetting the dataset.

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
            activeDays, calendarDays, avgDailySpend, firstTurnMs,
            completedTasks, avgCostPerTask, fiveHourBurn,
            sevenDayBurn },
  periods: {                       // 6 Overview period panes (2x3 grid)
    "24h":      { label, cost, calls, prompts, aiPrompts,
                  best: [ { label, model, value, na? } ],   // 5 rows
                  worst: [ { label, model, value, na? } ] },
    "3d":       { ... },          // calendar 3 days
    "lastWeek": { ... },          // prev Mon-Sun (bounded)
    "thisWeek": { ... },          // current Mon-Sun
    "thisMonth":{ ... },          // current calendar month
    "lastMonth":{ ... },          // prev calendar month (bounded)
  },
  shareWindows: [ { key, label, models: [ { name, cost } ] } ],
      // 10 entries, cost-by-model per Overview doughnut window,
      // paid turns only (collectShareWindows)
  dailySeries: [ { day, label, cost, calls, prompts } ],  // 30 days, zero-filled
  modelsByPeriod: { daily: [], weekly: [], monthly: [], all: [] },
      // ModelRow: modelName, cost, turns, userPrompts, aiPrompts,
      // aiPerUserPrompt, costPerTurn, avgCostPerUserPrompt,
      // avgCacheRate, avgThinkingMs, avgResponseMs, avgTaskMs,
      // costPerTask, completedTasks, errorCount, errorRate,
      // contextEndPct
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
  contextStats: {                    // Context & Allowance tab
    daily: [ { modelName, thinkingLevel, tasks, contextWindow,
               avgStartTokens, avgEndTokens, avgEndPct, avgGrowth,
               tasksUntilFull, fiveHourBurn, weeklyBurn,
               fiveHourWindows, millionFlag } ],
    weekly: [...], monthly: [...], all: [...] },
  allowanceStats: { daily: [ { provider, tasks, avg5hPerTask,
               avgWeeklyPerTask, avg5hEnd, avgWeeklyEnd,
               fiveHourResets, tasksUntil5hFull,
               tasksUntilWeeklyFull } ], weekly: [...],
               monthly: [...], all: [...] },
  allowanceLatest: { provider, fiveHourUsed, weeklyUsed, at } | null,
  errorStats: { daily: [ { total, byType: [ { type, count } ],
               byModel: [ { modelName, errorType, count, lastTs } ],
               modelRates: [ { modelName, errors, completedTasks,
                               rate } ] } ], weekly: [...],
               monthly: [...], all: [...] },
  errorDailySeries: [ { day, label, count } ],        // 30 days
  projections: {                     // usage-rate projections, per period
    daily: { totalCost, avgCostPerTurn, avgCostPerTask,
             completedTasks, activeDays, calendarDays, tasksPerDay,
             spendPerDay, projected7d, projected30d, projected90d,
             projected365d, estimated, note,
             rows: [ { modelName, activeDays, turns, userPrompts,
                       completedTasks, cost, costPerTurn,
                       costPerTask, spendPerDay, tasksPerDay,
                       turnsPerDay, projected7d, projected30d,
                       projected90d, projected365d, estimated } ] },
    weekly: {...}, monthly: {...}, all: {...} },
}
```

Scoreboard entries carry `na` when the row must render N/A with that
tooltip reason (the row stays visible).

## Why "report" and not just "usage"

`usage.ts` (the previous name) was ambiguous - recording and
reporting are two different responsibilities. `usage-recording.ts`
writes to the DB, `usage-report.ts` reads from it. Two files, one
direction each.

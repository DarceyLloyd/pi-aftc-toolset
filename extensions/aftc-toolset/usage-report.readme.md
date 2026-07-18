# usage-report.ts

Reads the per-turn SQLite database and writes a self-contained HTML
report. Owns the report commands.

## What it does

`/usage-report` produces a single HTML file at
`<package-root>/.pi-aftc-toolset/data/report.html`. The HTML is one
self-contained file - embedded CSS, embedded JSON, embedded JS. The
only external reference is the Chart.js CDN (pinned `chart.js@4.4.7`,
jsdelivr) used for the graphs; when offline the page degrades
gracefully to text fallbacks and every table/card still works.

The report is a dark-themed, tabbed page with an AFTC-branded header
(page title, an "All For The Code" strapline, and an orange
`Generated on: YYMMDD - HH:MM` line) and four tabs:

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
  cost, `Prompts: User N / AI M` (footer-style split), top model with
  cost and share.

### Tab 2 - Models
Sortable, horizontally responsive table with a period selector
(Last 24 hours / 7 days / 28 days / All time, default All time) and a
cost-by-model horizontal bar chart that follows the selected period.
Columns: model, cost (bar), user prompts, AI prompts, AI/user,
Avg $/Pup (avg cost per user prompt), Avg cache, avg response time.
Non-obvious columns (AI/user, Avg $/Pup, Avg cache) carry an info
icon that floats an on-theme tooltip explaining the metric on hover.

### Tab 3 - Thinking levels
Same table shape keyed by model + thinking level (one row per
combination), with avg think time added and the same info tooltips.

### Paid-only cost averages
Free / $0 (subscription) turns are recorded (see
`RECORD_ZERO_COST_TURNS` in `usage-recording.ts`) and count toward
prompt, cache and timing figures, but every COST average
denominator is paid-only (`CASE WHEN cost_usd > 0`), per model and
in the lifetime totals, so free models never drag averages down. A
note under the Overview cards states this basis.

### Tab 4 - Projections
- Three burn-rate cards: avg cost/day, projected /month (x30.44),
  projected /year (x365). Basis: all-time spend / **calendar days**
  since the first recorded turn (idle days included). Flagged as an
  estimate below 14 calendar days.
- Per model x thinking table: active days, prompts (User / AI), total
  cost, $/day, $/week, $/month, $/year. Basis: spend / **active days**
  (distinct calendar days with at least one turn). Rows with fewer
  than 7 active days are marked `~` (estimate, tooltip explains why).

The old hourly-rate projection (`max(0.5h, active hours)` then x24/7)
was removed - it inflated tiny samples into absurd yearly figures.

## Reading the SQLite DB

The DB lives at `<package-root>/.pi-aftc-toolset/data/turns.db`
(populated by `usage-recording.ts`). The report query is read-only
via `better-sqlite3`. If better-sqlite3 isn't installed, the commands
report an error and the HTML report cannot be generated.

## Commands registered (2)

- `/usage-report` - generates + writes the HTML report, opens it
  in the user's default browser (fire-and-forget; non-UI fallback
  logs the path to stdout).
- `/usage-clear` - permanently deletes all rows from `turns`
  after user confirmation. Useful for resetting the dataset.

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
               topModel, topModelCost, topModelShare },
    weekly:  { ... },
    monthly: { ... },
  },
  dailySeries: [ { day, label, cost, calls, prompts } ],  // 30 days, zero-filled
  modelsByPeriod: { daily: [], weekly: [], monthly: [], all: [] },
  modelThinkingByPeriod: { daily: [], weekly: [], monthly: [], all: [] },
  projections: {
    avgDailySpend, projectedWeek, projectedMonth, projectedYear,
    calendarDays, estimated, note,
    rows: [ { modelName, thinkingLevel, activeDays, turns,
              userPrompts, aiPrompts, cost,
              costPerDay, costPerWeek, costPerMonth, costPerYear,
              estimated } ],
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

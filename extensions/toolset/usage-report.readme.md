# usage-report.ts

Reads the per-turn SQLite database and writes a self-contained HTML
report. Owns the report commands.

## What it does

`/usage-report` produces a single HTML file at
`<package-root>/.pi-aftc-toolset/data/report.html`. The HTML is
intentionally one self-contained file — embedded CSS, embedded JSON,
embedded JS — so opening it from disk has no external dependencies.

The report is organised into six sections:

### Section 1 — Daily totals (last 24 hours)
Four cards:
- **Most used** — derived from base-prompt count (highest `basePromptCount`)
- **Most inefficient** — derived from turns / self-prompting (highest
  `turnsPerBasePrompt`, capped at 0.1 minimum)
- **Highest avg cost** — derived from base + sub prompts
  (`avgCostPerUserPrompt`, highest)
- **Lowest avg cost** — derived from base + sub prompts
  (`avgCostPerUserPrompt`, lowest)

### Section 2 — Weekly totals (last 7 days)
Same four cards as Section 1, computed from the last 7 days of data.
Includes a **weekend toggle** button that switches between
include/exclude Sat/Sun data (`strftime('%w', ...) NOT IN ('0','6')`).
Both variants are precomputed server-side so the toggle flips instantly.

### Section 3 — Monthly totals (last 28 days)
Same four cards as Section 1, computed from the last 28 days of data.
Same weekend toggle as Section 2.

### Section 4 — Per-model cost report
Sortable table with a period selector (`Daily` / `Weekly` /
`Monthly` / `All time`, default `All time`). Columns: model, cost,
turns, user/base/sub prompts, calls/prompt, max calls/prompt,
avg cost/turn, avg cost/prompt, avg cache, avg think, avg response.

### Section 5 — Per-model × thinking level
Same shape as Section 4 but keyed by model + thinking level, so a
single model can have multiple rows (one per thinking level used).

### Section 6 — Cost projections
Per model × thinking level: `$`/hour, `$`/day, `$`/week, `$`/month,
`$`/year. Derived from total spend ÷ active hours, then scaled by
24 / 168 / 720 / 8760. Active hours = max(0.5h, last-turn − first-turn).

**Thin-data handling**: if fewer than ~14 calendar days are present across
all data, projections are flagged as estimates with the note
*"Not enough data available for calculation, averages have been used."*
Rows with less than 1 hour of activity are individually flagged as
estimates regardless of the global threshold.

## Reading the SQLite DB

The DB lives at `<package-root>/.pi-aftc-toolset/data/turns.db`
(populated by `usage-recording.ts`). The report query is read-only
via `better-sqlite3`. If better-sqlite3 isn't installed, the commands
report an error and the HTML report cannot be generated.

## Commands registered (2)

- `/usage-report` — generates + writes the HTML report, opens it
  in the user's default browser (fire-and-forget; non-UI fallback
  logs the path to stdout).
- `/usage-clear` — permanently deletes all rows from `turns`
  after user confirmation. Useful for resetting the dataset.

## Data shape (embedded JSON)

```text
{
  generatedAt: number,
  totals: { ... },                 // lifetime aggregates
  sections: {                      // 4-card bundles per period
    daily: { title, subtitle, cards: [4 cards] },
    weekly: {...}, weeklyExcl: {...},
    monthly: {...}, monthlyExcl: {...},
  },
  modelsByPeriod: { daily: [], weekly: [], monthly: [], all: [] },
  modelThinkingByPeriod: { daily: [], weekly: [], monthly: [], all: [] },
  projections: { rows: [], estimated: boolean, note: string },
}
```

## Why "report" and not just "usage"

`usage.ts` (the previous name) was ambiguous — recording and
reporting are two different responsibilities. `usage-recording.ts`
writes to the DB, `usage-report.ts` reads from it. Two files, one
direction each.

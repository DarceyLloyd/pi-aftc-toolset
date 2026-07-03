# usage-report.ts

Reads the per-turn SQLite database and writes a self-contained HTML
report. Owns the report commands.

## What it does

`/usage-report` produces a single HTML file at
`<package-root>/.pi-aftc-toolset/data/report.html`. The HTML is
intentionally one self-contained file — embedded CSS, embedded JSON,
embedded JS — so opening it from disk has no external dependencies.

The report covers:

- **Lifetime totals** — turns, user prompts, sub-prompts, steering
  / follow-up / continuation counts, cache read/write, total cost,
  avg cost/turn and per user prompt.
- **Model leaderboards** — six ranked cards per time window (Last
  3h, 6h, 12h, Today, Yesterday, Last 3d, Week, Month). Most
  prompted, most model calls, longest avg response, highest cost
  per turn, most cost over period, highest cache hit rate.
- **Summary cards** — cheapest, most expensive, most cache
  inefficient, etc. Each pill-labelled GOOD / OK / BAD with
  $/hr · $/day · $/wk · $/mo rate breakdowns.
- **Trend** — interactive chart with hourly / daily / weekly /
  monthly grain and cost / prompts / turns metrics.
- **Trend table** — date, model, turns, prompts, cost, cache, etc.
  Sortable columns.
- **Per-model cost report** — period tabs, turns, prompts, max
  calls/prompt, avg cost/turn and per prompt, cache, think/response.
- **Model × thinking level** — cost + cache + timing per model and
  thinking level.
- **Cost projections** — 6h / 12h / 1d / 7d / 30d, with selectable
  calculation modes (recommended, avg base-prompt cost, avg
  all-prompt cost, raw model-call velocity, worst prompt-loop risk).

## Reading the SQLite DB

The DB lives at `<package-root>/.pi-aftc-toolset/data/turns.db`
(populated by `usage-recording.ts`). The report query is read-only
via `better-sqlite3`. If better-sqlite3 isn't installed (e.g. the
user hasn't run `/aftc-install`), the commands report an error and
the HTML report cannot be generated.

## Commands registered (2)

- `/usage-report` — generates + writes the HTML report, opens it
  in the user's default browser (fire-and-forget; non-UI fallback
  logs the path to stdout).
- `/usage-clear` — permanently deletes all rows from `turns`
  after user confirmation. Useful for resetting the dataset.

## Why "report" and not just "usage"

`usage.ts` (the previous name) was ambiguous — recording and
reporting are two different responsibilities. `usage-recording.ts`
writes to the DB, `usage-report.ts` reads from it. Two files, one
direction each.

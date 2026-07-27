# Usage Report Display Rules (`extensions/aftc-toolset/usage-report.ts`)

These rules govern every number the report renders. Keep this doc current
whenever the report's display logic changes.

---

## Money formatting (`fmtMoney`)

| Range | Format | Examples |
| --- | --- | --- |
| `$0` | `$0.00` | never `$0.0000` or `$0` |
| Below `$1` | 4 decimal places | `$0.0156`, `$0.7102` |
| `$1` to below `$1,000` | 2 decimal places, keep trailing zeros | `$1.00`, `$4.10`, `$999.99` |
| `$1,000` and above | Whole number, NO decimal point | `$1,000`, `$18,021`, `$1,234,567` |

- Thousands separators at every magnitude.
- Applies EVERYWHERE: stat cards, period cards, tables, tooltips, projections,
  doughnut centre/legend, AND chart axis tick callbacks.
- NEVER emit raw `"$"+v` — every money value goes through `fmtMoney` (client) /
  `fmtMoneyServer` (server). Keep the two in sync.

---

## Duration formatting (`fmtMs` / `fmtMsServer`)

Format: `Xh Ym Zs` — no left-padding, omit zero leading units.

Examples: `0s`, `5s`, `1m 30s`, `2h 5m 3s`, `1h 0m 0s` becomes `1h`.

Used in: scoreboard rows, Models table, Thinking table, Timings tab, tooltips.

---

## Period summary scoreboard

Each period card (24h / 7d / 28d) shows a per-model scoreboard below the
`Prompts: User N / AI M` line.

**Rules:**
- ALL 11 rows are ALWAYS shown.
- A row whose metric is uncomputable renders `N/A` with an info-icon tooltip
  giving the REASON (it never silently disappears). `ScoreboardEntry.na` carries
  the tooltip text.
- COST rows (cheapest / most costly) consider only models that cost something.
- Usage / cache / timing rows consider ALL models (including $0 subscription).
- Every row renders `label . model . value` — the value is NEVER empty.
- Money rows use `fmtMoneyServer`, usage rows locale-separated count, cache rows
  `fmtPctServer`, time rows `fmtMsServer`.

**Rows (in order):**
1. Cheapest model (lowest avg cost per turn)
2. Most costly model (highest avg cost per turn)
3. Most used model (most user-prompt turns; ALL models)
4. Least used model (fewest user-prompt turns; N/A when < 2 models)
5. Avg Task Time (mean wall-clock over COMPLETED tasks only; value column shows task count)
6. Best cache hit (highest avg hit rate %)
7. Worst cache hit (lowest avg hit rate %)
8. Best response time (lowest avg response ms; exclude 0)
9. Worst response time (highest avg response ms; exclude 0)
10. Best think time (lowest avg thinking ms; exclude 0)
11. Worst think time (highest avg thinking ms; exclude 0)

**Removed:** the old "Top model: X . $total (share%)" line. The pie chart legend
carries the share % instead.

**No "best model" label anywhere.** "Best" is subjective per metric.

**No colour coding** (green/red) on scoreboard rows — polarity lives in the words
(Cheapest/Most costly/Best/Worst) only.

---

## Chart.js conventions

- Doughnut legend: custom `generateLabels` must return `fontColor` on every item
  (no global fallback — omit it and text renders black). Set `labels.color` too.
- Legend text shows `Model (XX.X%)` via the `generateLabels` callback.
- Slices that format as `0.0%` (share < 0.05%) are dropped from doughnut DATA
  before chart build. Filtering happens AFTER top-7 + "Other" aggregation so
  legend/dataset indexes stay aligned.
- Grid children wrapping a responsive canvas need `min-width:0` to prevent
  horizontal overflow after shrink/expand resize.
- See `W:\Resources\AI\Agent\support-documents\chartjs.md` for the full gotcha list.

---

## General

- Self-contained HTML file (embedded CSS/JSON/JS). Only external ref: Chart.js
  CDN (pinned version). Offline: charts degrade to text; tables/cards still work.
- Data from `turns.db` via `better-sqlite3`. Missing native module = error toast,
  commands no-op.
- Report file lives in the persistent OS data dir (`paths.ts`), not the package.
- Five tabs: Overview, Models, Thinking levels, **Timings**, Projections
  (Timings BEFORE Projections).
- Timings tab: failed tasks (error/abort) ARE recorded and counted, but NEVER
  averaged into Task Time. Every Task Time average/max/list is
  `stop_reason = 'complete'` only.
- Projections exclude zero-cost model rows. Period scoreboards exclude $0 models.
- `/usage-clear` deletes BOTH the `turns` and `tasks` tables.

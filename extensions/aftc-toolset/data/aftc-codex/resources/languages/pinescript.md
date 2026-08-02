# Pine Script (v6)

Migrated from AFTT v1.0 docs/Issues and Solutions.md (2026-07).

## Rules

- [hr0hym] Decide first: must this run every bar, or only for final rendered state?
- [aSA56B] Keep required tracking/calculation outside `barstate.islast`.
- [jJvmyZ] Move heavy render/merge/group/label recompute into `if barstate.islast` when safe.
- [Np4gb5] If profiler is high, reduce nested scans and repeated object updates first.
- [QCOeJh] Re-profile after each optimization.
- [i6d1zE] NEVER draw excessive `plot*()` calls to emulate dynamic style/size behavior.

## Gotchyas

- [wB5Ksh] Qualifier "const" - compile-time fixed value; required for `plot*()` size/style args (they reject series/simple).
- [CrUSEk] Qualifier "input" - user setting value; only known once the user confirms settings, not at compile time.
- [7oSpQg] Qualifier "simple" - stable scalar type, not a bar-by-bar series; required by args like `ta.valuewhen()` `occurrence`.
- [Gjaoy7] Qualifier "series" - value that can change on each bar; the default, and the one const/simple args reject.
- [uD3fR8] `for x in array<UDT>` - the loop variable IS a reference for user-defined types (unlike value-type arrays, where it is a copy); mutate UDT fields directly in the loop (`x.field := v`), no `array.set` needed.
- [tV9sM2] input defval changes & saved settings - editing an input's `defval` does NOT update existing chart instances (TradingView keeps the saved settings); tell the user to reset the input to default or re-add the indicator to see a new default.
- [lB5nQ7] label.style_label_up/down anchor - the label's y point is the arrow TIP and the body hangs on the opposite side (up = body below, tip pointing up at y; down = body above, tip pointing down at y); anchor the label at the exact point the tip should touch (e.g. the end of a connector line).

## Issues & Solutions

- `[0c8auL] Cannot call ... with argument "size" ... "simple string" used but "const string" expected`
  Cause: `size`/`style` for `plotshape()`/`plotchar()` must be fixed constants.
  Fix: keep them const, never add many duplicate plots as a size workaround. (2026-07)
- `[ZWnu42] Function arguments cannot be mutable` for line/label handles
  Cause: mutable handles cannot be function args.
  Fix: keep handles in `var` globals or arrays and update them inside function scope via shared state. (2026-07)
- `[JPNXf8] Could not find function ...`
  Cause: function called before declaration.
  Fix: move called function (and dependencies) above callers. (2026-07)
- [DSC13E] Prior levels disappear or drift after rollover/settings changes
  Cause: incremental updates keep stale draw state.
  Fix: on `barstate.islast` clear draw arrays, rebuild completed history deterministically, draw current forming period separately. (2026-07)
- `[L8KcWr] ta.valuewhen()` occurrence rejects loop index/series int
  Cause: `occurrence` must be `simple int`.
  Fix: capture completed-period values on rollover into arrays, iterate arrays for rendering. (2026-07)
- `[Sbs5mR] request.*()` expression rejects loop-local vars
  Cause: expression cannot depend on loop-local mutable scope.
  Fix: call `request.security(...)` outside loop-local context, store results, iterate stored arrays. (2026-07)
- [oUIz5G] Forming HTF level right but completed prior levels wrong
  Cause: reconstructed history not using real completed HTF bars.
  Fix: on last-bar rebuild use direct HTF indexing (`high[n]/low[n]/time[n]/time_close[n]` for n=1..count). (2026-07)
- `[FKcxB0] table.cell()` `text_align` argument error
  Cause: wrong parameter name.
  Fix: use `text_halign` and `text_valign`. (2026-07)
- [VggPrQ] Invalid timeframe strings `1Y`, `2Y`, `3Y`, `24M`, `36M` in `request.security()`
  Cause: unsupported strings.
  Fix: use `12M`; derive 2Y/3Y via yearly windows with `ta.highest`/`ta.lowest`. (2026-07)
- `[QdXm0z] 2D/2W/2M` values do not match "last 2 periods" expectation
  Cause: these are calendar HTF bars, not rolling windows.
  Fix: request base HTF (`D/W/M/12M`) and compute rolling windows with `ta.highest`/`ta.lowest` inside the expression. (2026-07)
- [H7LcPZ] HTF extreme can be lower than LTF range
  Cause: wick/body source computed on chart timeframe then sampled in HTF.
  Fix: compute the source inside the `request.security()` expression so it evaluates on HTF candles. (2026-07)
- `[297gWo] 1W` appears lower than recent daily windows
  Cause: default `request.security()` returns the last completed HTF bar.
  Fix: use `lookahead=barmerge.lookahead_on` for developing values (repaints), or track current HTF range on chart timeframe from `timeframe.change(...)`. (2026-07)
- `[Qz0U5S] 3W` high > `1M` high unexpectedly
  Cause: calendar windows are not guaranteed supersets.
  Fix: if strict nesting is needed compute all windows from one base timeframe (often daily) with explicit day-count approximations. (2026-07)
- [6M8QV2] Syntax error in tuple expression block in `request.security()`
  Cause: tuple expression cannot contain inline typed multi-statement logic.
  Fix: move logic to helper functions above, keep the request expression simple. (2026-07)
- `[au87Uy] Cannot modify global variable ... in function`
  Cause: function scope cannot mutate global script state.
  Fix: keep functions pure (return values); do global assignments/object updates in script scope. (2026-07)
- [wo146W] Opening-range box missing or wrong on higher chart timeframes
  Cause: start check `time >= startTimestamp` misses overlap bars.
  Fix: use overlap logic (`time_close >= startTimestamp` and `time < endTimestamp`) and compute timestamps in tracking timeframe context. (2026-07)
- `[3rPWFp] input.source()` assigned to `string` fails
  Cause: it returns `series float`.
  Fix: store in a `float` variable. (2026-07)
- `[IX9oEE] plot.style_dashed` undeclared identifier
  Cause: dashed style not available for `plot()`.
  Fix: use a supported plot style, or `line.new(..., style=line.style_dashed)` when dashed is required. (2026-07)
- [wfttaN] RSI thresholds render on main chart unexpectedly
  Cause: incorrect `force_overlay` use.
  Fix: `force_overlay=false` for pane plots (threshold/midline), `force_overlay=true` only for main-chart plots. (2026-07)
- `[VyljUg] timeframe.change()` in `nz()` / numeric comparison type errors
  Cause: return type is `series bool`.
  Fix: use directly as a boolean condition. (2026-07)
- [9K2ajb] Consistency warning: `ta.highest`/`ta.highestbars` may not run each bar
  Cause: TA function executed conditionally.
  Fix: precompute on every bar, then use the cached series in conditions. (2026-07)
- [I3QQL9] Consistency warning in `if barstate.islast` blocks (`ta.pivothigh`, `ta.pivotlow`, `ta.lowest`, `ta.highest`, `ta.stdev`)
  Cause: TA calls placed inside a last-bar-only branch.
  Fix: move TA calls outside the branch so they execute every bar; keep only aggregation/drawing in `if barstate.islast`. (2026-07)
- [jB8yUe] Consistency warning: `ta.crossover()`/`ta.crossunder()` inside branches
  Cause: crossover calls are conditional.
  Fix: compute both each bar, then branch on the resulting bool series. (2026-07)
- [A29TsM] Runtime error: history length outside `0..10000`
  Cause: user inputs or computed offsets exceed safe depth.
  Fix: clamp all lengths/offsets before indexing or TA calls; use clamped values everywhere. (2026-07)
- `[AVuSxb] label_style` not a valid type keyword
  Cause: style is a value, not a declaration type.
  Fix: pass the style expression directly in `label.new`/`label.set_style`. (2026-07)
- `[VDW6Ev] input.string()` `defval/options` reject enum constants
  Cause: it requires literal strings.
  Fix: pass string literals and compare against those strings in logic. (2026-07)
- [SinBQ6] Tuple ternary error or `:=` syntax error for tuple target
  Cause: tuples cannot be returned from ternary and tuple reassignment with `:=` is invalid.
  Fix: use `if/else`, unpack the tuple with `=`, then assign scalar targets with `:=`. (2026-07)
- [ZTfELm] Open marker labels never appear on some markets/templates
  Cause: relying only on session transition or only day-change logic.
  Fix: combine session-transition detection with an intraday significant-gap fallback (`actual gap > expected bar gap * 1.5`). (2026-07)
- [CfZF5y] Profiler-heavy rendering loops
  Cause: render-only work running per bar.
  Fix: gate render-only heavy work with `barstate.islast`; keep required per-bar state tracking outside. (2026-07)
- `[mShjkC] Syntax error at input "new line"` after branching edits
  Cause: extra/mismatched `else` branch.
  Fix: enforce one `else` per `if`; keep start-label and end-label branches separate and explicit. (2026-07)
- [l4ap8j] Current HTF high/low off by 1+ ticks vs chart/session extremes
  Cause: developing HTF values from `request.security()` can diverge from chart-timeframe accumulation on some symbols/feeds.
  Fix: track current period extremes on chart timeframe with `timeframe.change("D"|"W"|"12M")` reset + per-bar `math.max`/`math.min`; keep `request.security()` for completed previous-period levels. (2026-07)
- `[fLW8Md] Syntax error at input "=>"`
  Cause: declaring a local helper `name(args) => ...` inside another function body can fail parsing.
  Fix: move helper functions to top-level scope and call them from the main function. Bad: `scoreToColor(score) =>\n\tpickCurve(t) => t * t\n\tpickCurve(score)`. Good: declare `pickCurve(t) => t * t` at top level, then `scoreToColor(score) => pickCurve(score)`. (2026-07)
- `[4BxWma] "plot" is not a valid type keyword`
  Cause: `plot` is not a variable declaration type.
  Fix: assign the `plot(...)` return to a variable without declaring a `plot` type. (2026-07)
- `[LgVARf] Invalid argument "display" in "fill" call`
  Cause: `fill()` does not support display bitmask arithmetic (`display.all - ...`) unlike `plot()`.
  Fix: use only `display.all` or `display.none`. (2026-07)
- [lT45OW] Consistency warning: `ta.sma()` inside ternary
  Cause: TA function embedded in a conditional expression.
  Fix: compute `ta.sma(...)` in a standalone variable first, then select with the condition. (2026-07)
- [MZYobp] MTF VWAP line far from expected anchored VWAP
  Cause: using stepped MTF values/rolling logic instead of timeframe-anchored cumulative flow.
  Fix: detect period rollover with `request.security(..., time)` + `ta.change(...)`, accumulate `src*volume`, `volume`, `src*src*volume` on chart bars and derive VWAP/deviation from cumulative sums. (2026-07)
- `[Xbm9LI] Could not find function or function reference 'ta.sum'`
  Cause: environment/version mismatch for `ta.sum`.
  Fix: implement rolling sums with cumulative differences (`ta.cum(src) - nz(ta.cum(src)[length])`) via a helper function. (2026-07)
- `[G1A6yA] Invalid argument "display" in "hline" call`
  Cause: `hline()` does not support display bitmask arithmetic.
  Fix: use only `display.all` or `display.none`. (2026-07)
- [kNWIhM] Consistency warning: `ta.ema`/`ta.sma`/`ta.rma`/`ta.wma`/`ta.vwma` in MA selector branch/switch
  Cause: TA calls inside conditional scope do not all execute every bar.
  Fix: precompute each TA series every bar in standalone variables, then select with branch/switch. (2026-07)
- `[fahZ9m] Cannot assign a value of the "series int" type ... variable is declared with the "const bool" type` from `ta.change(...)`
  Cause: `ta.change(series)` returns a numeric delta, not a bool.
  Fix: use an explicit comparison (`seriesValue != seriesValue[1]`) or `timeframe.change(...)` for a direct rollover boolean. (2026-07)
- [qT7wKp] `Mismatched input "<var>" expecting set "]"` on a typed tuple declaration `[float a, float b] = f()`
  Cause: tuple declarations unpacking a function's return reject inline type keywords in this context.
  Fix: declare the tuple untyped (`[a, b] = f()`), matching existing working tuple declarations; types are inferred from the function's return values. (2026-07)

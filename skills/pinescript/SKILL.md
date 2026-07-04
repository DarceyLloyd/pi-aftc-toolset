---
name: pinescript
description: "Pine Script v6 for TradingView .pine files: indicators and strategies. Use when adding inputs (input.int, input.source, input.float, input.color, input.session), plots, signals, alerts, requests (request.security), tables, labels, lines, or any feature to a .pine file, or when discussing TradingView indicators, strategies, performance, common Pine Script v6 issues, or the AFTC coding standards (color.new with RGB, camelCase with boolean prefixes, 80-char section separators, START/END markers). Content targets Pine Script v6 specifically - Pine Script v5 has different syntax for some features."
---

# Pine Script

> **Target: Pine Script v6.** This skill's body covers v6-specific syntax (`//@version=6`, `color.new`, `ta.*` namespaces, tuple ternary, etc.). Pine Script v5 has different syntax for some features - for v5 work, check the [Pine Script v5 reference](https://www.tradingview.com/pine-script-reference/v5/).

When to use: working on any `.pine` file, writing or reviewing a TradingView indicator/strategy, debugging Pine Script syntax or runtime issues, or applying the AFTC section structure and color/boolean naming conventions.

The AFTC template is deployed by the Template Selector. When writing Pine Script, follow this section order:

```
//@version=6
// Legal Notice (Copyright AFTC LTD, admin@aftc.uk)

indicator("Name v1 [AFTT]", overlay=false, max_labels_count=500, max_lines_count=500, precision=2)

// --- TYPES and ENUMS ---------------------------------------------------------
// --- GLOBAL VARS -------------------------------------------------------------
// --- USER INPUT SETTINGS OPTIONS --------------------------------------------
// --- FUNCTIONS ----------------------------------------------------------------
// --- CALCULATED VARS INIT ---------------------------------------------------
// --- [FEATURE SECTION] -------------------------------------------------------
// --- PLOTTING/RENDERING ------------------------------------------------------
// --- SHARED PLOTTING/RENDERING -----------------------------------------------
// --- DEBUG -------------------------------------------------------------------
// --- ALERTS ------------------------------------------------------------------
```

Each section wrapped with START/END markers, separated by 80-dash lines. Section separators: `// - - - - - - - - - - - - - - - - - - - - - - - -`

## CRITICAL RULES

### Prohibited
- Delete commented-out code unless explicitly instructed
- Assume anything - ask if unsure
- Create unnecessary variables (e.g., `bool showX = mode == "X"` when `mode == "X"` is used once)
- Use Pine reserved words: `and, array, bool, break, box, byref, color, const, continue, do, else, enum, export, false, float, for, if, import, in, int, label, line, map, matrix, method, not, or, return, series, simple, string, switch, true, type, var, varip, void, while`
- Use `plot` as a variable declaration type
- Use `label_style` as a declaration type - pass style directly in `label.new()`

### Required
- `//@version=6` at the top of every script
- `camelCase` variable names with explicit boolean prefixes (`is`, `has`, `can`, `enable`, `allow`, `use`)
- Domain-clear names: `buySellScore`, `macdReversalLineOpacity`, `nearSignalLookbackBarRange`
- Typed declarations where it improves clarity: `int`, `float`, `bool`, `string`
- Create arrays with correct Pine Script v6 typed declarations
- Colors: ALWAYS use `color.new(color.rgb(r, g, b), opacity)` - NEVER named colors (`color.blue`, `color.red`, etc.)
- Input group title declared as FIRST line directly above each input group
- Section separators: exactly `// - - - - - - - - - - - - - - - - - - - - - - - -` (80 chars)
- Each section: `// START: name` and `// END: name` wrappers
- 4-space indentation throughout
- Keep each feature section under 200 lines - split if needed
- Comments in English explaining trading logic

## Performance Rules
- Per-bar tracking/signal calculations OUTSIDE `barstate.islast`
- Heavy render/merge/group/label recompute INTO `if barstate.islast` when safe
- Reduce nested scans and repeated object updates before adding complexity
- Re-profile after each optimization

## Common Issues and Fixes
- `plotshape()` style/size rejects series → use `label.new()` for dynamic style
- Function forward reference → move above callers
- Mutable handles as params → keep in `var` globals, update in function scope
- TA calls in conditional branches → precompute every bar, use cached series
- `ta.crossover()`/`ta.crossunder()` in branches → compute each bar, branch on result bool
- `request.security()` expression with loop vars → call outside loop, store results
- Invalid timeframe strings (`1Y`, `2Y`, `24M`) → use `12M`, derive via `ta.highest/ta.lowest`
- `2D/2W/2M` are calendar HTF bars not rolling windows → use `D/W/M/12M` + rolling compute
- HTF extremes wrong → compute source INSIDE `request.security()` expression
- History reference limit (>10000) → clamp all lengths/offsets
- Tuple ternary → use `if/else`, unpack with `=`, assign scalars with `:=`
- Nested local `=>` function → move to top-level scope
- `table.cell()` alignment → use `text_halign` and `text_valign`
- `input.source()` returns `series float` → store in `float` variable
- `plot.style_dashed` unsupported → use `line.new(..., style=line.style_dashed)`
- `timeframe.change()` is `series bool` → use directly as boolean
- `force_overlay=false` for pane, `true` for main-chart overlay

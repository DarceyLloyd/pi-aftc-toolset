# Chart.js

Gotchas for Chart.js (the charting lib; in pi-aftc-toolset it renders the usage-report charts from the Chart.js CDN). Entries lead with the greppable symptom.

## Rules

## Gotchyas

## Issues & Solutions


- [ha8EKa] Custom `generateLabels` legend items render BLACK text on a dark theme (canvas default) even though `Chart.defaults.color` is set light
  Cause: the legend renderer reads each item's text colour off `item.fontColor` with NO global fallback; the built-in default generator sets it, a custom one must too.
  Fix: return `fontColor: "<light>"` (and `color: "<light>"` for v4 safety) on every object from `generateLabels`, and also set `labels.color` for the non-custom path. (2026-07)
- [XC0puo] Doughnut/bar canvas overflows the page width (horizontal scrollbar appears) after shrinking then re-expanding the browser, or loading narrow then maximising
  Cause: a CSS grid/flex child holding a `responsive:true` canvas defaults to `min-width:auto`, so once the canvas grew it refuses to shrink back and pushes the layout past the viewport.
  Fix: set `min-width:0` on the grid/flex children that wrap the canvas (and `overflow:hidden` on the canvas box as a belt-and-braces); `responsive:true, maintainAspectRatio:false` alone is NOT enough. (2026-07)
- [w3I8RM] Need a value/percentage in the legend text (eg `Model (42.3%)`)
  Cause: the legend `labels.text` is what shows, but the default generator only puts the dataset label there.
  Fix: supply `plugins.legend.labels.generateLabels` returning `{ text, fillStyle, strokeStyle, pointStyle, fontColor, hidden, index }` per slice; compute the % from the dataset data and the slice total inside the callback (the callback closure must capture the total). (2026-07)
- [BARcw5] Legend `position` set once at chart creation does not re-evaluate on resize
  Cause: `position: window.innerWidth >= 860 ? "right" : "bottom"` is read only when the chart is built, so a resize across the breakpoint keeps the old side until the chart is rebuilt.
  Fix: acceptable for a static report, but for a live app rebuild/`chart.update()` on a resize handler. (2026-07)

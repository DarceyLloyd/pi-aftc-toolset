// lib/tooltips.mjs — ONE shared HTML table tooltip for every chart.
//
// Canvas tooltips can't align columns or colour parts of a line, so every
// chart in the report uses this single external tooltip: a title, then a
// two-column table (white keys, orange values). Same layout everywhere —
// ui-ux consistency rule: tooltips look the same on every tab.
//
// A chart wires it up with:
//   tooltip: Object.assign({}, tooltipBase, { enabled:false, external: fn })
// where fn calls tipFor(context, build); build returns { title, rows } with
// rows = [[keyHtml, valueHtml], ...], or null to hide.

var tipEl = null;

function placeTip(el, rect, caretX, caretY) {
    var tw = el.offsetWidth, th = el.offsetHeight;
    var x = rect.left + caretX + 14;
    var y = rect.top + caretY - th / 2;
    if (x + tw > window.innerWidth - 8) x = rect.left + caretX - tw - 14;
    if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
    if (y < 8) y = 8;
    el.style.left = x + "px";
    el.style.top = y + "px";
}

function rowsToHtml(rows) {
    var h = '<table class="chart-tip-table">';
    rows.forEach(function (r) { h += '<tr><td class="ct-key">' + r[0] + '</td><td class="ct-val">' + r[1] + '</td></tr>'; });
    return h + "</table>";
}

/** Show the shared tooltip for a Chart.js hover. `build(context)` returns
 *  { title, rows } for the hovered element, or null to keep it hidden. */
export function tipFor(context, build) {
    if (!tipEl) {
        tipEl = document.createElement("div");
        tipEl.className = "chart-tip";
        document.body.appendChild(tipEl);
    }
    var tip = context.tooltip;
    if (!tip || tip.opacity === 0) { tipEl.style.opacity = "0"; return; }
    var out = null;
    try { out = build(context) || null; } catch { out = null; }
    if (!out) { tipEl.style.opacity = "0"; return; }
    tipEl.innerHTML = '<div class="chart-tip-title">' + out.title + "</div>" + rowsToHtml(out.rows);
    tipEl.style.opacity = "1";
    placeTip(tipEl, context.chart.canvas.getBoundingClientRect(), tip.caretX, tip.caretY);
}

/** Common hovered-row lookup: the data point index -> entry in `rows`
 *  (the same array the chart was built from). */
export function hoveredRow(context, rows) {
    var tip = context.tooltip;
    var dp = tip && tip.dataPoints && tip.dataPoints[0];
    return (dp && rows && rows[dp.dataIndex]) || null;
}

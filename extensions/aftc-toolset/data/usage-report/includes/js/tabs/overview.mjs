// tabs/overview.mjs — Overview tab: stat cards, period cards, daily + share charts.

import { fmtMoney, fmtInt, fmtTok, fmtPct, fmtMs, esc, INFO_SVG, bindHints, statCard, modelCell, modelLabel } from "../lib/format.mjs";
import { PALETTE, tooltipBase, chartsOk, chartFallback } from "../lib/charts.mjs";
import { tipFor, hoveredRow } from "../lib/tooltips.mjs";

// Tooltip data caches for the two Overview charts (the shared HTML table
// tooltip reads the hovered row from these — see lib/tooltips.mjs).
var dailySeriesCache = [];   // day points for the active daily chart
var sharePairsCache = [];    // pie slices for the active share chart

function dailyTip(context) {
  tipFor(context, function () {
    var p = hoveredRow(context, dailySeriesCache);
    if (!p) return null;
    var rows = [
      ["Cost:", fmtMoney(p.cost)],
      ["User prompts:", fmtInt(p.prompts)],
      ["AI prompts:", fmtInt(Math.max(0, (p.calls || 0) - (p.prompts || 0)))],
    ];
    if (p.mostCostlyModel) {
      rows.push(["Most costly:", modelCell(p.mostCostlyModel, p.mostCostlyProvider, p.mostCostlyLevel, fmtMoney(p.mostCostlyCost))]);
      if (p.cheapestModel && p.cheapestModel !== p.mostCostlyModel && p.cheapestCost > 0)
        rows.push(["Cheapest:", modelCell(p.cheapestModel, p.cheapestProvider, p.cheapestLevel, fmtMoney(p.cheapestCost))]);
    }
    if (p.longestTaskModel) rows.push(["Longest task:", modelCell(p.longestTaskModel, p.longestTaskProvider, p.longestTaskLevel, fmtMs(p.longestTaskMs))]);
    var title = context.tooltip.title && context.tooltip.title.length ? context.tooltip.title[0] : "";
    return { title: esc(title), rows: rows };
  });
}

function shareTip(context) {
  tipFor(context, function () {
    var p = hoveredRow(context, sharePairsCache);
    if (!p) return null;
    var total = sharePairsCache.reduce(function (s, x) { return s + (Number(x.cost) || 0); }, 0);
    var pct = total > 0 ? (Number(p.cost) / total * 100).toFixed(1) : "0.0";
    return {
      title: p.label === "Other" ? esc(p.label) : modelCell(p.label, p.provider, p.level),
      rows: [
        ["Cost:", fmtMoney(p.cost)],
        ["Share:", pct + "%"],
      ],
    };
  });
}

export class Overview {
  data = null;
  shareChart = null;

  constructor(data) {
    this.data = data;
  }

  render() {
    // Restore the last-chosen Cost share window (localStorage), default 1 Month.
    var sel = document.getElementById("share-period");
    if (sel) {
      var saved = null;
      try { saved = localStorage.getItem("usageSharePeriod"); } catch (e) { /* storage unavailable */ }
      var valid = false;
      if (saved) {
        (this.data.shareWindows || []).forEach(function (w) { if (w.key === saved) valid = true; });
      }
      sel.value = valid ? saved : "1m";
    }
    this.renderOverview();
    this.renderDailyChart();
    this.renderShareChart();
  }

  renderOverview() {
    var t = this.data.totals || {};
    var html = "";
    var uCount = Number(t.userPromptCount) || 0;
    var aCount = Number(t.automatedTurnCount) || 0;
    var ratio = uCount > 0 ? aCount / uCount : 0;
    html += statCard("Total cost", fmtMoney(t.totalCost), "avg "+fmtMoney(t.avgDailySpend)+" / day", true);
    html += statCard("Cost / completed task", t.avgCostPerTask != null ? fmtMoney(t.avgCostPerTask) : "N/A", fmtInt(t.completedTasks)+" tasks done", true);
    html += statCard("User prompts", fmtInt(t.userPromptCount), fmtInt(t.basePromptCount)+" tasks · "+fmtInt(t.subPromptCount)+" follow-ups");
    html += statCard("User / AI Prompts", fmtInt(uCount)+" / "+fmtInt(aCount),
      uCount > 0 ? "On average there are "+ratio.toFixed(1)+" AI prompts to 1 user prompt." : "No user prompts recorded yet.");
    html += statCard("Worst token burner", t.worstBurnModel ? modelCell(t.worstBurnModel, t.worstBurnProvider, t.worstBurnLevel) : "N/A",
      t.worstBurnModel ? fmtTok(t.worstBurnTokens)+" tokens (all time)" : "no usage recorded", false,
      "The model that used the most tokens (prompts, replies and cached context) since the start of the database. A fast burner fills its context window quickly.");
    html += statCard("Avg cache hit", fmtPct(t.avgCacheRate), fmtTok(t.totalCacheRead)+" cache-read tokens");
    document.getElementById("stat-grid").innerHTML = html;
    bindHints(document.getElementById("stat-grid"));

    var ph = "";
    var self = this;
    function scoreGroup(entries) {
      if (!entries || !entries.length) return "";
      var h = '<div class="period-score">';
      entries.forEach(function (e) {
        var valHtml = e.na
          ? '<span class="na-mark">N/A</span><span class="col-hint" data-tip="' + esc(e.na) + '">' + INFO_SVG + '</span>'
          : modelCell(e.model, e.provider, e.level, e.value);
        h += '<div class="period-score-row">'
          + '<span class="period-score-label">' + esc(e.label)
          + (e.hint ? '<span class="col-hint" data-tip="' + esc(e.hint) + '">' + INFO_SVG + '</span>' : '')
          + '</span>'
          + '<span class="period-score-val">' + valHtml + '</span></div>';
      });
      return h + '</div>';
    }
    ["24h","3d","lastWeek","thisWeek","lastMonth","thisMonth"].forEach(function (key) {
      var p = (self.data.periods || {})[key] || {};
      ph += '<div class="panel period-card"><div class="stat-label">' + esc(p.label || key) + '</div>'
        + '<div class="period-cost">' + fmtMoney(p.cost) + '</div>'
        + '<div class="stat-sub">Prompts: User ' + fmtInt(p.prompts) + ' / AI ' + fmtInt(p.aiPrompts) + '</div>'
        + '<hr class="period-hr">'
        + '<div class="period-sub best">Best AI Models</div>' + scoreGroup(p.best)
        + '<hr class="period-hr">'
        + '<div class="period-sub worst">Worst AI Models</div>' + scoreGroup(p.worst)
        + '</div>';
    });
    document.getElementById("period-grid").innerHTML = ph;
    bindHints(document.getElementById("period-grid"));
  }

  renderDailyChart() {
    if (!chartsOk){ chartFallback("chart-daily"); return; }
    var series = this.data.dailySeries || [];
    var canvas = document.getElementById("chart-daily");
    if (!canvas) return;
    var lastIdx = series.length - 1;
    dailySeriesCache = series;
    new window.Chart(canvas, {
      type: "bar",
      data: {
        labels: series.map(function(p){ return p.label; }),
        datasets: [{
          data: series.map(function(p){ return Number(p.cost)||0; }),
          backgroundColor: series.map(function(_,i){ return i === lastIdx ? "#fca02f" : "#4d8df6"; }),
          borderRadius: 3,
          maxBarThickness: 22,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, tooltipBase, {
            enabled: false,   // canvas tooltip off — the external HTML table tooltip renders instead
            external: dailyTip,
            callbacks: {
              title: function (items) { var it = items && items[0]; return it ? String(it.label) : ""; },
            },
          }),
        },
        scales: {
          x: { grid:{ display:false }, ticks:{ maxTicksLimit:10, maxRotation:0 } },
          y: { beginAtZero:true, ticks:{ maxTicksLimit:6, callback:function(v){ return fmtMoney(v); } }, grid:{ color:"rgba(139,148,167,.08)" } },
        },
      },
    });
  }

  shareWindowPairs() {
    var sel = document.getElementById("share-period");
    var key = sel ? sel.value : "1m";
    var win = null;
    (this.data.shareWindows || []).forEach(function(w){ if (w.key === key) win = w; });
    var rows;
    if (win) rows = (win.models || []).map(function(m){ return { modelName: m.name, provider: m.provider || "", level: m.level || "", cost: Number(m.cost) || 0 }; });
    else rows = ((this.data.modelsByPeriod || {}).all || []).slice();
    rows = rows.slice().sort(function(a,b){ return b.cost - a.cost; });
    var top = rows.slice(0, 7);
    var rest = rows.slice(7);
    var pairs = top.map(function(r){ return { label: r.modelName, provider: r.provider || "", level: r.thinkingLevel || r.level || "", cost: Number(r.cost) || 0 }; });
    if (rest.length){
      pairs.push({ label: "Other", cost: rest.reduce(function(s,r){ return s + (Number(r.cost) || 0); }, 0) });
    }
    // Drop slices that would format as 0.0% — invisible on the pie, legend clutter.
    var totalAll = pairs.reduce(function(s,p){ return s + p.cost; }, 0);
    if (totalAll > 0) pairs = pairs.filter(function(p){ return (p.cost / totalAll * 100) >= 0.05; });
    return pairs;
  }

  chartTotal(chart) {
    var ds = chart.data.datasets[0];
    return (ds && ds.data ? ds.data : []).reduce(function(s,v){ return s + (Number(v)||0); }, 0);
  }

  renderShareChart() {
    if (!chartsOk){ chartFallback("chart-share"); return; }
    var canvas = document.getElementById("chart-share");
    if (!canvas) return;
    var pairs = this.shareWindowPairs();
    sharePairsCache = pairs;
    if (!pairs.length){
      if (!this.shareChart){ chartFallback("chart-share", "No cost data recorded for this window."); }
      else {
        this.shareChart.data.labels = [];
        this.shareChart.data.datasets[0].data = [];
        this.shareChart.update();
      }
      return;
    }
    var labels = pairs.map(function(p){ return p.label === "Other" ? "Other" : modelLabel(p.label, p.provider, p.level); });
    var costs = pairs.map(function(p){ return p.cost; });
    if (this.shareChart){
      this.shareChart.data.labels = labels;
      this.shareChart.data.datasets[0].data = costs;
      this.shareChart.update();
      return;
    }
    var self = this;
    var centerTotal = {
      id: "centerTotal",
      afterDraw: function(chart){
        var meta = chart.getDatasetMeta(0);
        if (!meta.data[0]) return;
        var x = meta.data[0].x, y = meta.data[0].y;
        var c = chart.ctx;
        c.save();
        c.textAlign = "center"; c.textBaseline = "middle";
        c.fillStyle = "#e6e9ef";
        c.font = "700 16px " + window.Chart.defaults.font.family;
        c.fillText(fmtMoney(self.chartTotal(chart)), x, y - 8);
        c.fillStyle = "#8b94a7";
        c.font = "11px " + window.Chart.defaults.font.family;
        c.fillText("total", x, y + 10);
        c.restore();
      },
    };
    this.shareChart = new window.Chart(canvas, {
      type: "doughnut",
      data: { labels: labels, datasets: [{ data: costs, backgroundColor: PALETTE, borderColor: "#161a22", borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "62%",
        plugins: {
          legend: { position: window.innerWidth >= 860 ? "right" : "bottom",
            labels: { color:"#e6e9ef", boxWidth:10, boxHeight:10, padding:10, usePointStyle:true,
              generateLabels: function(chart){
                var ds = chart.data.datasets[0];
                var total = self.chartTotal(chart);
                return chart.data.labels.map(function(lbl, i){
                  var v = Number(ds.data[i])||0;
                  var pct = total>0 ? (v/total*100).toFixed(1) : "0.0";
                  // Multi-line label ([name, provider]) renders as two legend
                  // lines; the pct lands on the second line.
                  var text = Array.isArray(lbl)
                    ? [lbl[0], lbl[1]+" ("+pct+"%)"]
                    : lbl+" ("+pct+"%)";
                  // fontColor is read off the item with NO global fallback —
                  // omit it and the legend text renders black (canvas default).
                  return { text: text, fillStyle: ds.backgroundColor[i],
                    strokeStyle: ds.backgroundColor[i], pointStyle: "circle",
                    fontColor: "#e6e9ef", color: "#e6e9ef",
                    hidden: !chart.getDataVisibility(i), index: i };
                });
              } } },
          tooltip: Object.assign({}, tooltipBase, {
            enabled: false,   // canvas tooltip off — the external HTML table tooltip renders instead
            external: shareTip,
          }),
        },
      },
      plugins: [centerTotal],
    });
    var shareSel = document.getElementById("share-period");
    if (shareSel) shareSel.addEventListener("change", function(){
      try { localStorage.setItem("usageSharePeriod", shareSel.value); } catch (e) { /* storage unavailable */ }
      self.renderShareChart();
    });
  }
}

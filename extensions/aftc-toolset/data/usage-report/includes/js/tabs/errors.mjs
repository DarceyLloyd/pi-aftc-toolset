// tabs/errors.mjs — Errors tab: failed calls, provider reliability.
// Every assistant turn that ended with an error (rate limited, allowance
// exhausted, context window, overloaded, not found, auth, timeout,
// transport abort, network) is recorded in the errors table with
// the provider and HTTP code. Errors are PROVIDER issues (outages, rate
// limits, network faults hit every model on a provider), so the tab ranks
// providers: who fails most, for what reason, and which models were hit.
// User aborts are NOT errors — they are a stat on the Timings tab.

import { fmtInt, errorPill, ratePill, statCard, makeTable, dash, esc, rememberPeriod, savePeriod, modelLabel } from "../lib/format.mjs";
import { PALETTE, tooltipBase, chartsOk, chartFallback } from "../lib/charts.mjs";
import { tipFor, hoveredRow } from "../lib/tooltips.mjs";

export class ErrorsTab {
  data = null;
  period = rememberPeriod("err-period", "usageErrorsPeriod", "all");
  table = null;
  modelChart = null;
  typeChart = null;
  byModelChart = null;
  byModelRows = null;
  dailyDone = false;

  constructor(data) {
    this.data = data;
  }

  err() { return (this.data.errorStats || {})[this.period] || { total: 0, byType: [], byProvider: [], providerRates: [], byModel: [] }; }
  tool() { return (this.data.toolErrorStats || {})[this.period] || { total: 0, distinctTools: 0, byTool: [], byToolChart: [], byKind: [], topRepeat: null }; }

  render() {
    this.renderCards();
    var self = this;
    this.table = makeTable({
      tableId: "err-table",
      emptyId: "err-empty",
      defaultKey: "count",
      getRows: function () { return self.err().byProvider || []; },
      cols: [
        { key: "provider", label: "Provider", top: true, render: function (r) { return esc(r.provider || "(unknown)"); } },
        { key: "errorType", label: "Error type", render: function (r) { return errorPill(r.errorType); } },
        { key: "codes", label: "Code", num: true, center: true, render: function (r) { return r.codes ? esc(r.codes.split(",").join(", ")) : dash(null); } },
        { key: "count", label: "Failed calls", num: true, render: function (r) { return fmtInt(r.count); } },
        { key: "share", label: "% of all", num: true, render: function (r) {
            var total = self.err().total || 0;
            return total > 0 ? (r.count / total * 100).toFixed(1) + "%" : dash(null);
        } },
        { key: "models", label: "Affected models", top: true, render: function (r) { return esc(r.models); } },
        { key: "rate", label: "Error rate", num: true, hint: HINT_RATE, render: function (r) {
            var m = (self.err().providerRates || []).find(function (x) { return (x.provider || "") === (r.provider || ""); });
            return m ? ratePill(m.rate) : dash(null);
        } },
      ],
    });
    this.table.render();
    this.toolTable = makeTable({
      tableId: "tool-err-table",
      emptyId: "tool-err-empty",
      defaultKey: "count",
      getRows: function () { return self.tool().byTool || []; },
      cols: [
        { key: "tool", label: "Tool", top: true, render: function (r) { return esc(r.tool); } },
        { key: "errorKind", label: "Error type", top: true, render: function (r) { return toolPill(r.errorKind); } },
        { key: "count", label: "Errors", num: true, top: true, render: function (r) { return fmtInt(r.count); } },
        { key: "repeat", label: "Repeated", num: true, center: true, top: true, render: function (r) { return r.repeat > 1 ? fmtInt(r.repeat) + "x" : dash(null); } },
        { key: "models", label: "Affected models", top: true, render: function (r) { return esc(r.models || "(unknown)"); } },
        // Example is sanitized server-side (no user code, paths or URLs;
        // capped at 100 chars) and word-wraps inside the cell.
        { key: "example", label: "Example", top: true, wrap: true, render: function (r) { return esc(r.example || ""); } },
      ],
    });
    this.toolTable.render();
    this.renderToolCards();
    document.getElementById("err-period").addEventListener("change", function (e) {
      self.period = e.target.value;
      savePeriod("usageErrorsPeriod", e.target.value);
      var txt = e.target.options[e.target.selectedIndex].text.toLowerCase();
      document.getElementById("err-model-sub").textContent = txt;
      document.getElementById("err-type-sub").textContent = txt;
      document.getElementById("err-bymodel-sub").textContent = txt;
      document.getElementById("err-tool-sub").textContent = txt;
      self.renderCards();
      self.renderToolCards();
      self.table.render();
      self.toolTable.render();
      self.ensureCharts();
    });
  }

  renderToolCards() {
    var t = this.tool();
    var top = t.topRepeat;
    var html = "";
    html += statCard("Tool errors", fmtInt(t.total), "failed tool calls");
    html += statCard("Distinct tools", fmtInt(t.distinctTools), "that errored");
    html += statCard("Most-misused tool", t.byToolChart.length ? esc(t.byToolChart[0].tool) : "—", t.byToolChart.length ? fmtInt(t.byToolChart[0].count) + " errors" : "");
    html += statCard("Top repeated mistake", top ? esc(top.tool) + " · " + esc((top.errorKind || "").replace("-", " ")) : "—", top ? "repeated " + fmtInt(top.repeat) + "x" : "");
    document.getElementById("tool-err-cards").innerHTML = html;
    var note = document.getElementById("tool-err-note");
    note.textContent = t.total === 0
      ? "No tool errors in this period — every tool call succeeded."
      : "A tool error is a tool call that failed (wrong arguments, stale edit anchors, bad regex, missing files, timeouts). Provider failures (timeouts, 4xx/5xx, HTTP status codes) are the primary section above.";
    note.classList.toggle("estimate", t.total > 0);
  }

  ensureToolErrorChart() {
    var self = this;
    var c = document.getElementById("chart-err-tool");
    if (!c) return;
    if (!chartsOk) { chartFallback("chart-err-tool"); return; }
    var rows = (this.tool().byToolChart || []);
    this.toolChartRows = rows;
    var labels = rows.map(function (r) { return r.tool; });
    var vals = rows.map(function (r) { return r.count; });
    if (!this.toolChart) {
      this.toolChart = new window.Chart(c, {
        type: "bar",
        data: { labels: labels, datasets: [{ data: vals, backgroundColor: "#fca02f", borderRadius: 3, maxBarThickness: 18 }] },
        options: {
          indexAxis: "y", responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: Object.assign({}, tooltipBase, {
            enabled: false,
            external: function (context) {
              tipFor(context, function () {
                var r = hoveredRow(context, self.toolChartRows || []);
                if (!r) return null;
                return { title: esc(r.tool), rows: [["Tool errors", fmtInt(r.count)]] };
              });
            },
          }) },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "rgba(139,148,167,.08)" } },
            y: { grid: { display: false } },
          },
        },
      });
    } else {
      this.toolChart.data.labels = labels;
      this.toolChart.data.datasets[0].data = vals;
      this.toolChart.update();
    }
  }

  renderCards() {
    var e = this.err();
    var failingProviders = (e.byProvider || []).reduce(function (s, r) { return s.add(r.provider || "(unknown)"); }, new Set()).size;
    var completed = (e.providerRates || []).reduce(function (s, r) { return s + (Number(r.completedTasks) || 0); }, 0);
    var rate = completed > 0 ? (Number(e.total) / completed * 100) : 0;
    var top = (e.byType || [])[0];
    var ctxType = (e.byType || []).find(function (t) { return t.type === "context"; });
    var ctxCount = ctxType ? ctxType.count : 0;
    var html = "";
    html += statCard("Failed calls", fmtInt(e.total), "in this period");
    html += statCard("Error rate", rate.toFixed(1) + "%", "per " + fmtInt(completed) + " completed tasks");
    html += statCard("Failing providers", fmtInt(failingProviders), "with at least one failed call");
    html += statCard("Context window", fmtInt(ctxCount), "turns hit the context limit", false, HINT_CTX);
    html += statCard("Most common", top ? top.type.replace("-", " ") : "—", top ? fmtInt(top.count) + " calls" : "");
    document.getElementById("err-cards").innerHTML = html;
    var note = document.getElementById("err-note");
    note.textContent = e.total === 0
      ? "No failed calls in this period — every provider behaved."
      : "Failed calls are assistant turns that ended in an error. Your own aborts (Escape) are not errors — they are counted on the Timings tab.";
    note.classList.toggle("estimate", e.total > 0);
  }

  ensureCharts() {
    var self = this;
    var byProv = (this.err().byProvider || []).reduce(function (acc, r) {
      var k = r.provider || "(unknown)";
      if (!acc[k]) acc[k] = { name: k, count: 0 };
      acc[k].count += Number(r.count) || 0;
      return acc;
    }, {});
    var modelRows = Object.keys(byProv).map(function (k) { return byProv[k]; })
      .sort(function (a, b) { return b.count - a.count; }).slice(0, 8);
    this.provRows = modelRows;

    var c1 = document.getElementById("chart-err-model");
    if (c1) {
      if (!chartsOk) { chartFallback("chart-err-model"); }
      else {
        var labels1 = modelRows.map(function (r) { return r.name; });
        var vals1 = modelRows.map(function (r) { return r.count; });
        if (!this.modelChart) {
          this.modelChart = new window.Chart(c1, {
            type: "bar",
            data: { labels: labels1, datasets: [{ data: vals1, backgroundColor: "#ef6b6b", borderRadius: 3, maxBarThickness: 18 }] },
            options: {
              indexAxis: "y", responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: Object.assign({}, tooltipBase, {
                enabled: false,   // shared HTML table tooltip (lib/tooltips.mjs)
                external: function (context) {
                  tipFor(context, function () {
                    var r = hoveredRow(context, self.provRows || []);
                    if (!r) return null;
                    return { title: esc(r.name), rows: [["Failed calls", fmtInt(r.count)]] };
                  });
                },
              }) },
              scales: {
                x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "rgba(139,148,167,.08)" } },
                y: { grid: { display: false } },
              },
            },
          });
        } else {
          this.modelChart.data.labels = labels1;
          this.modelChart.data.datasets[0].data = vals1;
          this.modelChart.update();
        }
      }
    }

    var c2 = document.getElementById("chart-err-type");
    if (c2) {
      if (!chartsOk) { chartFallback("chart-err-type"); }
      else {
        var types = (this.err().byType || []).slice(0, 6);
        this.typeRows = types;
        var labels2 = types.map(function (r) { return r.type; });
        var vals2 = types.map(function (r) { return r.count; });
        if (!this.typeChart) {
          this.typeChart = new window.Chart(c2, {
            type: "doughnut",
            data: { labels: labels2, datasets: [{ data: vals2, backgroundColor: PALETTE, borderColor: "#161a22", borderWidth: 2 }] },
            options: {
              responsive: true, maintainAspectRatio: false, cutout: "58%",
              plugins: {
                legend: { position: window.innerWidth >= 860 ? "right" : "bottom", labels: { color: "#e6e9ef", boxWidth: 10, boxHeight: 10, padding: 10, usePointStyle: true } },
                tooltip: Object.assign({}, tooltipBase, {
                  enabled: false,   // shared HTML table tooltip (lib/tooltips.mjs)
                  external: function (context) {
                    tipFor(context, function () {
                      var r = hoveredRow(context, self.typeRows || []);
                      if (!r) return null;
                      return { title: errorPill(r.type), rows: [["Failed calls", fmtInt(r.count)]] };
                    });
                  },
                }),
              },
            },
          });
        } else {
          this.typeChart.data.labels = labels2;
          this.typeChart.data.datasets[0].data = vals2;
          this.typeChart.update();
        }
      }
    }

    var c3 = document.getElementById("chart-err-by-model");
    if (c3) {
      if (!chartsOk) { chartFallback("chart-err-by-model"); }
      else {
        var bm = (this.err().byModel || []).slice(0, 8);
        this.byModelRows = bm;
        // Thinking levels are merged server-side — a failed call is a
        // provider issue, so the chart reports model + provider only.
        var labels3 = bm.map(function (r) { return modelLabel(r.model, r.provider); });
        var vals3 = bm.map(function (r) { return r.count; });
        if (!this.byModelChart) {
          this.byModelChart = new window.Chart(c3, {
            type: "bar",
            data: { labels: labels3, datasets: [{ data: vals3, backgroundColor: "#ef6b6b", borderRadius: 3, maxBarThickness: 18 }] },
            options: {
              indexAxis: "y", responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: Object.assign({}, tooltipBase, {
                enabled: false,   // shared HTML table tooltip (lib/tooltips.mjs)
                external: function (context) {
                  tipFor(context, function () {
                    var r = hoveredRow(context, self.byModelRows || []);
                    if (!r) return null;
                    return { title: esc(r.model), rows: [["Provider", esc(r.provider || "(unknown)")], ["Failed calls", fmtInt(r.count)]] };
                  });
                },
              }) },
              scales: {
                x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "rgba(139,148,167,.08)" } },
                y: { grid: { display: false } },
              },
            },
          });
        } else {
          this.byModelChart.data.labels = labels3;
          this.byModelChart.data.datasets[0].data = vals3;
          this.byModelChart.update();
        }
      }
    }

    if (!this.dailyDone) { this.dailyDone = true; this.renderDaily(); }
    this.ensureToolErrorChart();
  }

  renderDaily() {
    if (!chartsOk) { chartFallback("chart-err-daily"); return; }
    var series = this.data.errorDailySeries || [];
    var canvas = document.getElementById("chart-err-daily");
    if (!canvas) return;
    var lastIdx = series.length - 1;
    new window.Chart(canvas, {
      type: "bar",
      data: {
        labels: series.map(function (p) { return p.label; }),
        datasets: [{
          data: series.map(function (p) { return p.count; }),
          backgroundColor: series.map(function (_, i) { return i === lastIdx ? "#fca02f" : "#ef6b6b"; }),
          borderRadius: 3,
          maxBarThickness: 22,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, tooltipBase, { callbacks: { label: function (item) { return " " + fmtInt(item.parsed.y) + " failed calls"; } } }),
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 10, maxRotation: 0 } },
          y: { beginAtZero: true, ticks: { maxTicksLimit: 6, precision: 0 }, grid: { color: "rgba(139,148,167,.08)" } },
        },
      },
    });
  }
}

var HINT_RATE = "The PROVIDER's failed calls ÷ its completed tasks in the period. Outages, rate limits and network faults hit every model on a provider, so reliability is judged per provider — not per model.";

var HINT_CTX = "Turns that failed because the prompt exceeded the model's context window. Clear context or start fresh to fix.";

function toolPill(kind) {
  var labels = { "invalid-args": "bad arguments", "stale-anchor": "stale edit anchor", "not-found": "not found", "bad-regex": "bad regex/flag", "permission": "permission", "timeout": "timeout", "network": "network", "missing-binary": "missing binary", "other": "other" };
  var t = String(kind || "other");
  var cls = t === "stale-anchor" || t === "invalid-args" || t === "bad-regex" ? "warn" : "info";
  return '<span class="pill ' + cls + '">' + esc(labels[t] || t) + '</span>';
}

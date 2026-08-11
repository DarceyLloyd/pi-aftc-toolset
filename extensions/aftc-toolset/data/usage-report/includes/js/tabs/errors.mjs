// tabs/errors.mjs — Errors tab: failed calls, the unreliable models.
// Every assistant turn that ended with an error (rate limited, overloaded,
// not found, auth, timeout, network) is recorded in the errors table. User
// aborts are NOT errors — they are a stat on the Timings tab. The table
// shames by model × error type with a fair error rate (errors ÷ completed
// tasks) so models used a lot are compared honestly.

import { fmtInt, fmtWhen, errorPill, ratePill, statCard, makeTable, dash } from "../lib/format.mjs";
import { PALETTE, tooltipBase, chartsOk, chartFallback } from "../lib/charts.mjs";

export class ErrorsTab {
  data = null;
  period = "all";
  table = null;
  modelChart = null;
  typeChart = null;
  dailyDone = false;

  constructor(data) {
    this.data = data;
  }

  err() { return (this.data.errorStats || {})[this.period] || { total: 0, byType: [], byModel: [], modelRates: [] }; }

  render() {
    this.renderCards();
    var self = this;
    this.table = makeTable({
      tableId: "err-table",
      emptyId: "err-empty",
      defaultKey: "count",
      getRows: function () { return self.err().byModel || []; },
      cols: [
        { key: "modelName", label: "Model" },
        { key: "errorType", label: "Error type", render: function (r) { return errorPill(r.errorType); } },
        { key: "count", label: "Failed calls", num: true, render: function (r) { return fmtInt(r.count); } },
        { key: "share", label: "% of all", num: true, render: function (r) {
            var total = self.err().total || 0;
            return total > 0 ? (r.count / total * 100).toFixed(1) + "%" : dash(null);
        } },
        { key: "lastTs", label: "Last seen", num: true, render: function (r) { return fmtWhen(r.lastTs); } },
        { key: "rate", label: "Error rate", num: true, hint: HINT_RATE, render: function (r) {
            var m = (self.err().modelRates || []).find(function (x) { return x.modelName === r.modelName; });
            return m ? ratePill(m.rate) : dash(null);
        } },
      ],
    });
    this.table.render();
    document.getElementById("err-period").addEventListener("change", function (e) {
      self.period = e.target.value;
      var txt = e.target.options[e.target.selectedIndex].text.toLowerCase();
      document.getElementById("err-model-sub").textContent = txt;
      document.getElementById("err-type-sub").textContent = txt;
      self.renderCards();
      self.table.render();
      self.ensureCharts();
    });
  }

  renderCards() {
    var e = this.err();
    var failingModels = (e.byModel || []).reduce(function (s, r) { return s.add(r.modelName); }, new Set()).size;
    var completed = (e.modelRates || []).reduce(function (s, r) { return s + (Number(r.completedTasks) || 0); }, 0);
    var rate = completed > 0 ? (Number(e.total) / completed * 100) : 0;
    var top = (e.byType || [])[0];
    var html = "";
    html += statCard("Failed calls", fmtInt(e.total), "in this period");
    html += statCard("Error rate", rate.toFixed(1) + "%", "per " + fmtInt(completed) + " completed tasks");
    html += statCard("Failing models", fmtInt(failingModels), "with at least one failed call");
    html += statCard("Most common", top ? top.type.replace("-", " ") : "—", top ? fmtInt(top.count) + " calls" : "");
    document.getElementById("err-cards").innerHTML = html;
    var note = document.getElementById("err-note");
    note.textContent = e.total === 0
      ? "No failed calls in this period — every model behaved."
      : "Failed calls are assistant turns that ended in an error. Your own aborts (Escape) are not errors — they are counted on the Timings tab.";
    note.classList.toggle("estimate", e.total > 0);
  }

  ensureCharts() {
    var self = this;
    var byModel = (this.err().byModel || []).reduce(function (acc, r) {
      if (!acc[r.modelName]) acc[r.modelName] = 0;
      acc[r.modelName] += Number(r.count) || 0;
      return acc;
    }, {});
    var modelRows = Object.keys(byModel).map(function (k) { return { name: k, count: byModel[k] }; })
      .sort(function (a, b) { return b.count - a.count; }).slice(0, 8);

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
              plugins: { legend: { display: false }, tooltip: Object.assign({}, tooltipBase, { callbacks: { label: function (item) { return " " + fmtInt(item.parsed.x) + " failed calls"; } } }) },
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
                tooltip: Object.assign({}, tooltipBase, { callbacks: { label: function (item) { return " " + item.label + ": " + fmtInt(item.parsed); } } }),
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

    if (!this.dailyDone) { this.dailyDone = true; this.renderDaily(); }
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

var HINT_RATE = "Failed calls ÷ completed tasks for this model in the period — a fair reliability score regardless of how often you use it.";

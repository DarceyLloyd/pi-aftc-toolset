// tabs/context.mjs — Context & Allowance tab.
// Context-window pressure per model × thinking level (start/end context, %
// of window, growth per task, tasks until the window fills, 5h burn in
// window equivalents, 1M-window feasibility) plus provider-reported
// 5h / weekly allowance consumption per task.

import { fmtInt, fmtTok, fmtPct, thinkingPill, ctxBar, flag1m, dash, statCard, makeTable, rememberPeriod, savePeriod } from "../lib/format.mjs";
import { PALETTE, tooltipBase, chartsOk, chartFallback } from "../lib/charts.mjs";

export class ContextTab {
  data = null;
  period = rememberPeriod("ctx-period", "usageContextPeriod", "all");
  ctxTable = null;
  allowTable = null;
  burnChart = null;

  constructor(data) {
    this.data = data;
  }

  ctx() { return (this.data.contextStats || {})[this.period] || []; }
  allow() { return (this.data.allowanceStats || {})[this.period] || []; }

  render() {
    this.renderCards();
    var self = this;
    this.ctxTable = makeTable({
      tableId: "ctx-table",
      emptyId: "ctx-empty",
      defaultKey: "avgEndPct",
      getRows: function () { return self.ctx(); },
      cols: [
        { key: "modelName", label: "Model" },
        { key: "thinkingLevel", label: "Thinking", render: function (r) { return thinkingPill(r.thinkingLevel); } },
        { key: "contextWindow", label: "Window", num: true, hint: HINT_WINDOW, render: function (r) { return r.contextWindow > 0 ? fmtTok(r.contextWindow) : dash(null); } },
        { key: "tasks", label: "Tasks", num: true, render: function (r) { return fmtInt(r.tasks); } },
        { key: "avgStartTokens", label: "Avg start", num: true, hint: HINT_START, render: function (r) { return r.avgStartTokens != null ? fmtTok(r.avgStartTokens) : dash(null); } },
        { key: "avgEndTokens", label: "Avg end", num: true, hint: HINT_END, render: function (r) { return r.avgEndTokens != null ? fmtTok(r.avgEndTokens) : dash(null); } },
        { key: "avgEndPct", label: "% window", num: true, render: function (r) { return r.avgEndPct != null ? ctxBar(r.avgEndPct) : dash(null); } },
        { key: "avgGrowth", label: "Growth / task", num: true, render: function (r) { return r.avgGrowth != null ? fmtTok(r.avgGrowth) : dash(null); } },
        { key: "tasksUntilFull", label: "Tasks to full", num: true, hint: HINT_TASKS_FULL, render: function (r) {
            if (r.tasksUntilFull == null) return dash(null);
            var n = Math.round(r.tasksUntilFull);
            var cls = n <= 3 ? "bad" : n <= 10 ? "warn" : "good";
            return '<span class="pill ' + cls + '">' + (n === 0 ? "full now" : n + " task" + (n === 1 ? "" : "s")) + "</span>";
        } },
        { key: "fiveHourBurn", label: "5h burn", num: true, render: function (r) { return fmtTok(r.fiveHourBurn); } },
        { key: "fiveHourWindows", label: "5h / window", num: true, hint: HINT_5H_WINDOWS, render: function (r) { return r.allowanceReported && r.fiveHourWindows != null ? r.fiveHourWindows.toFixed(1) + "x" : dash(null); } },
        { key: "millionFlag", label: "1M flag", render: function (r) { return r.allowanceReported ? flag1m(r.millionFlag) : dash(null); } },
      ],
    });
    this.ctxTable.render();

    this.allowTable = makeTable({
      tableId: "allow-table",
      emptyId: "allow-empty",
      defaultKey: "avg5hPerTask",
      getRows: function () { return self.allow(); },
      cols: [
        { key: "provider", label: "Provider" },
        { key: "tasks", label: "Tasks", num: true, render: function (r) { return fmtInt(r.tasks); } },
        { key: "avg5hPerTask", label: "5h % / task", num: true, hint: HINT_5H_TASK, render: function (r) { return r.avg5hPerTask != null ? r.avg5hPerTask.toFixed(2) + "%" : dash(null); } },
        { key: "avgWeeklyPerTask", label: "Weekly % / task", num: true, hint: HINT_WEEK_TASK, render: function (r) { return r.avgWeeklyPerTask != null ? r.avgWeeklyPerTask.toFixed(2) + "%" : dash(null); } },
        { key: "avg5hEnd", label: "5h used", num: true, render: function (r) { return r.avg5hEnd != null ? fmtPct(r.avg5hEnd / 100) : dash(null); } },
        { key: "avgWeeklyEnd", label: "Weekly used", num: true, render: function (r) { return r.avgWeeklyEnd != null ? fmtPct(r.avgWeeklyEnd / 100) : dash(null); } },
        { key: "fiveHourResets", label: "5h resets", num: true, hint: HINT_RESETS, render: function (r) { return fmtInt(r.fiveHourResets); } },
        { key: "tasksUntil5hFull", label: "Tasks to 5h full", num: true, render: function (r) {
            if (r.tasksUntil5hFull == null) return dash(null);
            var n = Math.round(r.tasksUntil5hFull);
            var cls = n <= 5 ? "bad" : n <= 20 ? "warn" : "good";
            return '<span class="pill ' + cls + '">' + (n === 0 ? "full now" : n + " task" + (n === 1 ? "" : "s")) + "</span>";
        } },
        { key: "tasksUntilWeeklyFull", label: "Tasks to weekly full", num: true, render: function (r) {
            if (r.tasksUntilWeeklyFull == null) return dash(null);
            var n = Math.round(r.tasksUntilWeeklyFull);
            var cls = n <= 10 ? "bad" : n <= 40 ? "warn" : "good";
            return '<span class="pill ' + cls + '">' + (n === 0 ? "full now" : n + " task" + (n === 1 ? "" : "s")) + "</span>";
        } },
      ],
    });
    this.allowTable.render();
    document.getElementById("ctx-period").addEventListener("change", function (e) {
      self.period = e.target.value;
      savePeriod("usageContextPeriod", e.target.value);
      document.getElementById("ctx-burn-sub").textContent = e.target.options[e.target.selectedIndex].text.toLowerCase() + " · context-window equivalents per 5h";
      self.renderCards();
      self.ctxTable.render();
      self.allowTable.render();
      self.ensureCharts();
    });
  }

  renderCards() {
    var t = this.data.totals || {};
    var latest = this.data.allowanceLatest || null;
    var html = "";
    html += statCard("5h token burn", fmtTok(t.fiveHourBurn), "input + output + cache-read, last 5 hours");
    html += statCard("7d token burn", fmtTok(t.sevenDayBurn), "last 7 days");
    html += statCard("1M-window rate", ((Number(t.fiveHourBurn) || 0) / 1000000).toFixed(1) + "x", "1M-token windows burned per 5h — >1x means a 1M window is unsustainable");
    html += statCard("5h allowance used", latest && latest.fiveHourUsed != null ? fmtPct(latest.fiveHourUsed / 100) : "N/A", latest ? latest.provider : "no provider allowance recorded");
    html += statCard("Weekly allowance used", latest && latest.weeklyUsed != null ? fmtPct(latest.weeklyUsed / 100) : "N/A", latest ? latest.provider : "no provider allowance recorded");
    document.getElementById("ctx-cards").innerHTML = html;
    var note = document.getElementById("ctx-note");
    note.textContent = this.ctx().length
      ? this.ctx().reduce(function (s, r) { return s + r.tasks; }, 0) + " tasks with context data in this period."
      : "No context data in this period.";
  }

  ensureCharts() {
    var canvas = document.getElementById("chart-ctx-burn");
    if (!canvas) return;
    if (!chartsOk) { chartFallback("chart-ctx-burn"); return; }
    var rows = this.ctx().slice()
      .filter(function (r) { return r.fiveHourBurn > 0; })
      .sort(function (a, b) { return b.fiveHourBurn - a.fiveHourBurn; }).slice(0, 8);
    var labels = rows.map(function (r) { return r.modelName; });
    var vals = rows.map(function (r) { return r.fiveHourWindows != null ? r.fiveHourWindows : 0; });
    if (!this.burnChart) {
      var self = this;
      this.burnChart = new window.Chart(canvas, {
        type: "bar",
        data: { labels: labels, datasets: [{ data: vals, backgroundColor: "#b388ff", borderRadius: 3, maxBarThickness: 18 }] },
        options: {
          indexAxis: "y", responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: Object.assign({}, tooltipBase, {
              callbacks: { label: function (item) {
                  var r = rows[item.dataIndex] || {};
                  return " " + (r.fiveHourWindows != null ? r.fiveHourWindows.toFixed(1) + "x window" : "n/a") + " · " + fmtTok(r.fiveHourBurn) + " tokens";
              } },
            }),
          },
          scales: {
            x: { beginAtZero: true, ticks: { callback: function (v) { return v + "x"; } }, grid: { color: "rgba(139,148,167,.08)" } },
            y: { grid: { display: false } },
          },
        },
      });
    } else {
      this.burnChart.data.labels = labels;
      this.burnChart.data.datasets[0].data = vals;
      this.burnChart.update();
    }
  }
}

var HINT_WINDOW = "The model's declared context window in tokens. 0 = pi did not report one.";
var HINT_START = "Average context at task START (what gets sent before the task grows it).";
var HINT_END = "Average context at task END (after the final answer, input-side).";
var HINT_TASKS_FULL = "How many tasks of the current average growth would fill the window (compaction pressure). 3 or fewer = the model is drowning in its own context.";
var HINT_5H_WINDOWS = "Context-window equivalents burned in the last 5 hours (5h tokens ÷ window). 1.0+ = you burn a whole window's worth of tokens every 5 hours.";
var HINT_5H_TASK = "Average % of the provider's 5-hour allowance this model's tasks consume (snapshot before vs after each task).";
var HINT_WEEK_TASK = "Average % of the provider's weekly allowance this model's tasks consume.";
var HINT_RESETS = "Tasks where the 5h window reset mid-task (end % < start %) — the delta for those is not averaged in.";

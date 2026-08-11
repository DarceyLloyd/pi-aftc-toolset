// tabs/models.mjs — Models tab: the hero / shame ranking.
// Sortable table of every model's cost, prompts, ratio, cache, context and
// task-time stats over the selected period, with verdict badges calling out
// the best and worst of each metric. $0 (subscription) models stay visible
// so they can still be judged on task time, ratio and context — only the
// COST verdicts are restricted to models that actually cost something.

import { fmtMoney, fmtInt, fmtMs, verdict, dash, makeTable,
  HINT_AVG_PUP, HINT_USER_AI, HINT_TASK_TIME } from "../lib/format.mjs";
import { tooltipBase, chartsOk, chartFallback } from "../lib/charts.mjs";

function computeVerdicts(rows) {
  var map = {};
  function add(name, label, kind, hint) {
    if (!name) return;
    if (!map[name]) map[name] = [];
    map[name].push({ label: label, kind: kind, hint: hint || "" });
  }
  // Cost verdicts need at least TWO paid models to compare — a single paid
  // model is neither "best value" nor "most expensive" on its own.
  var paid = rows.filter(function (r) { return r.cost > 0 && r.costPerTask > 0 && r.completedTasks > 0; });
  if (paid.length > 1) {
    var byCost = paid.slice().sort(function (a, b) { return a.costPerTask - b.costPerTask; });
    add(byCost[0].modelName, "Best value", "good", "Why: the lowest average cost per completed task of all paid models in this period.");
    add(byCost[byCost.length - 1].modelName, "Most expensive", "bad", "Why: the highest average cost per completed task of all paid models in this period.");
  }
  var withT = rows.filter(function (r) { return r.avgTaskMs > 0; });
  if (withT.length > 1) {
    var byT = withT.slice().sort(function (a, b) { return a.avgTaskMs - b.avgTaskMs; });
    add(byT[0].modelName, "Fastest", "good", "Why: the shortest average task time - it finishes its jobs quicker than the other models in this period.");
    add(byT[byT.length - 1].modelName, "Slowest", "bad", "Why: the longest average task time - it takes longer to finish its jobs than the other models in this period.");
  }
  var withUp = rows.filter(function (r) { return r.userPrompts > 0; });
  if (withUp.length > 1) {
    var byUp = withUp.slice().sort(function (a, b) { return a.aiPerUserPrompt - b.aiPerUserPrompt; });
    add(byUp[0].modelName, "Most efficient", "good", "Why: the fewest AI (self-prompted) turns per prompt you type - it does the least extra work on its own.");
    add(byUp[byUp.length - 1].modelName, "Auto-prompt hog", "bad", "Why: the most AI (self-prompted) turns per prompt you type - it keeps looping through tool calls on its own before finishing.");
  }
  var withErr = rows.filter(function (r) { return r.errorCount > 0; });
  if (withErr.length) {
    var byErr = withErr.slice().sort(function (a, b) { return b.errorCount - a.errorCount; });
    add(byErr[0].modelName, "Error-prone", "bad", "Why: the most failed calls in this period - the least reliable model you have used.");
  }
  // Context verdicts need at least TWO models with context data — with one
  // model the same model would be both the "hog" and the "low context" one.
  var withCtx = rows.filter(function (r) { return r.contextEndPct != null; });
  if (withCtx.length > 1) {
    var byCtx = withCtx.slice().sort(function (a, b) { return (a.contextEndPct || 0) - (b.contextEndPct || 0); });
    add(byCtx[byCtx.length - 1].modelName, "Context hog", "bad", "Why: it uses the highest share of its context window by the end of a task - it fills up the fastest.");
    add(byCtx[0].modelName, "Low context", "info", "Why: it uses the lowest share of its context window by the end of a task - it has the most room to spare.");
  }
  return map;
}

export class ModelsTab {
  data = null;
  period = "all";
  table = null;
  chart = null;

  constructor(data) {
    this.data = data;
  }

  render() {
    var self = this;
    this.table = makeTable({
      tableId: "models-table",
      emptyId: "models-empty",
      defaultKey: "costPerTurn",
      getRows: function () {
        return (self.data.modelsByPeriod || {})[self.period] || [];
      },
      cols: [
        { key: "modelName", label: "Model" },
        { key: "costPerTurn", label: "Turn Cost", num: true, center: true, hint: HINT_COST_TURN, render: function (r) { return fmtMoney(r.costPerTurn); } },
        { key: "costPerTask", label: "Avg Task $", num: true, hint: HINT_COST_TASK, render: function (r) {
            return r.costPerTask > 0 ? fmtMoney(r.costPerTask) + '<span class="sub-num">' + fmtInt(r.completedTasks) + ' task' + (r.completedTasks === 1 ? "" : "s") + '</span>' : "\u2014";
        } },
        { key: "userPrompts", label: "User / AI", num: true, hint: HINT_USER_AI, render: function (r) { return fmtInt(r.userPrompts) + " / " + fmtInt(r.aiPrompts); } },
        { key: "avgCostPerUserPrompt", label: "Avg $/Pup", num: true, center: true, hint: HINT_AVG_PUP, render: function (r) { return fmtMoney(r.avgCostPerUserPrompt); } },
        { key: "contextEndPct", label: "Context", num: true, center: true, hint: HINT_CONTEXT, render: function (r) { return r.contextEndPct != null ? (r.contextEndPct * 100).toFixed(0) + "%" : "\u2014"; } },
        { key: "errorCount", label: "Errors", num: true, center: true, hint: HINT_ERRORS, render: function (r) { return fmtInt(r.errorCount); } },
        { key: "avgTaskMs", label: "Task time", num: true, center: true, hint: HINT_TASK_TIME, render: function (r) { return fmtMs(r.avgTaskMs); } },
        { key: "verdicts", label: "Verdict", render: function (r) { return self.renderVerdicts(r); } },
      ],
    });
    this.table.render();
    document.getElementById("models-period").addEventListener("change", function (e) {
      self.period = e.target.value;
      document.getElementById("models-chart-sub").textContent = e.target.options[e.target.selectedIndex].text.toLowerCase();
      self.table.render();
      self.ensureCharts();
    });
  }

  renderVerdicts(r) {
    var vs = (this.verdictMap || {})[r.modelName] || [];
    return vs.length ? vs.map(function (v) { return verdict(v.label, v.kind, v.hint); }).join(" ") : "—";
  }

  ensureCharts() {
    var self = this;
    this.verdictMap = computeVerdicts((this.data.modelsByPeriod || {})[this.period] || []);
    this.table.render();
    var canvas = document.getElementById("chart-models");
    if (!canvas) return;
    if (!chartsOk) { chartFallback("chart-models"); return; }
    var rows = ((this.data.modelsByPeriod || {})[this.period] || []).slice()
      .sort(function (a, b) { return b.costPerTurn - a.costPerTurn; }).slice(0, 8);
    var labels = rows.map(function (r) { return r.modelName; });
    var costs = rows.map(function (r) { return r.costPerTurn; });
    if (!this.chart) {
      this.chart = new window.Chart(canvas, {
        type: "bar",
        data: { labels: labels, datasets: [{ data: costs, backgroundColor: "#fca02f", borderRadius: 3, maxBarThickness: 18 }] },
        options: {
          indexAxis: "y", responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: Object.assign({}, tooltipBase, {
              callbacks: { label: function (item) { return " " + fmtMoney(item.parsed.x); } },
            }),
          },
          scales: {
            x: { beginAtZero: true, ticks: { callback: function (v) { return fmtMoney(v); } }, grid: { color: "rgba(139,148,167,.08)" } },
            y: { grid: { display: false } },
          },
        },
      });
    } else {
      this.chart.data.labels = labels;
      this.chart.data.datasets[0].data = costs;
      this.chart.update();
    }
  }
}

var HINT_COST_TURN = "Average cost of one turn with this model (total cost ÷ turns in the period). Shows the model's price per turn, independent of how much you used it.";
var HINT_COST_TASK = "Average cost of one COMPLETED task: the task's recorded cost (turns joined by session + prompt) ÷ completed tasks. The true unit economics of a full run.";
var HINT_CONTEXT = "Average context used at task end ÷ the model's context window. Higher = the model fills its window faster (compaction pressure).";
var HINT_ERRORS = "Failed LLM calls in this period (network, rate limit, overloaded, 404, auth, timeout). Your own aborts are not errors.";

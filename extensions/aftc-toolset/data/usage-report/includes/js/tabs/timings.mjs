// tabs/timings.mjs — Timings tab: cards, charts, splits, longest-tasks table.

import { fmtInt, fmtMs, esc, thinkingPill, statCard, makeTable, rememberPeriod, savePeriod,
  HINT_TASK_TIME } from "../lib/format.mjs";
import { tooltipBase, chartsOk, chartFallback } from "../lib/charts.mjs";

var MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtWhen(ts){
  var d = new Date(Number(ts)||0);
  function p(n){ return String(n).padStart(2,"0"); }
  return d.getDate() + " " + MONTHS_SHORT[d.getMonth()] + ", " + p(d.getHours()) + ":" + p(d.getMinutes());
}

export class TimingsTab {
  data = null;
  period = rememberPeriod("timings-period", "usageTimingsPeriod", "all");
  longestTable = null;
  taskModelChart = null;
  taskModelRows = [];
  taskDailyChartDone = false;

  constructor(data) {
    this.data = data;
  }

  timingsWin() { return (this.data.timings || {})[this.period] || {}; }

  render() {
    var self = this;
    this.longestTable = makeTable({
      tableId: "longest-table",
      emptyId: "longest-empty",
      defaultKey: "taskMs",
      getRows: function(){ return self.timingsWin().longest || []; },
      cols: [
        { key:"timestamp", label:"When", render:function(r){ return fmtWhen(r.timestamp); } },
        { key:"modelName", label:"Model" },
        { key:"thinkingLevel", label:"Thinking", render:function(r){ return thinkingPill(r.thinkingLevel); } },
        { key:"turnCount", label:"Turns", num:true, render:function(r){ return fmtInt(r.turnCount); } },
        { key:"taskMs", label:"Task time", num:true, hint:HINT_TASK_TIME, render:function(r){ return fmtMs(r.taskMs); } },
      ],
    });
    this.renderTimingsCards();
    this.renderTimeSplit();
    this.renderTurnSplit();
    this.longestTable.render();
    document.getElementById("timings-period").addEventListener("change", function(e){
      self.period = e.target.value;
      savePeriod("usageTimingsPeriod", e.target.value);
      document.getElementById("task-model-sub").textContent = e.target.options[e.target.selectedIndex].text.toLowerCase();
      self.renderTimingsAll();
    });
  }

  renderTimingsCards() {
    var w = this.timingsWin();
    var html = "";
    html += statCard("Avg Task Time", fmtMs(w.avgTaskMs), "over " + fmtInt(w.completed) + " completed tasks");
    html += statCard("Longest task", fmtMs(w.maxTaskMs), w.maxTaskModel || "no completed tasks");
    html += statCard("Avg turns / task", (Number(w.avgTurnsPerTask)||0).toFixed(1), "per completed task");
    html += statCard("Errors & aborts", fmtInt((Number(w.errors)||0) + (Number(w.aborted)||0)),
      fmtInt(w.errors) + " errors · " + fmtInt(w.aborted) + " aborts - counted, never averaged");
    document.getElementById("timings-cards").innerHTML = html;
  }

  renderTimeSplit() {
    var w = this.timingsWin();
    var el = document.getElementById("time-split");
    var totalTask = Number(w.totalTaskMs)||0, think = Number(w.totalThinkMs)||0, resp = Number(w.totalRespMs)||0;
    if (totalTask <= 0){ el.innerHTML = '<div class="empty">No completed tasks in this period.</div>'; return; }
    function seg(ms, color, label){
      var pct = ms / totalTask * 100;
      return {
        bar: '<div class="split-seg" style="flex:' + (ms / totalTask) + ' 1 0%;background:' + color + '"></div>',
        legend: '<span><span class="dot" style="background:' + color + '"></span>' + label
          + ' <b>' + fmtMs(ms) + '</b> (' + pct.toFixed(1) + '%)</span>',
      };
    }
    var s1 = seg(think, "#b388ff", "Thinking");
    var s2 = seg(resp, "#4d8df6", "Responding");
    // Tools & overhead was dropped: task_ms minus per-turn think/respond
    // almost always measures 0, so the segment was noise. The empty tail of
    // the bar is any unaccounted remainder (tool waits, retries, compaction).
    el.innerHTML = '<div class="split-bar">' + s1.bar + s2.bar + '</div>'
      + '<div class="split-legend">' + s1.legend + s2.legend + '</div>';
  }

  renderTurnSplit() {
    var w = this.timingsWin();
    var rows = [
      ["User-prompt turns", Number(w.userTurns)||0, Number(w.userAvgThinkMs)||0, Number(w.userAvgRespMs)||0],
      ["AI (auto) turns", Number(w.aiTurns)||0, Number(w.aiAvgThinkMs)||0, Number(w.aiAvgRespMs)||0],
    ];
    var html = "<thead><tr><th>Turn kind</th><th class='num'>Turns</th><th class='num'>Avg think</th>"
      + "<th class='num'>Avg respond</th><th class='num'>Avg total</th></tr></thead><tbody>";
    rows.forEach(function(r){
      html += "<tr><td>" + esc(r[0]) + "</td><td class='num'>" + fmtInt(r[1]) + "</td><td class='num'>" + fmtMs(r[2])
        + "</td><td class='num'>" + fmtMs(r[3]) + "</td><td class='num'>" + fmtMs(r[2] + r[3]) + "</td></tr>";
    });
    document.getElementById("turn-split").innerHTML = html + "</tbody>";
  }

  ensureCharts() {
    var canvas = document.getElementById("chart-task-model");
    if (canvas){
      if (!chartsOk){ chartFallback("chart-task-model"); }
      else {
        var self = this;
        this.taskModelRows = (this.timingsWin().taskByModel || []).slice()
          .sort(function(a,b){ return b.avgTaskMs - a.avgTaskMs; }).slice(0, 8);
        var labels = this.taskModelRows.map(function(r){ return r.modelName; });
        var vals = this.taskModelRows.map(function(r){ return r.avgTaskMs; });
        if (!this.taskModelChart){
          this.taskModelChart = new window.Chart(canvas, {
            type: "bar",
            data: { labels: labels, datasets: [{ data: vals, backgroundColor: "#fca02f", borderRadius: 3, maxBarThickness: 18 }] },
            options: {
              indexAxis: "y", responsive: true, maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: Object.assign({}, tooltipBase, {
                  callbacks: { label: function(item){
                    var r = self.taskModelRows[item.dataIndex] || {};
                    return " " + fmtMs(item.parsed.x) + " avg · " + fmtInt(r.tasks) + " task" + ((Number(r.tasks)||0) === 1 ? "" : "s");
                  } },
                }),
              },
              scales: {
                x: { beginAtZero:true, ticks:{ callback:function(v){ return fmtMs(v); } }, grid:{ color:"rgba(139,148,167,.08)" } },
                y: { grid:{ display:false } },
              },
            },
          });
        } else {
          this.taskModelChart.data.labels = labels;
          this.taskModelChart.data.datasets[0].data = vals;
          this.taskModelChart.update();
        }
      }
    }
    if (!this.taskDailyChartDone){ this.taskDailyChartDone = true; this.renderTaskDailyChart(); }
  }

  renderTaskDailyChart() {
    if (!chartsOk){ chartFallback("chart-task-daily"); return; }
    var series = this.data.taskDailySeries || [];
    var canvas = document.getElementById("chart-task-daily");
    if (!canvas) return;
    var lastIdx = series.length - 1;
    new window.Chart(canvas, {
      type: "bar",
      data: {
        labels: series.map(function(p){ return p.label; }),
        datasets: [{
          data: series.map(function(p){ return Number(p.avgTaskMs)||0; }),
          backgroundColor: series.map(function(p, i){
            if ((Number(p.tasks)||0) === 0) return "rgba(139,148,167,.18)";
            return i === lastIdx ? "#fca02f" : "#4d8df6";
          }),
          borderRadius: 3,
          maxBarThickness: 22,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, tooltipBase, {
            callbacks: { label: function(item){
              var p = series[item.dataIndex] || {};
              var n = Number(p.tasks)||0;
              return n === 0 ? " No completed tasks" : ["Avg Task Time: " + fmtMs(p.avgTaskMs), "Completed tasks: " + fmtInt(n)];
            } },
          }),
        },
        scales: {
          x: { grid:{ display:false }, ticks:{ maxTicksLimit:10, maxRotation:0 } },
          y: { beginAtZero:true, ticks:{ maxTicksLimit:6, callback:function(v){ return fmtMs(v); } }, grid:{ color:"rgba(139,148,167,.08)" } },
        },
      },
    });
  }

  renderTimingsAll() {
    this.renderTimingsCards();
    this.renderTimeSplit();
    this.renderTurnSplit();
    this.longestTable.render();
    this.ensureCharts();
  }
}

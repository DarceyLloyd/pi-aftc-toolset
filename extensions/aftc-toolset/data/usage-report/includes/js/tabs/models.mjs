// tabs/models.mjs — Models tab: period selector, sortable table, cost-by-model chart.

import { fmtMoney, fmtInt, fmtMs, cachePill, makeTable,
  HINT_AI_PER_USER, HINT_AVG_PUP, HINT_AVG_CACHE, HINT_TASK_TIME } from "../lib/format.mjs";
import { tooltipBase, chartsOk, chartFallback } from "../lib/charts.mjs";

export class ModelsTab {
  data = null;
  period = "all";
  maxCost = 1;
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
      defaultKey: "cost",
      getRows: function(){
        var rows = (self.data.modelsByPeriod || {})[self.period] || [];
        self.maxCost = Math.max(1e-9, rows.reduce(function(s,r){ return Math.max(s, r.cost); }, 0));
        return rows;
      },
      cols: [
        { key:"modelName", label:"Model" },
        { key:"cost", label:"Cost", num:true, render:function(r){
            var pct = Math.max(r.cost > 0 ? 2 : 0, Math.min(100, r.cost / self.maxCost * 100));
            return '<div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:'+pct.toFixed(1)+'%"></div></div><span>'+fmtMoney(r.cost)+'</span></div>';
        } },
        { key:"userPrompts", label:"User prompts", num:true, render:function(r){ return fmtInt(r.userPrompts); } },
        { key:"aiPrompts", label:"AI prompts", num:true, render:function(r){ return fmtInt(r.aiPrompts); } },
        { key:"aiPerUserPrompt", label:"AI / user", num:true, hint:HINT_AI_PER_USER, render:function(r){ return (Number(r.aiPerUserPrompt)||0).toFixed(1); } },
        { key:"avgCostPerUserPrompt", label:"Avg $/Pup", num:true, hint:HINT_AVG_PUP, render:function(r){ return fmtMoney(r.avgCostPerUserPrompt); } },
        { key:"avgCacheRate", label:"Avg cache", num:true, hint:HINT_AVG_CACHE, render:function(r){ return cachePill(r.avgCacheRate); } },
        { key:"avgResponseMs", label:"Avg response", num:true, render:function(r){ return fmtMs(r.avgResponseMs); } },
        { key:"avgTaskMs", label:"Task time", num:true, hint:HINT_TASK_TIME, render:function(r){ return fmtMs(r.avgTaskMs); } },
      ],
    });
    this.table.render();
    document.getElementById("models-period").addEventListener("change", function(e){
      self.period = e.target.value;
      document.getElementById("models-chart-sub").textContent = e.target.options[e.target.selectedIndex].text.toLowerCase();
      self.table.render();
      self.ensureCharts();
    });
  }

  ensureCharts() {
    var canvas = document.getElementById("chart-models");
    if (!canvas) return;
    if (!chartsOk){ chartFallback("chart-models"); return; }
    var rows = ((this.data.modelsByPeriod || {})[this.period] || []).slice()
      .sort(function(a,b){ return b.cost - a.cost; }).slice(0, 8);
    var labels = rows.map(function(r){ return r.modelName; });
    var costs = rows.map(function(r){ return r.cost; });
    if (!this.chart){
      this.chart = new window.Chart(canvas, {
        type: "bar",
        data: { labels: labels, datasets: [{ data: costs, backgroundColor: "#fca02f", borderRadius: 3, maxBarThickness: 18 }] },
        options: {
          indexAxis: "y", responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: Object.assign({}, tooltipBase, {
              callbacks: { label: function(item){ return " "+fmtMoney(item.parsed.x); } },
            }),
          },
          scales: {
            x: { beginAtZero:true, ticks:{ callback:function(v){ return fmtMoney(v); } }, grid:{ color:"rgba(139,148,167,.08)" } },
            y: { grid:{ display:false } },
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

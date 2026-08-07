// tabs/thinking.mjs — Thinking levels tab: period selector + sortable table.

import { fmtMoney, fmtInt, fmtMs, cachePill, thinkingPill, makeTable,
  HINT_AVG_PUP, HINT_AVG_CACHE, HINT_TASK_TIME } from "../lib/format.mjs";

export class ThinkingTab {
  data = null;
  period = "all";
  table = null;

  constructor(data) {
    this.data = data;
  }

  render() {
    var self = this;
    this.table = makeTable({
      tableId: "thinking-table",
      emptyId: "thinking-empty",
      defaultKey: "cost",
      getRows: function(){ return (self.data.modelThinkingByPeriod || {})[self.period] || []; },
      cols: [
        { key:"modelName", label:"Model" },
        { key:"thinkingLevel", label:"Thinking", render:function(r){ return thinkingPill(r.thinkingLevel); } },
        { key:"cost", label:"Cost", num:true, render:function(r){ return fmtMoney(r.cost); } },
        { key:"userPrompts", label:"User prompts", num:true, render:function(r){ return fmtInt(r.userPrompts); } },
        { key:"aiPrompts", label:"AI prompts", num:true, render:function(r){ return fmtInt(r.aiPrompts); } },
        { key:"avgCostPerUserPrompt", label:"Avg $/Pup", num:true, hint:HINT_AVG_PUP, render:function(r){ return fmtMoney(r.avgCostPerUserPrompt); } },
        { key:"avgCacheRate", label:"Avg cache", num:true, hint:HINT_AVG_CACHE, render:function(r){ return cachePill(r.avgCacheRate); } },
        { key:"avgThinkingMs", label:"Avg think", num:true, render:function(r){ return fmtMs(r.avgThinkingMs); } },
        { key:"avgResponseMs", label:"Avg response", num:true, render:function(r){ return fmtMs(r.avgResponseMs); } },
        { key:"avgTaskMs", label:"Task time", num:true, hint:HINT_TASK_TIME, render:function(r){ return fmtMs(r.avgTaskMs); } },
      ],
    });
    this.table.render();
    document.getElementById("thinking-period").addEventListener("change", function(e){
      self.period = e.target.value;
      self.table.render();
    });
  }
}

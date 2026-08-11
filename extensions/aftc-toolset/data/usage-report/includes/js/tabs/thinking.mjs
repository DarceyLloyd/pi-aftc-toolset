// tabs/thinking.mjs — Thinking levels tab: period selector + sortable table.

import { fmtMoney, fmtInt, fmtMs, cachePill, thinkingPill, dash, makeTable, rememberPeriod, savePeriod,
  HINT_AVG_PUP, HINT_AVG_CACHE, HINT_USER_AI, HINT_TASK_TIME } from "../lib/format.mjs";

export class ThinkingTab {
  data = null;
  period = rememberPeriod("thinking-period", "usageThinkingPeriod", "all");
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
        { key:"provider", label:"Provider", hint:"Which provider this model runs through — same-named models from different providers are told apart here.", render:function(r){ return r.provider ? esc(r.provider) : dash(""); } },
        { key:"thinkingLevel", label:"Thinking", render:function(r){ return thinkingPill(r.thinkingLevel); } },
        { key:"cost", label:"Cost", num:true, render:function(r){ return fmtMoney(r.cost); } },
        { key:"costPerTask", label:"Avg Task $", num:true, center:true, render:function(r){ return r.costPerTask > 0 ? fmtMoney(r.costPerTask) : dash(null); } },
        { key:"userPrompts", label:"User / AI", num:true, center:true, hint:HINT_USER_AI, render:function(r){ return fmtInt(r.userPrompts)+" / "+fmtInt(r.aiPrompts); } },
        { key:"avgCostPerUserPrompt", label:"Avg $/Pup", num:true, center:true, hint:HINT_AVG_PUP, render:function(r){ return fmtMoney(r.avgCostPerUserPrompt); } },
        { key:"avgCacheRate", label:"Avg cache", num:true, center:true, hint:HINT_AVG_CACHE, render:function(r){ return cachePill(r.avgCacheRate); } },
        { key:"avgThinkingMs", label:"Avg think", num:true, center:true, render:function(r){ return fmtMs(r.avgThinkingMs); } },
        { key:"avgResponseMs", label:"Avg response", num:true, center:true, render:function(r){ return fmtMs(r.avgResponseMs); } },
        { key:"avgTaskMs", label:"Task time", num:true, center:true, hint:HINT_TASK_TIME, render:function(r){ return fmtMs(r.avgTaskMs); } },
      ],
    });
    this.table.render();
    document.getElementById("thinking-period").addEventListener("change", function(e){
      self.period = e.target.value;
      savePeriod("usageThinkingPeriod", e.target.value);
      self.table.render();
    });
  }
}

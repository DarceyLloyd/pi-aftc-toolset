// tabs/projections.mjs — Projections tab: cards, note, sortable per-model table.

import { fmtMoney, fmtInt, thinkingPill, statCard, makeTable } from "../lib/format.mjs";

export class ProjectionsTab {
  data = null;
  table = null;

  constructor(data) {
    this.data = data;
  }

  render() {
    this.renderProjCards();
    var self = this;
    this.table = makeTable({
      tableId: "proj-table",
      emptyId: "proj-empty",
      defaultKey: "costPerDay",
      getRows: function(){ return (self.data.projections || {}).rows || []; },
      cols: [
        { key:"modelName", label:"Model" },
        { key:"thinkingLevel", label:"Thinking", render:function(r){ return thinkingPill(r.thinkingLevel); } },
        { key:"activeDays", label:"Active days", num:true, render:function(r){ return fmtInt(r.activeDays); } },
        { key:"userPrompts", label:"Prompts (User / AI)", num:true, render:function(r){ return fmtInt(r.userPrompts)+' / '+fmtInt(r.aiPrompts); } },
        { key:"cost", label:"Total cost", num:true, render:function(r){ return fmtMoney(r.cost); } },
        { key:"costPerDay", label:"$ / day", num:true, render:function(r){ return fmtMoney(r.costPerDay)+self.estMark(r); } },
        { key:"costPerWeek", label:"$ / week", num:true, render:function(r){ return fmtMoney(r.costPerWeek)+self.estMark(r); } },
        { key:"costPerMonth", label:"$ / month", num:true, render:function(r){ return fmtMoney(r.costPerMonth)+self.estMark(r); } },
        { key:"costPerYear", label:"$ / year", num:true, render:function(r){ return fmtMoney(r.costPerYear)+self.estMark(r); } },
      ],
    });
    this.table.render();
  }

  estMark(r) {
    return r.estimated ? '<span class="est" title="Fewer than 7 active days recorded — estimate">~</span>' : '';
  }

  renderProjCards() {
    var p = this.data.projections || {};
    var html = "";
    html += statCard("Avg cost / day", fmtMoney(p.avgDailySpend), "all models · "+fmtInt(p.calendarDays)+" calendar days", true);
    html += statCard("Projected / month", fmtMoney(p.projectedMonth), "avg day × 30.4");
    html += statCard("Projected / year", fmtMoney(p.projectedYear), "avg day × 365");
    document.getElementById("proj-cards").innerHTML = html;
    var note = document.getElementById("proj-note");
    note.textContent = p.note || "";
    note.classList.toggle("estimate", !!p.estimated);
  }
}

// tabs/projections.mjs — Projections tab: usage-rate cost projections.
// Built from YOUR pace: completed tasks per active day × average cost per
// completed task (and turns per day × cost per turn). $0 models are omitted
// (nothing to project). A period selector scopes the rate the math is
// derived from.

import { fmtMoney, fmtInt, dash, statCard, makeTable } from "../lib/format.mjs";

export class ProjectionsTab {
  data = null;
  period = "all";
  table = null;

  constructor(data) {
    this.data = data;
  }

  proj() { return (this.data.projections || {})[this.period] || {}; }

  render() {
    this.renderProjCards();
    var self = this;
    this.table = makeTable({
      tableId: "proj-table",
      emptyId: "proj-empty",
      defaultKey: "projected30d",
      getRows: function () { return self.proj().rows || []; },
      cols: [
        { key: "modelName", label: "Model" },
        { key: "activeDays", label: "Active days", num: true, render: function (r) { return fmtInt(r.activeDays); } },
        { key: "completedTasks", label: "Tasks done", num: true, render: function (r) { return fmtInt(r.completedTasks); } },
        { key: "turns", label: "Turns", num: true, render: function (r) { return fmtInt(r.turns); } },
        { key: "costPerTurn", label: "$ / turn", num: true, render: function (r) { return fmtMoney(r.costPerTurn); } },
        { key: "costPerTask", label: "$ / task", num: true, render: function (r) { return r.costPerTask != null ? fmtMoney(r.costPerTask) : dash(null); } },
        { key: "tasksPerDay", label: "Tasks / day", num: true, render: function (r) { return r.tasksPerDay.toFixed(1); } },
        { key: "spendPerDay", label: "$ / day", num: true, render: function (r) { return fmtMoney(r.spendPerDay); } },
        { key: "projected7d", label: "Proj 7d", num: true, render: function (r) { return (r.projected7d != null ? fmtMoney(r.projected7d) : dash(null)) + self.estMark(r); } },
        { key: "projected30d", label: "Proj 30d", num: true, render: function (r) { return (r.projected30d != null ? fmtMoney(r.projected30d) : dash(null)) + self.estMark(r); } },
        { key: "projected90d", label: "Proj 90d", num: true, render: function (r) { return (r.projected90d != null ? fmtMoney(r.projected90d) : dash(null)) + self.estMark(r); } },
        { key: "projected365d", label: "Proj 365d", num: true, render: function (r) { return (r.projected365d != null ? fmtMoney(r.projected365d) : dash(null)) + self.estMark(r); } },
      ],
    });
    this.table.render();
    document.getElementById("proj-period").addEventListener("change", function (e) {
      self.period = e.target.value;
      self.renderProjCards();
      self.table.render();
    });
  }

  estMark(r) {
    return r.estimated ? '<span class="est" title="Fewer than 7 active days recorded — estimate">~</span>' : "";
  }

  renderProjCards() {
    var p = this.proj();
    var html = "";
    html += statCard("Avg cost / turn", fmtMoney(p.avgCostPerTurn), "all paid-cost models in this period", true);
    html += statCard("Avg cost / task", p.avgCostPerTask != null ? fmtMoney(p.avgCostPerTask) : "—", "per completed task · " + fmtInt(p.completedTasks) + " tasks done", true);
    html += statCard("Tasks / active day", (Number(p.tasksPerDay) || 0).toFixed(1), "pace the projection is built on");
    html += statCard("Proj next 30 days", p.projected30d != null ? fmtMoney(p.projected30d) : "—", "tasks/day × $/task", true);
    html += statCard("Proj next 365 days", p.projected365d != null ? fmtMoney(p.projected365d) : "—", "tasks/day × $/task", true);
    document.getElementById("proj-cards").innerHTML = html;
    var note = document.getElementById("proj-note");
    note.textContent = p.note || "";
    note.classList.toggle("estimate", !!p.estimated);
  }
}

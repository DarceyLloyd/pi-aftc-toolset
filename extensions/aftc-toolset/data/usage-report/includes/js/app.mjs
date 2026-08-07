// app.mjs — entry point: fetch data, boot all tabs, wire tab switching.

import { configureChartDefaults } from "./lib/charts.mjs";
import { Overview } from "./tabs/overview.mjs";
import { ModelsTab } from "./tabs/models.mjs";
import { ThinkingTab } from "./tabs/thinking.mjs";
import { TimingsTab } from "./tabs/timings.mjs";
import { ProjectionsTab } from "./tabs/projections.mjs";

async function main() {
  var data;
  try {
    var res = await fetch("./data.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    data = await res.json();
  } catch (err) {
    var failEl = document.getElementById("loading");
    if (failEl) failEl.textContent = "Failed to load report data (data.json): " + (err && err.message ? err.message : err);
    return;
  }

  var loading = document.getElementById("loading");
  if (loading) loading.remove();

  // ---------- header ----------
  var d = new Date(data.generatedAt || Date.now());
  function p(n){ return String(n).padStart(2,"0"); }
  document.getElementById("generated-at").textContent =
    "Generated on: " + String(d.getFullYear()).slice(2) + p(d.getMonth()+1) + p(d.getDate()) + " - " + p(d.getHours()) + ":" + p(d.getMinutes());

  configureChartDefaults();

  // ---------- boot tabs ----------
  var overview = new Overview(data);
  var modelsTab = new ModelsTab(data);
  var thinkingTab = new ThinkingTab(data);
  var timingsTab = new TimingsTab(data);
  var projectionsTab = new ProjectionsTab(data);

  overview.render();
  modelsTab.render();
  thinkingTab.render();
  timingsTab.render();
  projectionsTab.render();

  // ---------- tabs ----------
  var TAB_IDS = ["overview","models","thinking","timings","projections"];
  function activateTab(id){
    document.querySelectorAll(".tab").forEach(function(b){
      var on = b.dataset.tab === id;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".tab-panel").forEach(function(p){
      p.classList.toggle("hidden", p.id !== "panel-"+id);
    });
    if (history.replaceState) history.replaceState(null, "", "#"+id);
    if (id === "models") modelsTab.ensureCharts();
    if (id === "timings") timingsTab.ensureCharts();
  }
  document.querySelectorAll(".tab").forEach(function(b){
    b.addEventListener("click", function(){ activateTab(b.dataset.tab); });
  });
  var initialTab = (location.hash || "").replace("#","");
  if (TAB_IDS.indexOf(initialTab) < 0) initialTab = "overview";
  activateTab(initialTab);
}

main();

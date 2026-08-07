// lib/charts.mjs — Chart.js shared bits (ported from ref-client.js).

export var PALETTE = ["#fca02f","#4d8df6","#4ade80","#b388ff","#ef6b6b","#22d3ee","#facc15","#ff8fab","#2dd4bf","#94a3b8"];

// Evaluated once at module load: Chart.js is loaded by a classic <script> tag
// before this module runs, so window presence here is final.
export var chartsOk = typeof window !== "undefined" && typeof window.Chart !== "undefined";

export function configureChartDefaults(){
  if (!chartsOk) return;
  window.Chart.defaults.color = "#8b94a7";
  window.Chart.defaults.borderColor = "rgba(139,148,167,.12)";
  window.Chart.defaults.font.family = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
}

export function chartFallback(canvasId, msg){
  var c = document.getElementById(canvasId);
  if (!c) return;
  var d = document.createElement("div");
  d.className = "chart-fallback";
  d.textContent = msg || "Charts need network access to load Chart.js from the CDN — all tables and cards still work.";
  c.parentNode.replaceChild(d, c);
}

export var tooltipBase = { backgroundColor:"#1d2230", borderColor:"#2a3142", borderWidth:1, titleColor:"#e6e9ef", bodyColor:"#8b94a7", padding:10, displayColors:false };

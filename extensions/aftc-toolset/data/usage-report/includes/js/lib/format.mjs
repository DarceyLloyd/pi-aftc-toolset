// lib/format.mjs — formatters and markup helpers (ported from ref-client.js).
// Pure formatting/markup only; no data access.

export function fmtMoney(v){ v=Number(v)||0; var a=Math.abs(v); if(a===0) return "$0.00";
  var s; if(a<1) s=v.toFixed(4); else if(a<1000) s=v.toFixed(2);
  else s=String(Math.round(v));
  var parts=s.split("."); parts[0]=parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,",");
  return "$"+parts.join("."); }

export function fmtInt(v){ return (Number(v)||0).toLocaleString("en-US"); }

export function fmtTok(v){ v = Number(v)||0; if (v>=1e9) return (v/1e9).toFixed(1)+"B"; if (v>=1e6) return (v/1e6).toFixed(1)+"M"; if (v>=1e3) return (v/1e3).toFixed(1)+"K"; return String(Math.round(v)); }

export function fmtPct(v){ return ((Number(v)||0)*100).toFixed(1)+"%"; }

export function fmtMs(ms){ ms=Number(ms)||0; if(ms<=0) return "0s";
  var t=Math.round(ms/1000),h=Math.floor(t/3600),m=Math.floor((t%3600)/60),s=t%60,p=[];
  if(h>0) p.push(h+"h"); if(m>0) p.push(m+"m"); if(s>0||p.length===0) p.push(s+"s");
  return p.join(" "); }

export function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

export function cachePill(rate){ var p=(Number(rate)||0)*100; var cls = p>=60?"good":p>=30?"warn":"bad"; return '<span class="pill '+cls+'">'+p.toFixed(1)+"%</span>"; }

export function thinkingPill(level){
  var l = String(level||"").toLowerCase(); var cls = "";
  if (l==="high"||l==="xhigh") cls = " high";
  else if (l==="medium"||l==="med") cls = " medium";
  else if (l==="low"||l==="off"||l==="minimal") cls = " low";
  return '<span class="lvl'+cls+'">'+esc(level)+'</span>';
}

export function fmtWhen(ts){
  var d = new Date(Number(ts)||0);
  function p(n){ return String(n).padStart(2,"0"); }
  return d.getDate()+" "+["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]+", "+p(d.getHours())+":"+p(d.getMinutes());
}

// Verdict badges for the Models tab (hero / shame markers).
// `hint` renders a "why" info tooltip on hover (same tooltip as the
// column info icons). Text is non-selectable via CSS (.verdict).
export function verdict(label, kind, hint){
  var cls = kind === "good" ? "verdict good" : kind === "bad" ? "verdict bad" : "verdict info";
  return '<span class="'+cls+'"' + (hint ? ' data-tip="'+esc(hint)+'"' : '') + '>'+esc(label)+'</span>';
}

export var ERROR_TYPES = {
  "rate-limit":"Rate limited", "overloaded":"Overloaded", "not-found":"Not found",
  "auth":"Auth", "timeout":"Timeout", "network":"Network", "other":"Other",
};

export function errorPill(type){
  var t = String(type||"other");
  var label = ERROR_TYPES[t] || t;
  var cls = t === "network" || t === "overloaded" || t === "rate-limit" ? "bad"
    : t === "not-found" || t === "auth" || t === "timeout" ? "warn" : "info";
  return '<span class="pill '+cls+'">'+esc(label)+'</span>';
}

// Rate pill for error rate (errors per completed task).
export function ratePill(rate){
  var r = Number(rate)||0;
  var cls = r === 0 ? "good" : r < 0.1 ? "warn" : "bad";
  return '<span class="pill '+cls+'">'+(r === 0 ? "0%" : (r*100).toFixed(0)+"%")+'</span>';
}

// Context-window fill bar (pct 0..1).
export function ctxBar(pct){
  var p = Math.max(0, Math.min(100, (Number(pct)||0)*100));
  var cls = p >= 80 ? "bad" : p >= 50 ? "warn" : "good";
  return '<div class="ctx-cell"><div class="ctx-fill '+cls+'" style="width:'+p.toFixed(1)+'%"></div></div><span>'+p.toFixed(0)+'%</span>';
}

// 1M-context-window flag (burn rate too fast to sustain a 1M window).
export function flag1m(flag){
  return flag ? '<span class="pill bad" title="Burns more than 1,000,000 tokens per 5 hours — a 1M context window cannot be sustained at this burn rate">1M window impossible</span>' : "";
}

// Null-safe table cell.
export function dash(v){ return (v === null || v === undefined || v === "") ? "\u2014" : String(v); }

export function statCard(label, valueHtml, sub, money, hint){
  return '<div class="panel stat"><div class="stat-label">'+esc(label)
    + (hint ? '<span class="col-hint" data-tip="'+esc(hint)+'">'+INFO_SVG+'</span>' : '')
    + '</div>'
    + '<div class="stat-value'+(money ? " money" : "")+'">'+valueHtml+'</div>'
    + (sub ? '<div class="stat-sub">'+esc(sub)+'</div>' : '') + '</div>';
}

// ---------- column info hints ----------
export var INFO_SVG = '<svg class="info-i" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">'
  + '<circle cx="8" cy="8" r="6.8" fill="none" stroke="currentColor" stroke-width="1.4"/>'
  + '<circle cx="8" cy="5" r="1.1" fill="currentColor"/>'
  + '<rect x="7.1" y="7.2" width="1.8" height="4.6" rx="0.9" fill="currentColor"/></svg>';

export var HINT_AI_PER_USER = "Average number of AI (self-prompted) turns per user prompt - how many tool-call loops the model runs for each prompt you type. Lower is more efficient.";
export var HINT_AVG_PUP = "Average cost per user prompt: total cost ÷ user prompts on paid turns. Free / $0 (subscription) turns are excluded so they don't drag the average down.";
export var HINT_AVG_CACHE = "Average cache hit rate per turn: cached tokens ÷ (cached + new input tokens). Higher means cheaper, faster repeat context.";
export var HINT_USER_AI = "Prompts you typed / AI turns the model ran on its own (tool-call loops) for this model in the period. A high AI number means the model does a lot of its own work per prompt.";
export var HINT_TASK_TIME = "Task Time: This is how long the AI took to fully handle a prompt and return control.";
// (N/A tooltip reasons come from the data — each na row carries its own.)

var colTip = null;
function showColTip(anchor, text){
  if (!colTip){ colTip = document.createElement("div"); colTip.className = "col-tip"; document.body.appendChild(colTip); }
  colTip.textContent = text;
  colTip.style.visibility = "hidden";
  colTip.classList.add("show");
  var r = anchor.getBoundingClientRect();
  var tw = colTip.offsetWidth, th = colTip.offsetHeight;
  var x = Math.min(Math.max(8, r.left + r.width/2 - tw/2), window.innerWidth - tw - 8);
  var y = r.bottom + 8;
  if (y + th > window.innerHeight - 8) y = Math.max(8, r.top - th - 8);
  colTip.style.left = x+"px"; colTip.style.top = y+"px";
  colTip.style.visibility = "";
}
function hideColTip(){ if (colTip) colTip.classList.remove("show"); }

export function bindHints(scope){
  // .col-hint = the info icons; .verdict[data-tip] = verdict badges with a
  // "why" explanation. Both show the same hover tooltip.
  scope.querySelectorAll(".col-hint, .verdict[data-tip]").forEach(function(el){
    el.addEventListener("mouseenter", function(){ showColTip(el, el.dataset.tip || ""); });
    el.addEventListener("mouseleave", hideColTip);
    el.addEventListener("click", function(e){ e.stopPropagation(); showColTip(el, el.dataset.tip || ""); });
  });
}

// ---------- period-selector localStorage memory (all tab period selects) ----------
// Restore the last-chosen period from localStorage (validated against the
// select's options); falls back to the default when nothing is stored.
// Returns the active key. Call in the tab class field initializer.
export function rememberPeriod(selectId, storageKey, defaultValue){
  var sel = document.getElementById(selectId);
  if (!sel) return defaultValue;
  var saved = null;
  try { saved = localStorage.getItem(storageKey); } catch (e) { /* storage unavailable */ }
  var valid = false;
  Array.prototype.forEach.call(sel.options, function(o){ if (o.value === saved) valid = true; });
  if (valid) sel.value = saved;
  else sel.value = defaultValue;
  return sel.value;
}

/** Persist a period selector's choice (no-op when storage is unavailable). */
export function savePeriod(storageKey, value){
  try { localStorage.setItem(storageKey, value); } catch (e) { /* storage unavailable */ }
}

// ---------- sortable table factory ----------
export function makeTable(opts){
  var state = { key: opts.defaultKey, dir: opts.defaultDir || "desc" };
  var table = document.getElementById(opts.tableId);
  table.innerHTML = "";
  var thead = document.createElement("thead");
  var htr = document.createElement("tr");
  opts.cols.forEach(function(c){
    var th = document.createElement("th");
    if (c.num) th.className = "num";
    if (c.center) th.className = (th.className ? th.className + " " : "") + "center";
    th.dataset.key = c.key;
    th.innerHTML = esc(c.label)
      + (c.hint ? '<span class="col-hint" data-tip="'+esc(c.hint)+'">'+INFO_SVG+'</span>' : '')
      + '<span class="arrow">↓</span>';
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);
  var tbody = document.createElement("tbody");
  table.appendChild(tbody);
  bindHints(table);

  function updateHead(){
    table.querySelectorAll("thead th").forEach(function(th){
      var on = th.dataset.key === state.key;
      th.classList.toggle("sorted", on);
      var a = th.querySelector(".arrow");
      if (a) a.textContent = on ? (state.dir === "asc" ? "↑" : "↓") : "↓";
    });
  }
  function render(){
    var rows = (opts.getRows() || []).slice();
    var empty = document.getElementById(opts.emptyId);
    if (!rows.length){ tbody.innerHTML = ""; empty.hidden = false; updateHead(); return; }
    empty.hidden = true;
    rows.sort(function(a,b){
      var av = a[state.key], bv = b[state.key];
      var d = state.dir === "asc" ? 1 : -1;
      if (typeof av === "string") return String(av).localeCompare(String(bv)) * d;
      return ((Number(av)||0) - (Number(bv)||0)) * d;
    });
    var html = "";
    rows.forEach(function(r){
      html += "<tr>";
      opts.cols.forEach(function(c){
        html += '<td class="'+(c.num ? "num" : "")+(c.center ? " center" : "")+'">'+(c.render ? c.render(r) : esc(r[c.key]))+"</td>";
      });
      html += "</tr>";
    });
    tbody.innerHTML = html;
    // Re-bind hover tooltips after every render — body cells (eg verdict
    // badges) are fresh DOM each time, so they need listeners per render.
    bindHints(tbody);
    updateHead();
  }
  table.querySelectorAll("thead th").forEach(function(th){
    th.addEventListener("click", function(){
      var k = th.dataset.key;
      if (state.key === k) state.dir = state.dir === "asc" ? "desc" : "asc";
      else { state.key = k; state.dir = th.classList.contains("num") ? "desc" : "asc"; }
      render();
    });
  });
  return { render: render };
}

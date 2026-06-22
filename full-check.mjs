import { createJiti } from "file:///C:/Users/Darcey/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);

const ROOT = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");
const dbPath = `${ROOT}/.pi-aftc-toolset/data/turns.db`;
const jiti = createJiti(ROOT, { interopDefault: true });

// ---------- 1. Parse all TypeScript modules via jiti ----------
console.log("=== PARSE CHECK ===");
const files = ["core.ts", "help.ts", "usage.ts", "index.ts", "db.ts", "thinking.ts", "install.ts", "input-clear.ts", "paths.ts", "types.ts"];
for (const f of files) {
  try {
    jiti(`${ROOT}/extensions/toolset/` + f);
    console.log("  " + f + " OK");
  } catch (e) {
    console.error("  " + f + " ERROR:", e.message);
    if (e.stack) console.error(e.stack.split("\n").slice(0, 12).join("\n"));
    process.exit(1);
  }
}

// ---------- 2. Wire up real DB + collect data ----------
console.log("\n=== DATA COLLECTION ===");
const Database = require("better-sqlite3");
const db = new Database(dbPath, { readonly: true });
const rowCount = db.prepare("SELECT COUNT(*) AS n FROM turns").get().n;
const calDays = db.prepare("SELECT COUNT(DISTINCT date(timestamp / 1000, 'unixepoch', 'localtime')) AS n FROM turns").get().n;
db.close();
console.log("  DB: " + rowCount + " rows, " + calDays + " calendar days");

const { createUsageModule } = jiti(`${ROOT}/extensions/toolset/usage.ts`);
const fakePi = { registerCommand() {}, exec: async () => ({ code: 0, stdout: "", stderr: "", killed: false }) };
const inst = createUsageModule(fakePi);
const data = inst.collectReportData();
if (!data) { console.error("FAIL: collectReportData returned null"); process.exit(1); }

// ---------- 3. Validate projection schema per model ----------
console.log("\n=== PROJECTION VALIDATION ===");
let projOk = true;
const HORIZONS = ["6h", "12h", "1d", "7d", "30d"];
const EXPECTED_HOURS = { "6h": 6, "12h": 12, "1d": 24, "7d": 168, "30d": 720 };

for (const m of data.models) {
  console.log("  Model: " + m.modelName);
  if (!Array.isArray(m.projections)) { console.error("    FAIL: projections not an array"); projOk = false; continue; }
  if (m.projections.length !== HORIZONS.length) { console.error("    FAIL: expected " + HORIZONS.length + " projections, got " + m.projections.length); projOk = false; continue; }

  for (let i = 0; i < HORIZONS.length; i++) {
    const p = m.projections[i];
    if (p.horizon !== HORIZONS[i]) { console.error("    FAIL: wrong horizon: " + p.horizon); projOk = false; }
    if (p.horizonHours !== EXPECTED_HOURS[p.horizon]) { console.error("    FAIL: wrong horizonHours for " + p.horizon + ": " + p.horizonHours); projOk = false; }
    if (p.sufficientData) {
      if (p.predictedCost === null) { console.error("    FAIL: sufficientData=true but predictedCost=null for " + p.horizon); projOk = false; }
      // Re-derive predictedCost from the formula: turnsPerHour × avgCost × horizonHours
      const rederive = p.turnsPerHour * m.averages.avgCost * p.horizonHours;
      const eps = 0.0001;
      if (Math.abs(rederive - p.predictedCost) > eps) {
        console.error("    FAIL: predictedCost mismatch for " + p.horizon + ": stored=" + p.predictedCost.toFixed(6) + " vs rederive=" + rederive.toFixed(6));
        projOk = false;
      } else {
        console.log("    " + p.horizon + ": $" + p.predictedCost.toFixed(4) + " (rate=" + p.turnsPerHour.toFixed(2) + " t/h, window=" + p.windowActiveHours.toFixed(2) + "h, " + p.windowTurns + " turns)");
      }
    } else {
      if (p.predictedCost !== null) { console.error("    FAIL: sufficientData=false but predictedCost=" + p.predictedCost); projOk = false; }
      console.log("    " + p.horizon + ": N/A (rate=" + p.turnsPerHour.toFixed(2) + " t/h, window=" + p.windowActiveHours.toFixed(2) + "h, " + p.windowTurns + " turns)");
    }
  }
}

if (!projOk) { console.error("\nFAIL: projection validation"); process.exit(1); }

// ---------- 4. Cross-check: projection uses base-prompt pace ----------
// Projection rate is now: base user prompts/hour × model avg turns/base-prompt.
console.log("\n=== CROSS-CHECK: base-prompt projection rate ===");
const db2 = new Database(dbPath, { readonly: true });
const sixHrAgo = Date.now() - 6 * 3600_000;
const w6 = db2.prepare(
  `SELECT COUNT(*) AS turns,
          COALESCE(SUM(base_prompt), 0) AS base_prompts,
          MIN(timestamp) AS first_turn,
          MAX(timestamp) AS last_turn
   FROM turns WHERE timestamp >= ?`
).get(sixHrAgo);
db2.close();
const spanH = Math.max(0.5, (w6.last_turn - w6.first_turn) / 3600_000);
const basePromptRate = w6.base_prompts / spanH;
console.log("  SQL 6h window: " + w6.turns + " turns, " + w6.base_prompts + " base prompts, span=" + spanH.toFixed(3) + "h");
console.log("  Base prompt rate: " + basePromptRate.toFixed(4) + " prompts/h");
for (const m of data.models) {
  const p6 = m.projections.find(x => x.horizon === "6h");
  if (p6) {
    const expected = basePromptRate * Math.max(1, m.averages.avgTurnsPerBasePrompt || 1);
    const drift = Math.abs(p6.turnsPerHour - expected);
    if (drift > 0.01) {
      console.error("  FAIL: " + m.modelName + " effective rate " + p6.turnsPerHour.toFixed(4) + " differs from expected " + expected.toFixed(4));
      projOk = false;
    } else {
      console.log("  OK " + m.modelName + " effective rate: " + p6.turnsPerHour.toFixed(4) + " calls/h");
    }
  }
}
if (!projOk) { console.error("\nFAIL: cross-check"); process.exit(1); }

// ---------- 5. Generate HTML & verify structure ----------
console.log("\n=== HTML GENERATION ===");
const html = inst.generateReportHtml(data);
fs.writeFileSync(`${ROOT}/.pi-aftc-toolset/data/report.html`, html, "utf8");
console.log("  wrote " + html.length + " bytes");

// Required IDs include new projections ones
const requiredIds = [
  "generated-at", "period-tabs", "most-used", "summary",
  "lifetime-totals", "daily-trend-chart", "daily-table", "daily-tbody", "daily-empty",
  "thinking-table", "thinking-tbody", "thinking-empty",
  "models-table", "models-tbody", "models-empty", "report-data",
  "proj-grid", "proj-empty",
];
let allOk = true;
for (const id of requiredIds) {
  if (!html.includes('id="' + id + '"')) {
    console.error("  FAIL: missing id: " + id);
    allOk = false;
  } else {
    console.log("  OK id: " + id);
  }
}

// Check the 6 header cells of proj-grid with data-sort-p
const expectedHeadKeys = ["modelName", "h6", "h12", "d1", "d7", "d30"];
for (const k of expectedHeadKeys) {
  if (!html.includes('data-sort-p="' + k + '"')) {
    console.error("  FAIL: missing sort key: " + k);
    allOk = false;
  } else {
    console.log("  OK sort key: " + k);
  }
}

// Check CSS rules present
const cssChecks = ["proj-grid", "proj-cell.head", "proj-cell .na"];
for (const cls of cssChecks) {
  if (!html.includes(cls)) { console.error("  FAIL: missing CSS: " + cls); allOk = false; }
  else console.log("  OK css: " + cls);
}

// JS syntax/parse check via stub DOM
const m2 = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m2) { console.error("  FAIL: no module script"); allOk = false; }
else {
  // Don't pre-declare `data` — the module script does its own `const data = JSON.parse(...)`.
  // The stub DOM just needs to exist and provide enough scaffolding.
  const stubs = `
    const _els = {};
    const _fakeEl = (id) => ({
      textContent: id === "report-data" ? "{}" : "",
      innerHTML: "", id, style: {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} },
      addEventListener: function() {}, appendChild() {}, querySelectorAll: () => [],
      querySelector: () => null, getBoundingClientRect: () => ({}), dataset: {},
      lastElementChild: null, children: { length: 0 },
    });
    const document = {
      getElementById: (id) => _els[id] || (_els[id] = _fakeEl(id)),
      createElement: () => ({ className: "", innerHTML: "", style: {}, appendChild() {} }),
      querySelectorAll: () => [],
    };
  `;
  const fullScript = stubs + "\n" + m2[1];
  try {
    new Function(fullScript)();
    console.log("  OK Module script executes (DOM-stubbed, empty JSON)");
  } catch (e) {
    if (e instanceof SyntaxError) {
      console.error("  FAIL SyntaxError: " + e.message);
      allOk = false;
    } else {
      // Runtime errors are expected — stubs don't implement full DOM
      console.log("  OK no syntax error (stub runtime: " + e.message + ")");
    }
  }
}

console.log(allOk ? "\nALL HTML CHECKS PASSED" : "\nSOME HTML CHECKS FAILED");

// ---------- 6. End to end: confirm full file pipeline ----------
// Re-parse via jiti after the HTML was regenerated — make sure nothing breaks.
jiti(`${ROOT}/extensions/toolset/usage.ts`);
console.log("\n=== FINAL RE-PARSE ===");
console.log("  OK");

process.exit(allOk && projOk ? 0 : 1);

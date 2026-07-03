// Full integration check for the usage-report module.
// Runs from any cwd; resolves the project root relative to this script.
import { createJiti } from "file:///C:/Users/Darcey/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);

// Project root = two levels up from this script (tests/<name>/<script>).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..").replace(/\\/g, "/");
const dbPath = `${ROOT}/.pi-aftc-toolset/data/turns.db`;
const jiti = createJiti(ROOT, { interopDefault: true });

// ---------- 1. Parse all TypeScript modules via jiti ----------
console.log("=== PARSE CHECK ===");
const files = ["core.ts", "help.ts", "usage-report.ts", "index.ts", "db.ts", "usage-recording.ts", "install.ts", "input-clear.ts", "paths.ts", "types.ts", "footer-widget.ts", "response.ts"];
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

const { createUsageModule } = jiti(`${ROOT}/extensions/toolset/usage-report.ts`);
const fakePi = { registerCommand() {}, exec: async () => ({ code: 0, stdout: "", stderr: "", killed: false }) };
const inst = createUsageModule(fakePi);
const data = inst.collectReportData();
if (!data) { console.error("FAIL: collectReportData returned null"); process.exit(1); }

// ---------- 3. Validate data shape ----------
console.log("\n=== DATA SHAPE VALIDATION ===");
let shapeOk = true;
const checks = [
    ["data.totals is object", () => typeof data.totals === "object" && data.totals !== null],
    ["data.sections.daily exists", () => !!data.sections && !!data.sections.daily],
    ["data.sections.weekly exists", () => !!data.sections && !!data.sections.weekly],
    ["data.sections.monthly exists", () => !!data.sections && !!data.sections.monthly],
    ["data.sections.weeklyExcl exists", () => !!data.sections && !!data.sections.weeklyExcl],
    ["data.sections.monthlyExcl exists", () => !!data.sections && !!data.sections.monthlyExcl],
    ["data.modelsByPeriod has all periods", () => !!data.modelsByPeriod && ["daily","weekly","monthly","all"].every(p => Array.isArray(data.modelsByPeriod[p]))],
    ["data.modelThinkingByPeriod has all periods", () => !!data.modelThinkingByPeriod && ["daily","weekly","monthly","all"].every(p => Array.isArray(data.modelThinkingByPeriod[p]))],
    ["data.projections.rows is array", () => !!data.projections && Array.isArray(data.projections.rows)],
    ["data.projections.estimated is boolean", () => typeof data.projections.estimated === "boolean"],
    ["data.projections.note is string", () => typeof data.projections.note === "string"],
];
for (const [label, check] of checks) {
    try {
        if (!check()) { console.error("  FAIL: " + label); shapeOk = false; }
        else console.log("  OK " + label);
    } catch (e) {
        console.error("  FAIL: " + label + " (" + e.message + ")"); shapeOk = false;
    }
}

// Section bundle shape: each section has title, subtitle, cards array with 4 cards
const sectionKeys = ["daily", "weekly", "monthly", "weeklyExcl", "monthlyExcl"];
for (const k of sectionKeys) {
    const s = data.sections[k];
    if (!s) { console.error("  FAIL: missing section " + k); shapeOk = false; continue; }
    if (typeof s.title !== "string" || typeof s.subtitle !== "string") { console.error("  FAIL: section " + k + " missing title/subtitle"); shapeOk = false; }
    if (!Array.isArray(s.cards) || s.cards.length !== 4) { console.error("  FAIL: section " + k + " expected 4 cards, got " + (s.cards?.length ?? "none")); shapeOk = false; continue; }
    for (const c of s.cards) {
        if (typeof c.title !== "string" || typeof c.primary !== "string" || typeof c.secondary !== "string") {
            console.error("  FAIL: section " + k + " card missing fields"); shapeOk = false;
        }
    }
    console.log("  OK section " + k + ": " + s.cards.length + " cards");
}

// Projection rows must have the right fields
const projRows = data.projections.rows || [];
if (projRows.length === 0 && rowCount > 0) {
    console.error("  FAIL: DB has rows but no projection rows generated"); shapeOk = false;
}
const projFields = ["modelName", "thinkingLevel", "costPerHour", "costPerDay", "costPerWeek", "costPerMonth", "costPerYear", "estimated", "estimateNote"];
for (const r of projRows) {
    for (const f of projFields) {
        if (!(f in r)) { console.error("  FAIL: projection row missing field " + f); shapeOk = false; break; }
    }
}
if (projRows.length) console.log("  OK projection rows: " + projRows.length + " rows, all fields present");

// Projection math sanity: costPerHour × 24 = costPerDay (within tolerance)
for (const r of projRows) {
    const expected = r.costPerHour * 24;
    if (Math.abs(r.costPerDay - expected) > 0.001) {
        console.error("  FAIL: " + r.modelName + "/" + r.thinkingLevel + " costPerDay mismatch: " + r.costPerDay + " vs " + expected);
        shapeOk = false;
    }
}
if (projRows.length) console.log("  OK projection math: costPerHour × 24 = costPerDay");

// ---------- 4. Generate HTML & verify structure ----------
console.log("\n=== HTML GENERATION ===");
const html = inst.generateReportHtml(data);
fs.writeFileSync(`${ROOT}/.pi-aftc-toolset/data/report.html`, html, "utf8");
console.log("  wrote " + html.length + " bytes");

const requiredIds = [
    "generated-at", "lifetime-totals",
    "sec-daily", "sec-weekly", "sec-monthly",
    "weekly-weekend-toggle", "monthly-weekend-toggle",
    "models-table", "models-tbody", "models-empty", "models-period",
    "thinking-table", "thinking-tbody", "thinking-empty", "thinking-period",
    "proj-grid", "proj-empty", "proj-note",
    "report-data",
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

// Check projection grid header sort keys
const expectedHeadKeys = ["modelName", "thinkingLevel", "costPerHour", "costPerDay", "costPerWeek", "costPerMonth", "costPerYear"];
for (const k of expectedHeadKeys) {
    if (!html.includes('data-sort-p="' + k + '"')) {
        console.error("  FAIL: missing sort key: " + k);
        allOk = false;
    } else {
        console.log("  OK sort key: " + k);
    }
}

// Check CSS classes present
const cssChecks = ["proj-grid", "proj-cell.head", "proj-cell.estimate", "toggle-btn", "select option"];
for (const cls of cssChecks) {
    if (!html.includes(cls)) { console.error("  FAIL: missing CSS: " + cls); allOk = false; }
    else console.log("  OK css: " + cls);
}

// JS syntax/parse check via stub DOM
const m2 = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m2) { console.error("  FAIL: no module script"); allOk = false; }
else {
    const stubs = `
        const _els = {};
        const _fakeEl = (id) => ({
            textContent: id === "report-data" ? JSON.stringify({generatedAt: Date.now(), totals:{}, sections:{}, modelsByPeriod:{}, modelThinkingByPeriod:{}, projections:{rows:[],note:""}}) : "",
            innerHTML: "", id, style: {}, classList: { toggle: () => {}, add: () => {}, remove: () => {}, contains: () => false },
            addEventListener: function() {}, appendChild() {}, querySelectorAll: () => [], querySelector: () => null,
            getBoundingClientRect: () => ({}), dataset: { state: "include" },
            lastElementChild: null, children: { length: 0 },
            removeChild: function() {}, textContent: "",
        });
        const document = {
            getElementById: (id) => _els[id] || (_els[id] = _fakeEl(id)),
            createElement: () => ({ className: "", innerHTML: "", style: {}, appendChild() {}, classList: { add: () => {}, remove: () => {}, contains: () => false }, dataset: {} }),
            querySelectorAll: () => [],
        };
        const window = {};
        const Number = Number;
        const Math = Math;
        const String = String;
        const Array = Array;
        const JSON = JSON;
        const Date = Date;
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
            console.log("  OK no syntax error (stub runtime: " + e.message + ")");
        }
    }
}

console.log(allOk && shapeOk ? "\nALL HTML CHECKS PASSED" : "\nSOME CHECKS FAILED");

// ---------- 5. Final re-parse ----------
jiti(`${ROOT}/extensions/toolset/usage-report.ts`);
console.log("\n=== FINAL RE-PARSE ===");
console.log("  OK");

process.exit(allOk && shapeOk ? 0 : 1);

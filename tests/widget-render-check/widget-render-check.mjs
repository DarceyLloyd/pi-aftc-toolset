// Runtime verification for the orchestrator pattern:
//   - core.ts returns a FooterDataProvider
//   - footer-widget.ts renders 3 lines on session_start
//   - render() / dispose() work end-to-end against the data provider
//   - data.onTick() + ticker actually update the rendered output over time
import { createJiti } from "file:///C:/Users/Darcey/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

// Project root = two levels up from this script (tests/<name>/<script>).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..").replace(/\\/g, "/");
const jiti = createJiti(ROOT, { interopDefault: true });

const handlers = {};
const commands = {};
const pi = {
    on: (evt, h) => { handlers[evt] = h; },
    registerCommand: (name, def) => { commands[name] = def; },
    registerTool: () => {},
    registerShortcut: () => {},
    getAllTools: () => [],
    getThinkingLevel: () => "off",
};
const turnRecorder = { recordTurn: () => {} };

const { createCore } = jiti(`${ROOT}/extensions/toolset/core.ts`);
const { createFooterWidget } = jiti(`${ROOT}/extensions/toolset/footer-widget.ts`);

// Wire core → footer the same way the orchestrator (index.ts) does.
const footerData = createCore(pi, turnRecorder);
createFooterWidget(pi, footerData);

if (!commands["aftc-footer"]) { console.error("FAIL: /aftc-footer not registered by footer-widget"); process.exit(1); }
console.log("OK /aftc-footer registered");

// ctx with a capturing setWidget
let capturedKey = null, capturedFactory = null, capturedOpts = null;
const ctx = {
    hasUI: true,
    model: { name: "stub-model", reasoning: false, contextWindow: 200000 },
    ui: {
        setWidget: (key, factory, opts) => { capturedKey = key; capturedFactory = factory; capturedOpts = opts; },
        notify: () => {},
    },
};

// session_start on the footer fires show()
await handlers["session_start"]({}, ctx);
if (!capturedFactory) { console.error("FAIL: show() did not register a widget"); process.exit(1); }
console.log("OK widget key:", capturedKey);
console.log("OK placement:", capturedOpts?.placement);

// Stub tui + theme matching createFooterComponent's usage.
// Track requestRender calls so we can verify the ticker fires it.
let requestRenderCalls = 0;
const tui = { requestRender: () => { requestRenderCalls++; } };
const theme = { bg: (_k, s) => s, fg: (_k, s) => s };
const component = capturedFactory(tui, theme);
if (typeof component.render !== "function") { console.error("FAIL: factory did not return a renderable component"); process.exit(1); }

const lines = component.render(120);
if (!Array.isArray(lines)) { console.error("FAIL: render did not return an array, got", typeof lines); process.exit(1); }
if (lines.length !== 3) { console.error(`FAIL: expected 3 lines, got ${lines.length}`); process.exit(1); }
for (const l of lines) if (typeof l !== "string") { console.error("FAIL: non-string line:", l); process.exit(1); }
console.log(`OK render: ${lines.length} string lines, total ${lines.reduce((s, l) => s + l.length, 0)} chars`);

// ---- Verify ticker actually fires (the core issue the user reported) ----
// Wait ~1.2s; the 1Hz ticker must have fired at least once and called
// requestRender. If it didn't, the widget would never update over time.
const renderCallsBefore = requestRenderCalls;
await new Promise(r => setTimeout(r, 1200));
const renderCallsAfter = requestRenderCalls;
if (renderCallsAfter <= renderCallsBefore) {
    console.error(`FAIL: 1Hz ticker did not fire (requestRender calls: ${renderCallsBefore} -> ${renderCallsAfter})`);
    process.exit(1);
}
console.log(`OK ticker fires: requestRender called ${renderCallsAfter - renderCallsBefore} time(s) in 1.2s`);

// ---- Verify ticker drives real data updates ----
// Simulate the user sending a prompt: fire message_start for user (this
// is what core.ts listens to to set the in-memory session start time).
// Then wait >1s for the ticker to refresh, re-render, and check the
// context time changed.
await handlers["message_start"]({ message: { role: "user", content: "hi" } }, ctx);

// Re-prime so the first render reflects the just-set start time.
footerData.onTick();
const linesAtStart = component.render(120);
const ctxMatchStart = linesAtStart[1].match(/Context Time (\S+)/);
const ctxStart = ctxMatchStart ? ctxMatchStart[1] : null;

// Wait 1.2s for ticker to recompute
await new Promise(r => setTimeout(r, 1200));
// Manually trigger an onTick + re-render (the ticker has fired by now, but
// we trigger the render explicitly to read the latest cached value).
footerData.onTick();
const linesAfter = component.render(120);
const ctxMatchAfter = linesAfter[1].match(/Context Time (\S+)/);
const ctxAfter = ctxMatchAfter ? ctxMatchAfter[1] : null;

console.log(`OK context time before wait: ${ctxStart}, after 1.2s + onTick: ${ctxAfter}`);

if (ctxStart === ctxAfter) {
    console.error(`FAIL: context time did not change after 1.2s + onTick (both: ${ctxStart})`);
    process.exit(1);
}
console.log(`OK context time updated: ${ctxStart} -> ${ctxAfter}`);

// Time suffixes must be lowercase
if (/[A-Z]/.test(ctxAfter)) {
    console.error(`FAIL: context time has uppercase letter: ${ctxAfter}`);
    process.exit(1);
}
console.log("OK time suffixes are lowercase");

// dispose() must clear the 1Hz ticker interval without throwing
if (typeof component.dispose === "function") { component.dispose(); console.log("OK dispose() ran clean"); }
else console.error("WARN: no dispose() on widget component");

// /aftc-footer must toggle: hide by clearing the widget.
const hideCtx = {
    hasUI: true,
    ui: {
        setWidget: (key, val) => { capturedKey = val === undefined ? null : key; },
        notify: () => {},
    },
};
await commands["aftc-footer"].handler("", hideCtx);
if (capturedKey !== null) { console.error("FAIL: /aftc-footer did not clear the widget"); process.exit(1); }
console.log("OK /aftc-footer hides the widget");

console.log("\nALL WIDGET-RENDER CHECKS PASSED");
process.exit(0);
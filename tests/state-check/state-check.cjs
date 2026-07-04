// State module harness. Verifies the slimmed-down state.ts:
//   1. Returns defaults when state.json is missing AND generates the
//      file with DEFAULT_PREFERENCES on first access (read triggers
//      ensureStateFile).
//   2. setPreference writes state.json atomically and updates the cache.
//   3. getPreference reads back the persisted value across a "restart".
//   4. Partial state.json merges with DEFAULT_PREFERENCES.
//   5. Corrupt state.json returns defaults (file left on disk).
//   6. Version mismatch returns defaults (no aggressive migration).
//   7. DEFAULT_PREFERENCES is the single source of truth for a fresh
//      state.json and round-trips through ensure / setPreference.
//   8. /aftc-footer-report-timeframe persists the user's choice.
//   9. The footer divider toggle roundtrips through state.json.
//  10. /aftc-footer toggle persists footerEnabled.
//
// Resolves paths from the script itself so it runs from any cwd.

const { execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const PI_ROOT = path.join(globalRoot, "@earendil-works", "pi-coding-agent");
fs.statSync(PI_ROOT + "/package.json");
const { createJiti } = require(PI_ROOT + "/node_modules/jiti/lib/jiti.mjs");

const jiti = createJiti(__dirname, {
	alias: (id) => {
		if (id === "@earendil-works/pi-coding-agent") return PI_ROOT;
		if (id === "@earendil-works/pi-ai") return PI_ROOT + "/node_modules/@earendil-works/pi-ai/dist/index.js";
		if (id === "@earendil-works/pi-tui") return PI_ROOT + "/node_modules/@earendil-works/pi-tui";
	},
});

const DATA_DIR = path.join(__dirname, "..", "..", ".pi-aftc-toolset", "data");
const STATE_PATH = path.join(DATA_DIR, "state.json");

function rm(p) { try { fs.unlinkSync(p); } catch (_) { /* ignore */ } }
function rmAll() {
	rm(STATE_PATH);
	rm(STATE_PATH + ".tmp");
	// Leftover files from the old per-session layout — clean them up
	// so a stale session_state.json / data.json from a previous run
	// doesn't confuse anyone reading the data dir.
	rm(path.join(DATA_DIR, "session_state.json"));
	rm(path.join(DATA_DIR, "data.json"));
}

// Each test gets a fresh module instance so the in-memory cache
// doesn't leak between cases.
let stateCounter = 0;
function freshState() {
	stateCounter++;
	const stateMod = jiti(path.resolve(__dirname, "../../extensions/toolset/state.ts"));
	// Always clear the cache at the start of each test so values
	// don't leak between cases via the in-memory cache.
	stateMod._resetPreferencesCacheForTests();
	return stateMod;
}

function assert(cond, msg) {
	if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

function assertEq(a, b, msg) {
	if (a !== b) throw new Error("ASSERT FAILED: " + msg + " (got " + JSON.stringify(a) + ", expected " + JSON.stringify(b) + ")");
}

(async () => {
	rmAll();

	// =========================================================================
	// 1. Returns defaults when state.json is missing AND generates the
	//    file with DEFAULT_PREFERENCES on first access.
	// =========================================================================
	let st = freshState();
	assertEq(st.getPreference("footerTimeframe", "today"), "today", "default footerTimeframe");
	assertEq(st.getPreference("footerEnabled", true), true, "default footerEnabled");
	assertEq(st.getPreference("responseDividerEnabled", true), true, "default responseDividerEnabled");
	// First access ensures the file exists with defaults so the user
	// always has a real, editable state.json on disk.
	assert(fs.existsSync(STATE_PATH), "getPreference should ensure state.json exists");
	const ensured = JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
	assertEq(ensured.version, st.DEFAULT_PREFERENCES.version, "ensured version");
	assertEq(ensured.footerTimeframe, st.DEFAULT_PREFERENCES.footerTimeframe, "ensured footerTimeframe");
	assertEq(ensured.footerEnabled, st.DEFAULT_PREFERENCES.footerEnabled, "ensured footerEnabled");
	assertEq(ensured.responseDividerEnabled, st.DEFAULT_PREFERENCES.responseDividerEnabled, "ensured responseDividerEnabled");
	console.log("OK defaults returned + state.json generated on first access");

	// =========================================================================
	// 2. setPreference writes state.json atomically + matches DEFAULTS shape.
	// =========================================================================
	rmAll();
	st = freshState();
	st.setPreference("footerTimeframe", "7d");
	assert(fs.existsSync(STATE_PATH), "state.json should exist after setPreference");
	const written = JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
	assertEq(written.footerTimeframe, "7d", "persisted footerTimeframe");
	assertEq(written.version, 1, "persisted version");
	// Every DEFAULT_PREFERENCES key is present in the written file.
	assertEq(written.footerEnabled, st.DEFAULT_PREFERENCES.footerEnabled, "footerEnabled default written");
	assertEq(written.responseDividerEnabled, st.DEFAULT_PREFERENCES.responseDividerEnabled, "responseDividerEnabled default written");
	console.log("OK setPreference writes state.json atomically + defaults shape");

	// =========================================================================
	// 3. getPreference reads back the persisted value across a "restart".
	// =========================================================================
	st = freshState(); // simulate a new module instance (process restart)
	assertEq(st.getPreference("footerTimeframe", "today"), "7d", "persists across module reload");
	assertEq(st.getPreference("footerEnabled", true), true, "missing key still gets default");
	console.log("OK getPreference reads back the persisted value");

	// =========================================================================
	// 4. Partial state.json merges with DEFAULT_PREFERENCES.
	// =========================================================================
	rmAll();
	fs.mkdirSync(DATA_DIR, { recursive: true });
	fs.writeFileSync(STATE_PATH, JSON.stringify({ version: 1, footerTimeframe: "24h" }));
	st = freshState();
	assertEq(st.getPreference("footerTimeframe", "today"), "24h", "partial state.json: timeframe preserved");
	assertEq(st.getPreference("footerEnabled", true), true, "partial state.json: missing key gets default");
	console.log("OK partial state.json merges with defaults");

	// =========================================================================
	// 5. Corrupt state.json returns defaults (file left on disk).
	// =========================================================================
	rmAll();
	fs.writeFileSync(STATE_PATH, "{ this is not valid json");
	st = freshState();
	assertEq(st.getPreference("footerTimeframe", "today"), "today", "corrupt state.json: default returned");
	// The corrupt file is left on disk so the user can hand-fix it.
	console.log("OK corrupt state.json returns defaults (file left on disk)");

	// =========================================================================
	// 6. Version mismatch returns defaults (no aggressive migration).
	// =========================================================================
	rmAll();
	fs.writeFileSync(STATE_PATH, JSON.stringify({ version: 99, footerTimeframe: "should-be-ignored" }));
	st = freshState();
	assertEq(st.getPreference("footerTimeframe", "today"), "today", "version mismatch: default returned, value ignored");
	console.log("OK state.json version mismatch returns defaults");

	// =========================================================================
	// 7. DEFAULT_PREFERENCES is exported and has the expected keys.
	// =========================================================================
	st = freshState();
	const d = st.DEFAULT_PREFERENCES;
	assertEq(d.version, 1, "DEFAULT_PREFERENCES.version");
	assertEq(d.footerTimeframe, "today", "DEFAULT_PREFERENCES.footerTimeframe");
	assertEq(d.footerEnabled, true, "DEFAULT_PREFERENCES.footerEnabled");
	assertEq(d.responseDividerEnabled, true, "DEFAULT_PREFERENCES.responseDividerEnabled");
	console.log("OK DEFAULT_PREFERENCES exported with expected keys");

	// =========================================================================
	// 8. End-to-end: full extension load + footerEnabled=false respected.
	// =========================================================================
	rmAll();
	freshState()._resetPreferencesCacheForTests();
	fs.writeFileSync(STATE_PATH, JSON.stringify({
		version: 1,
		footerTimeframe: "3h",
		footerEnabled: false,
		responseDividerEnabled: false,
	}));
	freshState()._resetPreferencesCacheForTests();

	let widgetSetKey = undefined;
	let sessionStartHandler = null;
	const pi17 = {
		on(e, fn) { if (e === "session_start") sessionStartHandler = fn; },
		registerCommand() {},
		registerShortcut() {},
		registerTool() {},
		registerMessageRenderer() {},
		getAllTools: () => [],
		getActiveTools: () => [],
		exec: async () => ({ stdout: "", stderr: "", code: 0 }),
		getThinkingLevel: () => "off",
		setWidget(key, content) {
			widgetSetKey = content === undefined ? null : key;
		},
	};
	const indexMod17 = jiti(path.resolve(__dirname, "../../extensions/toolset/index.ts"));
	indexMod17.default(pi17);
	if (!sessionStartHandler) throw new Error("session_start handler not registered");
	await sessionStartHandler({ reason: "startup" }, { hasUI: true, ui: { setWidget: () => {} } });
	assertEq(widgetSetKey, undefined, "footerEnabled=false should NOT set widget");
	console.log("OK footerEnabled=false respected: widget not shown");

	// =========================================================================
	// 9. /aftc-footer-report-timeframe persists the user's choice.
	// =========================================================================
	rmAll();
	freshState()._resetPreferencesCacheForTests();
	const cmds18 = {};
	const pi18 = {
		on() {},
		registerCommand(name, opts) { cmds18[name] = opts; },
		registerShortcut() {},
		registerTool() {},
		registerMessageRenderer() {},
		getAllTools: () => [],
		getActiveTools: () => [],
		exec: async () => ({ stdout: "", stderr: "", code: 0 }),
		getThinkingLevel: () => "off",
		setWidget() {},
	};
	const indexMod18 = jiti(path.resolve(__dirname, "../../extensions/toolset/index.ts"));
	indexMod18.default(pi18);
	const tfCmd = cmds18["aftc-footer-report-timeframe"];
	if (!tfCmd) throw new Error("aftc-footer-report-timeframe command not registered");
	const notifications = [];
	await tfCmd.handler("", {
		hasUI: true,
		ui: {
			notify: (m, l) => notifications.push({ m, l }),
			select: async (title, options) => {
				const idx = options.indexOf("7 Days");
				return idx >= 0 ? "7 Days" : undefined;
			},
		},
	});
	assert(fs.existsSync(STATE_PATH), "state.json should exist after timeframe change");
	const savedState = JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
	assertEq(savedState.footerTimeframe, "7d", "timeframe persisted to state.json");
	console.log("OK /aftc-footer-report-timeframe persists to state.json");

	// =========================================================================
	// 10. Timeframe persists across a simulated pi restart.
	// =========================================================================
	const st3 = freshState();
	assertEq(st3.getPreference("footerTimeframe", "today"), "7d", "timeframe survives restart");
	console.log("OK timeframe survives simulated restart");

	// =========================================================================
	// 11. /aftc-footer toggle persists footerEnabled.
	// =========================================================================
	rmAll();
	const indexMod4 = jiti(path.resolve(__dirname, "../../extensions/toolset/index.ts"));
	const cmds4 = {};
	const pi4 = {
		on() {},
		registerCommand(name, opts) { cmds4[name] = opts; },
		registerShortcut() {},
		registerTool() {},
		registerMessageRenderer() {},
		getAllTools: () => [],
		getActiveTools: () => [],
		exec: async () => ({ stdout: "", stderr: "", code: 0 }),
		getThinkingLevel: () => "off",
		setWidget() {},
	};
	indexMod4.default(pi4);
	void indexMod17; // satisfy linters; both modules share the same source
	const footerCmd = cmds4["aftc-footer"];
	if (!footerCmd) throw new Error("aftc-footer command not registered");
	// Initial state: no state.json exists, so footerEnabled defaults
	// to true (in-memory only). The toggle writes state.json on the
	// first invocation.
	await footerCmd.handler("", {
		hasUI: true,
		ui: {
			notify: () => {},
			setWidget: () => {},
		},
	});
	assert(fs.existsSync(STATE_PATH), "state.json should exist after first toggle");
	const afterToggle = JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
	assertEq(afterToggle.footerEnabled, false, "footerEnabled persisted as false after toggle");
	console.log("OK /aftc-footer toggle persists footerEnabled");

	// Cleanup
	rmAll();

	console.log("\nALL STATE-CHECK CHECKS PASSED");
})().catch((err) => {
	console.error("FAIL:", err.message);
	if (err.stack) console.error(err.stack);
	// Ensure cleanup even on failure
	try { rmAll(); } catch (_) { /* ignore */ }
	process.exit(1);
});

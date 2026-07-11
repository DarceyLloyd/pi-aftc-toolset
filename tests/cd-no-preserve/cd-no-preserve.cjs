// cd-no-preserve.cjs - Behavioural test for the /cd post-preserve-removal flow.
//
// Verifies that:
//   1. createCd registers the /cd + /cd-set-max-depth commands.
//   2. `/cd <existing-path>` (one-shot) -> SessionManager.create is called
//      exactly once (NOT continueRecent), a session header is written,
//      and ctx.switchSession is invoked with that file path.
//   3. `/cd <missing-path-but-parent-exists>` -> ctx.ui.confirm is called;
//      when confirmed, the directory is created and switchSession runs.
//   4. `/cd` (no args) in TUI mode -> ctx.ui.custom is invoked EXACTLY ONCE
//      (the CdOverlay picker); the PreserveOverlay is gone, so no second
//      call precedes the picker.
//   5. `/cd` (no args) headless -> ctx.ui.notify is called with the
//      "interactive TUI required" error message and nothing else happens.
//   6. /cd description no longer mentions "preserve".
//
// The test aliases `@earendil-works/pi-coding-agent` to a wrapper module
// (_pi-stub.cjs) that re-exports the real package but swaps
// `SessionManager` for a recording stub. cd.ts only imports
// { SessionManager } from the package, so this is sufficient.

const { execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const PI_ROOT = path.join(globalRoot, "@earendil-works", "pi-coding-agent");
fs.statSync(PI_ROOT + "/package.json");
const { createJiti } = require(PI_ROOT + "/node_modules/jiti/lib/jiti.mjs");

const jiti = createJiti(__dirname, {
	alias: {
		"@earendil-works/pi-coding-agent": path.join(__dirname, "_pi-stub.cjs"),
		"@earendil-works/pi-ai": PI_ROOT + "/node_modules/@earendil-works/pi-ai/dist/index.js",
		"@earendil-works/pi-tui": PI_ROOT + "/node_modules/@earendil-works/pi-tui",
	},
});

// Pull the stub's call recorder through the wrapper. Use globalThis
// state so the jiti-cached copy of the wrapper (loaded when cd.ts
// imports the package) sees the same recorder.
const sessionManagerCalls =
	globalThis.__aftcTestSessionCalls || {
		create: [],
		continueRecent: [],
		inMemory: [],
		open: [],
	};
globalThis.__aftcTestSessionCalls = sessionManagerCalls;
// Ensure the require()-side wrapper sees our global state too.
require(path.join(__dirname, "_pi-stub.cjs"));

// ---- 2. Pi stub + ctx builder ----
function makePi() {
	const commands = {};
	const pi = {
		on() {},
		registerCommand(name, opts) { commands[name] = opts; },
		registerShortcut() {},
		registerTool() {},
		registerMessageRenderer() {},
		getAllTools: () => [],
		getActiveTools: () => [],
		exec: async () => ({ stdout: "", stderr: "", code: 0 }),
		getThinkingLevel: () => "off",
		setWidget() {},
	};
	return { pi, commands };
}

function makeCtx(opts = {}) {
	const customCalls = [];
	const notifyCalls = [];
	const confirmCalls = [];
	const switchSessionCalls = [];
	return {
		hasUI: opts.hasUI !== false,
		mode: opts.mode || "tui",
		cwd: opts.cwd || process.cwd(),
		ui: {
			notify: (msg, level) => { notifyCalls.push({ msg, level }); },
			select: async () => undefined,
			confirm: async (title, msg) => {
				confirmCalls.push({ title, msg });
				return opts.confirmResponse !== undefined ? opts.confirmResponse : true;
			},
			custom: async (factory, options) => {
				customCalls.push({ factory, options });
				return opts.customResponse !== undefined ? opts.customResponse : { kind: "cancelled" };
			},
			setStatus: () => {},
			setWidget: () => {},
			theme: { fg: (_c, s) => s, bg: (_c, s) => s, bold: (s) => s },
		},
		sessionManager: { getBranch: () => [], getEntries: () => [] },
		switchSession: async (file) => { switchSessionCalls.push({ file }); },
		_getCustomCalls: () => customCalls,
		_getNotifyCalls: () => notifyCalls,
		_getConfirmCalls: () => confirmCalls,
		_getSwitchSessionCalls: () => switchSessionCalls,
	};
}

// ---- 3. Assertions ----
let failed = 0;
function assert(cond, label) {
	if (cond) {
		console.log("  OK  " + label);
	} else {
		console.error("  FAIL " + label);
		failed++;
	}
}
function assertEq(actual, expected, label) {
	if (actual === expected) {
		console.log("  OK  " + label);
	} else {
		console.error("  FAIL " + label + " (got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected) + ")");
		failed++;
	}
}

(async () => {
	const mod = jiti(path.resolve(__dirname, "../../extensions/toolset/cd.ts"));
	if (typeof mod.createCd !== "function") {
		console.error("FAIL: createCd is not exported");
		process.exit(1);
	}
	console.log("OK cd.ts loaded; createCd exported");

	// Verify the stub SessionManager is what's bound in the loaded cd.ts.
	// We can read it back from the module's source if needed; for now
	// just check the stub's create was not already called.
	console.log("[diag] sessionManagerCalls.create.length at start =", sessionManagerCalls.create.length);

	// --- Test 1: createCd registers /cd + /cd-set-max-depth ---
	{
		const { pi, commands } = makePi();
		mod.createCd(pi);
		assert(typeof commands["cd"] === "object", "createCd registers /cd");
		assert(typeof commands["cd-set-max-depth"] === "object", "createCd registers /cd-set-max-depth");
		assert(typeof commands["cd"].handler === "function", "/cd has a handler");
		assert(typeof commands["cd-set-max-depth"].handler === "function", "/cd-set-max-depth has a handler");
		assert(
			!/preserve/i.test(commands["cd"].description),
			"/cd description no longer mentions preserve",
		);
	}

	// --- Test 2: /cd <existing-path> -> SessionManager.create + switchSession ---
	{
		const { pi, commands } = makePi();
		mod.createCd(pi);
		const beforeCreate = sessionManagerCalls.create.length;
		const beforeRecent = sessionManagerCalls.continueRecent.length;

		const target = process.cwd();
		const ctx = makeCtx({ cwd: target });
		await commands["cd"].handler(target, ctx);

		assertEq(sessionManagerCalls.create.length - beforeCreate, 1, "/cd <path> invokes SessionManager.create exactly once");
		assertEq(sessionManagerCalls.continueRecent.length - beforeRecent, 0, "/cd <path> does NOT invoke SessionManager.continueRecent");
		assertEq(sessionManagerCalls.create[beforeCreate].cwd, target, "SessionManager.create called with the resolved target dir");
		assertEq(ctx._getCustomCalls().length, 0, "/cd <path> does NOT open any ui.custom modal");
		assertEq(ctx._getSwitchSessionCalls().length, 1, "/cd <path> calls ctx.switchSession exactly once");
		const switchFile = ctx._getSwitchSessionCalls()[0].file;
		assert(fs.existsSync(switchFile), "switchSession was called with an existing session file: " + switchFile);
		if (fs.existsSync(switchFile)) {
			const header = JSON.parse(fs.readFileSync(switchFile, "utf8").trim());
			assertEq(header.type, "session", "session file header.type = session");
			assertEq(header.cwd, target, "session file header.cwd = target");
			fs.unlinkSync(switchFile);
		}
	}

	// --- Test 3: /cd <new-path-parent-exists> -> confirm + create + switch ---
	{
		const { pi, commands } = makePi();
		mod.createCd(pi);
		const beforeCreate = sessionManagerCalls.create.length;
		const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aftc-cd-test-"));
		const newDir = path.join(parentDir, "fresh-subdir");

		const ctx = makeCtx({ cwd: process.cwd(), confirmResponse: true });
		await commands["cd"].handler(newDir, ctx);

		assertEq(sessionManagerCalls.create.length - beforeCreate, 1, "/cd <new-path> invokes SessionManager.create after confirm");
		assertEq(ctx._getConfirmCalls().length, 1, "/cd <new-path> calls ui.confirm once");
		assert(fs.existsSync(newDir), "missing directory was created");
		assertEq(ctx._getSwitchSessionCalls().length, 1, "/cd <new-path> calls ctx.switchSession once");
		const switchFile = ctx._getSwitchSessionCalls()[0].file;
		if (fs.existsSync(switchFile)) fs.unlinkSync(switchFile);
		fs.rmSync(parentDir, { recursive: true, force: true });
	}

	// --- Test 4: /cd <new-path-parent-MISSING> -> notify error, no create ---
	{
		const { pi, commands } = makePi();
		mod.createCd(pi);
		const beforeCreate = sessionManagerCalls.create.length;
		const bogusPath = path.join("Z:", "definitely", "does", "not", "exist", "anywhere", "x");

		const ctx = makeCtx({ cwd: process.cwd() });
		await commands["cd"].handler(bogusPath, ctx);

		assertEq(sessionManagerCalls.create.length - beforeCreate, 0, "/cd <bad-path> does NOT call SessionManager.create");
		const notifyCalls = ctx._getNotifyCalls();
		assert(notifyCalls.some((n) => n.level === "error"), "/cd <bad-path> emits an error notification");
		assertEq(ctx._getSwitchSessionCalls().length, 0, "/cd <bad-path> does NOT call ctx.switchSession");
	}

	// --- Test 5: /cd (no args) headless -> notify error, no custom, no create ---
	{
		const { pi, commands } = makePi();
		mod.createCd(pi);
		const beforeCreate = sessionManagerCalls.create.length;

		const ctx = makeCtx({ hasUI: false, mode: "print" });
		await commands["cd"].handler("", ctx);

		assertEq(sessionManagerCalls.create.length - beforeCreate, 0, "/cd headless does NOT call SessionManager.create");
		assertEq(ctx._getCustomCalls().length, 0, "/cd headless does NOT open any ui.custom modal");
		const notifyCalls = ctx._getNotifyCalls();
		assert(notifyCalls.some((n) => /TUI/i.test(n.msg) && n.level === "error"), "/cd headless emits a TUI-required error notification");
		assertEq(ctx._getSwitchSessionCalls().length, 0, "/cd headless does NOT call ctx.switchSession");
	}

	// --- Test 6: /cd (no args) interactive TUI -> ui.custom called ONCE ---
	// (Was called twice before: PreserveOverlay then CdOverlay.)
	{
		const { pi, commands } = makePi();
		mod.createCd(pi);
		const beforeCreate = sessionManagerCalls.create.length;

		const ctx = makeCtx({ cwd: process.cwd(), customResponse: { kind: "cancelled" } });
		await commands["cd"].handler("", ctx);

		const customCalls = ctx._getCustomCalls();
		assertEq(customCalls.length, 1, "/cd (no args) TUI opens EXACTLY ONE ui.custom modal (CdOverlay only — PreserveOverlay gone)");
		assertEq(sessionManagerCalls.create.length - beforeCreate, 0, "/cd (no args) cancelled does NOT call SessionManager.create");
		assertEq(ctx._getSwitchSessionCalls().length, 0, "/cd (no args) cancelled does NOT call ctx.switchSession");
	}

	// --- Test 7: /cd (no args) interactive TUI -> picker returns dir -> create + switch ---
	{
		const { pi, commands } = makePi();
		mod.createCd(pi);
		const beforeCreate = sessionManagerCalls.create.length;

		const targetDir = process.cwd();
		const ctx = makeCtx({ cwd: targetDir, customResponse: { kind: "picked", directory: targetDir } });
		await commands["cd"].handler("", ctx);

		const customCalls = ctx._getCustomCalls();
		assertEq(customCalls.length, 1, "/cd (no args) TUI with picked result opens exactly one ui.custom modal");
		assertEq(sessionManagerCalls.create.length - beforeCreate, 1, "/cd (no args) picked -> SessionManager.create called once");
		assertEq(ctx._getSwitchSessionCalls().length, 1, "/cd (no args) picked -> ctx.switchSession called once");
		const switchFile = ctx._getSwitchSessionCalls()[0].file;
		if (fs.existsSync(switchFile)) {
			const header = JSON.parse(fs.readFileSync(switchFile, "utf8").trim());
			assertEq(header.cwd, targetDir, "switched session file cwd = picked dir");
			fs.unlinkSync(switchFile);
		}
	}

	// --- Summary ---
	if (failed > 0) {
		console.error("\n" + failed + " assertion(s) failed");
		process.exit(1);
	}
	console.log("\nAll /cd no-preserve assertions passed");
})();
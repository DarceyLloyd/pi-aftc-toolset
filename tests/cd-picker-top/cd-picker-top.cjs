// cd-picker-top.cjs - Verifies CdOverlay behaviour after the picker-top
// + current-folder-as-first-entry changes.
//
// Checks:
//   1. On open, entries[0] is the synthetic "./" representing the current
//      folder, with kind "dir" and value === currentDir.
//   2. On open, selectedIndex === 0.
//   3. ArrowLeft (navigate up) refreshes entries: new "./" at top, selection
//      reset to 0.
//   4. ArrowRight (drill into a child) refreshes entries: new "./" at top,
//      selection reset to 0.
//   5. ArrowRight on "./" itself is a no-op (you're already there).
//   6. Pressing Enter on the "./" entry picks the current directory
//      (returns { kind: "picked", directory: currentDir }).
//   7. Pressing Enter on the "./" entry after typing text that matches no
//      children falls through to typed-resolution (returns { kind: "typed", text }).
//   8. Rendered output contains the "./" entry at the top of the listing
//      and that row is highlighted (selected).

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

// ANSI escape sequences for arrow / control keys (matches pi-tui's
// LEGACY_KEY_SEQUENCES). Use these when driving the picker — calling
// handleInput("down") won't match the literal string "down".
const KEY = {
	up: "\x1b[A",
	down: "\x1b[B",
	right: "\x1b[C",
	left: "\x1b[D",
	enter: "\r",
	escape: "\x1b",
	tab: "\t",
	backspace: "\x7f",
	home: "\x1b[H",
	end: "\x1b[F",
	pageUp: "\x1b[5~",
	pageDown: "\x1b[6~",
};

// We capture the factory passed to ui.custom so we can construct and
// drive the CdOverlay directly.
function makePiAndCtx(opts = {}) {
	const commands = {};
	const pi = {
		on() {},
		registerCommand(name, c) { commands[name] = c; },
		registerShortcut() {},
		registerTool() {},
		registerMessageRenderer() {},
		getAllTools: () => [],
		getActiveTools: () => [],
		exec: async () => ({ stdout: "", stderr: "", code: 0 }),
		getThinkingLevel: () => "off",
		setWidget() {},
	};
	const customFactories = [];
	const ctx = {
		hasUI: true,
		mode: "tui",
		cwd: opts.cwd || process.cwd(),
		ui: {
			notify: () => {},
			select: async () => undefined,
			confirm: async () => true,
			custom: async (factory) => {
				customFactories.push(factory);
				return undefined;
			},
			setStatus: () => {},
			setWidget: () => {},
			// bg/fg that mark the selected row with a sentinel so the test
			// can find it in the rendered output.
			theme: {
				fg: (_c, s) => s,
				bg: (c, s) => (c === "selectedBg" ? `<<SEL>>${s}<<END>>` : s),
				bold: (s) => s,
			},
		},
		sessionManager: { getBranch: () => [], getEntries: () => [] },
		switchSession: async () => {},
	};
	return { pi, commands, customFactories, ctx };
}

// Build a fresh picker instance for a given cwd. The factory is the
// argument passed to ctx.ui.custom by createCd's /cd handler.
function buildPicker(customFactories, cwd) {
	// CustomFactories is an array of factory functions; the /cd handler
	// pushes exactly one. Invoke it to get the CdOverlay instance.
	if (customFactories.length === 0) {
		throw new Error("no custom factory captured — did /cd run?");
	}
	const factory = customFactories[customFactories.length - 1];
	// The factory signature: (_tui, theme, _keybindings, done) => picker
	const stubTheme = {
		fg: (_c, s) => s,
		bg: (c, s) => (c === "selectedBg" ? `<<SEL>>${s}<<END>>` : s),
		bold: (s) => s,
	};
	let captured = null;
	const fakeDone = (result) => { captured = result; };
	const picker = factory({}, stubTheme, {}, fakeDone);
	// After construction, the picker calls refreshEntries() in its
	// constructor. Override cwd if the test needs a specific one.
	if (cwd && cwd !== picker.currentDir) {
		picker.currentDir = path.resolve(cwd);
		picker.refreshEntries();
	}
	return { picker, getResult: () => captured };
}

// Convenience: run /cd (no args) and return the captured picker.
async function openPicker(opts) {
	const { pi, commands, customFactories, ctx } = makePiAndCtx(opts);
	const mod = jiti(path.resolve(__dirname, "../../extensions/toolset/cd.ts"));
	mod.createCd(pi);
	await commands["cd"].handler("", ctx);
	return buildPicker(customFactories, opts.cwd);
}

(async () => {
	const mod = jiti(path.resolve(__dirname, "../../extensions/toolset/cd.ts"));
	if (typeof mod.createCd !== "function") {
		console.error("FAIL: createCd is not exported");
		process.exit(1);
	}
	console.log("OK cd.ts loaded; createCd exported");

	// --- Test 1: on open, entries[0] is "./" representing currentDir ---
	{
		const { picker } = await openPicker({ cwd: process.cwd() });
		assert(picker.entries.length > 0, "picker has at least one entry");
		const top = picker.entries[0];
		assertEq(top.label, "./", "entries[0].label === './'");
		assertEq(top.kind, "dir", "entries[0].kind === 'dir'");
		assertEq(top.value, picker.currentDir, "entries[0].value === currentDir");
	}

	// --- Test 2: on open, selectedIndex === 0 ---
	{
		const { picker } = await openPicker({ cwd: process.cwd() });
		assertEq(picker.selectedIndex, 0, "selectedIndex === 0 on open");
	}

	// --- Test 3: ArrowLeft (navigate up) refreshes: "./" at top, sel=0 ---
	{
		const startCwd = process.cwd();
		// Use a cwd that has a parent dir.
		const { picker } = await openPicker({ cwd: startCwd });
		// Move selection down to verify it resets.
		picker.selectedIndex = 3;
		picker.handleInput(KEY.down);
		picker.handleInput(KEY.down);
		assert(picker.selectedIndex !== 0, "sanity: selection moved down via arrow keys");
		// Now navigate up.
		picker.handleInput(KEY.left);
		assertEq(picker.selectedIndex, 0, "after ↑ dir (←), selectedIndex === 0");
		assertEq(picker.entries[0].label, "./", "after ↑ dir, entries[0].label === './'");
		assertEq(picker.entries[0].value, picker.currentDir, "after ↑ dir, entries[0].value === currentDir");
		// The previous cwd should now be a child of the new currentDir.
		const rel = path.relative(picker.currentDir, startCwd);
		assert(rel && !rel.startsWith("..") && !path.isAbsolute(rel), "previous cwd is now a descendant of the new currentDir: rel=" + rel);
	}

	// --- Test 4: ArrowRight (drill into a child) refreshes: "./" at top, sel=0 ---
	{
		const { picker } = await openPicker({ cwd: process.cwd() });
		// Pick a child entry — index 1 is the first child (after "./").
		const childEntry = picker.entries[1];
		if (!childEntry) {
			console.log("  SKIP test 4 (cwd has no children)");
		} else {
			picker.selectedIndex = 1;
			picker.handleInput(KEY.right); // drill in
			assertEq(picker.selectedIndex, 0, "after ↓ dir (→), selectedIndex === 0");
			assertEq(picker.entries[0].label, "./", "after ↓ dir, entries[0].label === './'");
			assertEq(picker.entries[0].value, picker.currentDir, "after ↓ dir, entries[0].value === currentDir");
			assertEq(picker.currentDir, childEntry.value, "currentDir === drilled child path");
		}
	}

	// --- Test 5: ArrowRight on "./" itself is a no-op ---
	{
		const { picker } = await openPicker({ cwd: process.cwd() });
		const beforeDir = picker.currentDir;
		picker.selectedIndex = 0; // "./"
		picker.handleInput(KEY.right);
		assertEq(picker.currentDir, beforeDir, "→ on './' does not change currentDir");
		assertEq(picker.selectedIndex, 0, "→ on './' keeps selectedIndex === 0");
	}

	// --- Test 6: Enter on "./" picks the current directory ---
	{
		const { picker, getResult } = await openPicker({ cwd: process.cwd() });
		picker.selectedIndex = 0; // "./"
		picker.handleInput(KEY.enter);
		const result = getResult();
		assertEq(result && result.kind, "picked", "Enter on './' returns kind='picked'");
		assertEq(result && result.directory, picker.currentDir, "Enter on './' returns directory === currentDir");
	}

	// --- Test 7: Enter on "./" with typed text that matches no children falls through to typed-resolution ---
	{
		const { picker, getResult } = await openPicker({ cwd: process.cwd() });
		picker.selectedIndex = 0; // "./"
		// Type something that almost certainly matches no children.
		picker.handleInput("z");
		picker.handleInput("z");
		picker.handleInput("z");
		picker.handleInput("z");
		// After typing, refreshEntries will have rebuilt the list. With
		// only "./" left (no children matched), pressing Enter should fall
		// through to typed-resolution rather than picking currentDir.
		const filteredChildrenCount = picker.entries.length - 1; // exclude "./"
		picker.handleInput(KEY.enter);
		const result = getResult();
		if (filteredChildrenCount === 0) {
			assertEq(result && result.kind, "typed", "Enter on './' with no matching children + typed text -> kind='typed'");
			assertEq(result && result.text, "zzzz", "Enter on './' with no matching children + typed text -> text='zzzz'");
		} else {
			console.log("  SKIP test 7 (some children matched 'zzzz'; can't exercise fallthrough)");
		}
	}

	// --- Test 8: Rendered output contains "./" highlighted at top of listing ---
	{
		const { picker } = await openPicker({ cwd: process.cwd() });
		const lines = picker.render(110);
		const rendered = lines.join("\n");
		// The "./" entry, when highlighted, contains "<<SEL>>" wrapping.
		const selMarker = "<<SEL>>";
		assert(rendered.includes(selMarker), "rendered output contains the selected-row marker");
		// Find the index of the first occurrence — that should be the "./" row.
		const firstSelIdx = rendered.indexOf(selMarker);
		const firstRowMatch = rendered.substring(firstSelIdx).match(new RegExp(selMarker + "([^<]*)"));
		assert(firstRowMatch && firstRowMatch[1].includes("./"),
			"first selected row in render output contains './' (got: " + JSON.stringify(firstRowMatch && firstRowMatch[1]) + ")");
	}

	// --- Summary ---
	if (failed > 0) {
		console.error("\n" + failed + " assertion(s) failed");
		process.exit(1);
	}
	console.log("\nAll cd-picker-top assertions passed");
})();
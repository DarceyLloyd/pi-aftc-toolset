// Theme-picker shortcut harness. Verifies that `createTheme(pi)` registers
// a /theme command that:
//   1. Calls ctx.ui.getAllThemes() to discover themes
//   2. Uses ctx.ui.custom (NOT ctx.ui.select) to present the picker
//   3. Pre-selects the currently active theme on open
//   4. Forwards up/down/enter/escape to the inner SelectList
//   5. Intercepts PageUp / PageDown to jump by maxVisible
//   6. Intercepts Ctrl+PageUp / Ctrl+PageDown to jump to first/last
//   7. Calls ctx.ui.setTheme(name) on Enter
//   8. Notifies on success
//   9. Handles no-UI, empty-themes, cancel, and setTheme-failure paths
//  10. Is exported from the orchestrator's index.ts
//
// Resolves paths from the script itself so it runs from any cwd.

const { execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const PI_ROOT = path.join(
	globalRoot,
	"@earendil-works",
	"pi-coding-agent",
);
fs.statSync(PI_ROOT + "/package.json");
const { createJiti } = require(PI_ROOT + "/node_modules/jiti/lib/jiti.mjs");

const jiti = createJiti(__dirname, {
	alias: (id) => {
		if (id === "@earendil-works/pi-coding-agent") return PI_ROOT;
		if (id === "@earendil-works/pi-ai")
			return PI_ROOT + "/node_modules/@earendil-works/pi-ai/dist/index.js";
		if (id === "@earendil-works/pi-tui") return PI_ROOT + "/node_modules/@earendil-works/pi-tui";
	},
});

// Capture the component factory registered with ctx.ui.custom so the
// tests can drive the picker directly.
function makeTheme(opts = {}) {
	const currentName = opts.currentName;
	return {
		name: currentName === undefined ? "dark" : currentName,
		sourcePath: undefined,
		fg: (_c, s) => s,
		bg: (_c, s) => s,
		bold: (s) => s,
		italic: (s) => s,
		underline: (s) => s,
		strikethrough: (s) => s,
		inverse: (s) => s,
	};
}

(async () => {
	// ---- 1. Load via the orchestrator's index.ts ----
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
	const indexMod = jiti(path.resolve(__dirname, "../../extensions/toolset/index.ts"));
	if (typeof indexMod.default !== "function") throw new Error("index.ts default export is not a function");
	indexMod.default(pi);
	if (!commands["theme"]) throw new Error("/theme was not registered via orchestrator");
	console.log("OK /theme registered by orchestrator");

	const themeCmd = commands["theme"];
	if (typeof themeCmd.handler !== "function") throw new Error("/theme has no handler");
	if (typeof themeCmd.description !== "string" || themeCmd.description.length === 0) {
		throw new Error("/theme has no description");
	}
	console.log("OK /theme has handler and description");

	// ---- 2. No-UI fallback ----
	const noUiLogs = [];
	const origLog = console.log;
	console.log = (...args) => noUiLogs.push(args.join(" "));
	try {
		await themeCmd.handler("", {
			hasUI: false,
			ui: {
				getAllThemes: () => [
					{ name: "dark" },
					{ name: "light" },
					{ name: "cache-viz" },
				],
				setTheme: () => ({ success: true }),
			},
		});
	} finally {
		console.log = origLog;
	}
	if (noUiLogs.length === 0 || !noUiLogs.some((l) => l.includes("dark") && l.includes("light"))) {
		throw new Error("no-UI fallback did not print discovered theme names; logs: " + JSON.stringify(noUiLogs));
	}
	console.log("OK no-UI fallback prints discovered theme names");

	// ---- 3. Empty themes ----
	const emptyNotifications = [];
	await themeCmd.handler("", {
		hasUI: true,
		ui: {
			notify: (m, l) => emptyNotifications.push({ m, l }),
			getAllThemes: () => [],
			setTheme: () => ({ success: true }),
			theme: makeTheme({ currentName: undefined }),
		},
	});
	const emptyWarn = emptyNotifications.find((n) => n.l === "warning" && /no themes/i.test(n.m));
	if (!emptyWarn) throw new Error("empty themes did not warn; notifications: " + JSON.stringify(emptyNotifications));
	console.log("OK empty themes notifies warning");

	// ---- 4. Cancel (overlay returns null) ----
	let setThemeCallsCancel = [];
	const cancelNotifications = [];
	await themeCmd.handler("", {
		hasUI: true,
		ui: {
			notify: (m, l) => cancelNotifications.push({ m, l }),
			getAllThemes: () => [{ name: "dark" }, { name: "light" }],
			setTheme: (n) => {
				setThemeCallsCancel.push(n);
				return { success: true };
			},
			theme: makeTheme({ currentName: "dark" }),
			custom: async (_factory, _opts) => null, // user pressed Esc
		},
	});
	if (setThemeCallsCancel.length !== 0) throw new Error("setTheme should not be called on cancel");
	if (cancelNotifications.length !== 0) throw new Error("cancel should not show any notification");
	console.log("OK user cancel is silent and does not call setTheme");

	// ---- 5. Drive the picker directly via the overlay factory ----
	// We synthesise a 50-theme list to exercise page-nav.
	const themes = [];
	for (let i = 0; i < 50; i++) themes.push({ name: `theme-${String(i).padStart(2, "0")}` });
	const currentName = "theme-25";

	let capturedFactory = null;
	let capturedOpts = null;
	const ui = {
		hasUI: true,
		notify: () => {},
		getAllThemes: () => themes,
		setTheme: () => ({ success: true }),
		theme: makeTheme({ currentName }),
		custom: async (factory, opts) => {
			capturedFactory = factory;
			capturedOpts = opts;
			// Run the factory to get the picker component, drive it, then
			// resolve with the final selection.
			const tui = { requestRender() {} };
			const theme = makeTheme({ currentName });
			const keybindings = {};
			let doneValue = undefined;
			const done = (v) => { doneValue = v; };
			const component = factory(tui, theme, keybindings, done);
			return { component, done, doneValue };
		},
	};

	const themeCheckPromise = themeCmd.handler("", { hasUI: true, ui });
	// The handler awaits ctx.ui.custom, which returns a promise. We
	// drive the picker synchronously and resolve.
	await new Promise((r) => setTimeout(r, 5));
	if (!capturedFactory) throw new Error("ctx.ui.custom was not called");
	if (!capturedOpts || !capturedOpts.overlay) throw new Error("ctx.ui.custom was not called with overlay: true");
	console.log("OK ctx.ui.custom called with overlay: true");

	// Re-run the factory to inspect the component for assertions.
	const tui = { requestRender() {} };
	const theme = makeTheme({ currentName });
	let doneValue = null;
	let doneCalled = false;
	const done = (v) => { doneValue = v; doneCalled = true; };
	const component = capturedFactory(tui, theme, {}, done);

	// The component is a Container wrapping a ThemePicker. Reach in via
	// getPicker() to drive selection.
	if (typeof component.getPicker !== "function") {
		throw new Error("overlay component does not expose getPicker()");
	}
	const picker = component.getPicker();

	// ---- 5a. Pre-selection: current theme should be the active item ----
	if (picker.getSelectedValue() !== currentName) {
		throw new Error(
			"expected pre-selected theme " + currentName + ", got " + picker.getSelectedValue(),
		);
	}
	console.log("OK picker pre-selects the currently active theme (" + currentName + ")");

	// ---- 5b. Render once at width 80 to ensure render works ----
	const lines = component.render(80);
	if (!Array.isArray(lines) || lines.length === 0) {
		throw new Error("component.render(80) returned no lines");
	}
	console.log("OK component renders " + lines.length + " lines at width 80");

	// ---- 5c. Up / Down / Enter pass-through ----
	// Down arrow - represented as ANSI sequence for testing.
	component.handleInput("\x1b[B"); // down arrow
	if (picker.getSelectedValue() !== "theme-26") {
		throw new Error("after Down, expected theme-26, got " + picker.getSelectedValue());
	}
	console.log("OK Down arrow advances by 1");

	component.handleInput("\x1b[A"); // up arrow
	if (picker.getSelectedValue() !== "theme-25") {
		throw new Error("after Up, expected theme-25, got " + picker.getSelectedValue());
	}
	console.log("OK Up arrow goes back by 1");

	// ---- 5d. PageDown jumps by maxVisible (15) ----
	component.handleInput("\x1b[6~"); // pageDown
	const afterPageDown = picker.getSelectedValue();
	const expectedAfterPageDown = "theme-" + String(25 + 15).padStart(2, "0");
	if (afterPageDown !== expectedAfterPageDown) {
		throw new Error("after PageDown, expected " + expectedAfterPageDown + ", got " + afterPageDown);
	}
	console.log("OK PageDown jumps by viewport (" + 15 + ")");

	// ---- 5e. PageUp goes back ----
	component.handleInput("\x1b[5~"); // pageUp
	if (picker.getSelectedValue() !== "theme-25") {
		throw new Error("after PageUp, expected theme-25, got " + picker.getSelectedValue());
	}
	console.log("OK PageUp jumps back by viewport");

	// ---- 5f. Ctrl+PageUp jumps to first ----
	// Move off the start first so we can confirm the jump.
	picker.setSelectedIndex(30);
	// Ctrl+PageUp - kitty sequence. matchesKey parses mod+key from
	// the input. We can also call the underlying logic by using the
	// right sequence. Try the standard ctrl+pageUp sequence.
	// Many terminals emit "\x1b[5;5~" for ctrl+pgup.
	component.handleInput("\x1b[5;5~");
	if (picker.getSelectedValue() !== "theme-00") {
		throw new Error("after Ctrl+PageUp, expected theme-00, got " + picker.getSelectedValue());
	}
	console.log("OK Ctrl+PageUp jumps to first");

	// ---- 5g. Ctrl+PageDown jumps to last ----
	component.handleInput("\x1b[6;5~"); // ctrl+pageDown
	if (picker.getSelectedValue() !== "theme-49") {
		throw new Error("after Ctrl+PageDown, expected theme-49, got " + picker.getSelectedValue());
	}
	console.log("OK Ctrl+PageDown jumps to last");

	// ---- 5h. Enter confirms (calls done with the value) ----
	component.handleInput("\r"); // Enter / Return
	if (!doneCalled) throw new Error("Enter did not invoke done()");
	if (doneValue !== "theme-49") {
		throw new Error("done() did not receive the selected theme; got " + doneValue);
	}
	console.log("OK Enter calls done() with the selected theme");

	// ---- 6. setTheme failure surfaces error ----
	let failNotify = [];
	const failUi = {
		hasUI: true,
		notify: (m, l) => failNotify.push({ m, l }),
		getAllThemes: () => [{ name: "broken" }],
		setTheme: () => ({ success: false, error: "schema mismatch" }),
		theme: makeTheme({ currentName: undefined }),
		custom: async (factory) => {
			const tui = { requestRender() {} };
			const t = makeTheme({ currentName: undefined });
			const component = factory(tui, t, {}, (v) => v);
			component.handleInput("\r"); // pick it
			return "broken";
		},
	};
	await themeCmd.handler("", { hasUI: true, ui: failUi });
	const failErr = failNotify.find((n) => n.l === "error" && /schema mismatch/.test(n.m));
	if (!failErr) throw new Error("setTheme failure did not surface error; got: " + JSON.stringify(failNotify));
	console.log("OK setTheme failure surfaces error via notify");

	// ---- 7. Successful pick -> notify ----
	let okNotify = [];
	await themeCmd.handler("", {
		hasUI: true,
		ui: {
			notify: (m, l) => okNotify.push({ m, l }),
			getAllThemes: () => [
				{ name: "dark" },
				{ name: "light" },
				{ name: "cache-viz" },
				{ name: "aftc-orange-viz" },
			],
			setTheme: () => ({ success: true }),
			theme: makeTheme({ currentName: "aftc-orange-viz" }),
			custom: async (factory) => {
				const tui = { requestRender() {} };
				const t = makeTheme({ currentName: "aftc-orange-viz" });
				const component = factory(tui, t, {}, () => {});
				component.handleInput("\r"); // pick it
				return "aftc-orange-viz";
			},
		},
	});
	const okInfo = okNotify.find((n) => n.l === "info" && /aftc-orange-viz/.test(n.m));
	if (!okInfo) throw new Error("success notification missing; got: " + JSON.stringify(okNotify));
	console.log("OK successful pick -> setTheme -> notify");

	// ---- 8. <in-memory> sentinel: no pre-selection, no "Current: ..." hint ----
	let inMemFactory = null;
	await themeCmd.handler("", {
		hasUI: true,
		ui: {
			notify: () => {},
			getAllThemes: () => [{ name: "alpha" }, { name: "beta" }],
			setTheme: () => ({ success: true }),
			theme: makeTheme({ currentName: "<in-memory>" }),
			custom: async (factory) => {
				inMemFactory = factory;
				return null;
			},
		},
	});
	const tui2 = { requestRender() {} };
	const t2 = makeTheme({ currentName: "<in-memory>" });
	const inMemComponent = inMemFactory(tui2, t2, {}, () => {});
	const inMemPicker = inMemComponent.getPicker();
	if (inMemPicker.getSelectedValue() !== "alpha") {
		throw new Error("<in-memory> sentinel should fall back to first item, got " + inMemPicker.getSelectedValue());
	}
	const inMemLines = inMemComponent.render(80);
	const hasCurrentHint = inMemLines.some((l) => /Current:/i.test(l));
	if (hasCurrentHint) throw new Error("<in-memory> sentinel should suppress the Current: hint");
	console.log("OK <in-memory> sentinel: no pre-selection, no Current hint");

	// ---- 9. Preview during navigation: each Down triggers setTheme ----
	let previewSetCalls = [];
	let previewNotifications = [];
	let previewFactory = null;
	const previewThemes = [
		{ name: "theme-a" },
		{ name: "theme-b" },
		{ name: "theme-c" },
	];
	await themeCmd.handler("", {
		hasUI: true,
		ui: {
			notify: (m, l) => previewNotifications.push({ m, l }),
			getAllThemes: () => previewThemes,
			setTheme: (n) => {
				previewSetCalls.push(n);
				return { success: true };
			},
			theme: makeTheme({ currentName: "theme-a" }),
			custom: async (factory) => {
				previewFactory = factory;
				return null; // cancel; we'll drive the picker manually
			},
		},
	});
	const tuiPrev = { requestRender() {} };
	const tPrev = makeTheme({ currentName: "theme-a" });
	let prevDoneValue = null;
	let prevDoneCalled = false;
	const prevDone = (v) => { prevDoneValue = v; prevDoneCalled = true; };
	const prevComponent = previewFactory(tuiPrev, tPrev, {}, prevDone);
	prevComponent.handleInput("\x1b[B"); // Down: a -> b (preview)
	prevComponent.handleInput("\x1b[B"); // Down: b -> c (preview)
	prevComponent.handleInput("\x1b[B"); // Down: c -> a (SelectList wraps by default; preview a)
	// Preview setTheme calls: theme-b, theme-c, theme-a. The third
	// Down wraps from the last item to the first (SelectList's
	// default behaviour), so onSelectionChange fires and the
	// preview callback runs again. This is consistent with the
	// preview contract — every navigation key applies the
	// highlighted theme.
	if (previewSetCalls.length !== 3) {
		throw new Error("expected 3 preview setTheme calls (Down wraps at end), got " + previewSetCalls.length + ": " + JSON.stringify(previewSetCalls));
	}
	if (previewSetCalls[0] !== "theme-b" || previewSetCalls[1] !== "theme-c" || previewSetCalls[2] !== "theme-a") {
		throw new Error("preview setTheme calls wrong: " + JSON.stringify(previewSetCalls));
	}
	// No notifications - preview succeeded for every move.
	if (previewNotifications.length !== 0) {
		throw new Error("preview should not notify on success; got: " + JSON.stringify(previewNotifications));
	}
	console.log("OK Down triggers preview setTheme; wrap-around at end previews the first item");

	// ---- 10. Preview + Esc reverts to original theme ----
	let revertSetCalls = [];
	let revertNotifications = [];
	let revertFactory = null;
	await themeCmd.handler("", {
		hasUI: true,
		ui: {
			notify: (m, l) => revertNotifications.push({ m, l }),
			getAllThemes: () => previewThemes,
			setTheme: (n) => {
				revertSetCalls.push(n);
				return { success: true };
			},
			theme: makeTheme({ currentName: "theme-a" }),
			custom: async (factory) => {
				revertFactory = factory;
				return null; // cancel
			},
		},
	});
	const tuiRev = { requestRender() {} };
	const tRev = makeTheme({ currentName: "theme-a" });
	let revDoneValue = null;
	let revDoneCalled = false;
	const revDone = (v) => { revDoneValue = v; revDoneCalled = true; };
	const revComponent = revertFactory(tuiRev, tRev, {}, revDone);
	revComponent.handleInput("\x1b[B"); // Down: a -> b (preview)
	revComponent.handleInput("\x1b[B"); // Down: b -> c (preview)
	revComponent.handleInput("\x1b");  // Esc: revert to a, then cancel
	// 3 setTheme calls: preview-b, preview-c, revert-a.
	if (revertSetCalls.length !== 3) {
		throw new Error("expected 3 setTheme calls (2 preview + 1 revert), got " + revertSetCalls.length + ": " + JSON.stringify(revertSetCalls));
	}
	if (revertSetCalls[0] !== "theme-b" || revertSetCalls[1] !== "theme-c" || revertSetCalls[2] !== "theme-a") {
		throw new Error("setTheme calls wrong: " + JSON.stringify(revertSetCalls));
	}
	if (!revDoneCalled || revDoneValue !== null) {
		throw new Error("Esc should call done(null); got doneCalled=" + revDoneCalled + " doneValue=" + JSON.stringify(revDoneValue));
	}
	// Cancel is silent - no notifications.
	if (revertNotifications.length !== 0) {
		throw new Error("cancel should be silent; got: " + JSON.stringify(revertNotifications));
	}
	console.log("OK Esc reverts to original theme; cancel is silent");

	// ---- 11. Cancel without navigation is silent AND does not call setTheme ----
	// (regression check: even though we now have a hasChangedTheme
	// flag, an immediate Esc must not trigger any setTheme calls.)
	let cleanCancelSetCalls = [];
	let cleanCancelNotifications = [];
	let cleanCancelFactory = null;
	await themeCmd.handler("", {
		hasUI: true,
		ui: {
			notify: (m, l) => cleanCancelNotifications.push({ m, l }),
			getAllThemes: () => previewThemes,
			setTheme: (n) => {
				cleanCancelSetCalls.push(n);
				return { success: true };
			},
			theme: makeTheme({ currentName: "theme-a" }),
			custom: async (factory) => {
				cleanCancelFactory = factory;
				return null;
			},
		},
	});
	const tuiCC = { requestRender() {} };
	const tCC = makeTheme({ currentName: "theme-a" });
	const ccDone = () => {};
	const ccComponent = cleanCancelFactory(tuiCC, tCC, {}, ccDone);
	ccComponent.handleInput("\x1b"); // Esc immediately, no navigation
	if (cleanCancelSetCalls.length !== 0) {
		throw new Error("immediate Esc should not call setTheme (no preview happened); got: " + JSON.stringify(cleanCancelSetCalls));
	}
	if (cleanCancelNotifications.length !== 0) {
		throw new Error("immediate Esc should be silent; got: " + JSON.stringify(cleanCancelNotifications));
	}
	console.log("OK immediate Esc (no navigation) is silent and makes no setTheme calls");

	// ---- 12. Page-nav triggers preview; Esc reverts ----
	let pageNavSetCalls = [];
	let pageNavFactory = null;
	// 30 themes so 5 + 15 (maxVisible) = 20 stays in range and the
	// PageDown clamp doesn't kick in. The clamp-to-end behaviour is
	// exercised implicitly by other tests; here we want a clean
	// "moves by exactly maxVisible" assertion.
	const pageNavThemes = [];
	for (let i = 0; i < 30; i++) pageNavThemes.push({ name: `theme-${String(i).padStart(2, "0")}` });
	await themeCmd.handler("", {
		hasUI: true,
		ui: {
			notify: () => {},
			getAllThemes: () => pageNavThemes,
			setTheme: (n) => {
				pageNavSetCalls.push(n);
				return { success: true };
			},
			theme: makeTheme({ currentName: "theme-05" }),
			custom: async (factory) => {
				pageNavFactory = factory;
				return null;
			},
		},
	});
	const tuiPN = { requestRender() {} };
	const tPN = makeTheme({ currentName: "theme-05" });
	const pnDone = () => {};
	const pnComponent = pageNavFactory(tuiPN, tPN, {}, pnDone);
	pnComponent.handleInput("\x1b[6~");  // PageDown: 5 -> 20 (preview, +maxVisible)
	pnComponent.handleInput("\x1b[5;5~"); // Ctrl+PageUp: 20 -> 0 (preview, jump to first)
	pnComponent.handleInput("\x1b");      // Esc: revert to theme-05
	if (pageNavSetCalls.length !== 3) {
		throw new Error("expected 3 setTheme calls (PageDown preview, Ctrl+PageUp preview, revert), got " + pageNavSetCalls.length + ": " + JSON.stringify(pageNavSetCalls));
	}
	if (pageNavSetCalls[0] !== "theme-20" || pageNavSetCalls[1] !== "theme-00" || pageNavSetCalls[2] !== "theme-05") {
		throw new Error("page-nav setTheme calls wrong: " + JSON.stringify(pageNavSetCalls));
	}
	console.log("OK PageDown / Ctrl+PageUp trigger preview; Esc reverts to original");

	// ---- 13. Preview failure is non-fatal but notifies + picker state remains ----
	let failSetCalls = [];
	let failNotifications = [];
	let failFactory = null;
	await themeCmd.handler("", {
		hasUI: true,
		ui: {
			notify: (m, l) => failNotifications.push({ m, l }),
			getAllThemes: () => previewThemes,
			setTheme: (n) => {
				failSetCalls.push(n);
				if (n === "theme-c") return { success: false, error: "schema mismatch" };
				return { success: true };
			},
			theme: makeTheme({ currentName: "theme-a" }),
			custom: async (factory) => {
				failFactory = factory;
				return null;
			},
		},
	});
	const tuiFail = { requestRender() {} };
	const tFail = makeTheme({ currentName: "theme-a" });
	const failDone = () => {};
	const failComponent = failFactory(tuiFail, tFail, {}, failDone);
	failComponent.handleInput("\x1b[B"); // a -> b: preview theme-b (success)
	failComponent.handleInput("\x1b[B"); // b -> c: preview theme-c (FAILS)
	failComponent.handleInput("\x1b");  // Esc: revert to theme-a
	// 3 setTheme attempts: theme-b (ok), theme-c (fail), theme-a (revert).
	if (failSetCalls.length !== 3) {
		throw new Error("expected 3 setTheme attempts, got " + failSetCalls.length + ": " + JSON.stringify(failSetCalls));
	}
	if (failSetCalls[0] !== "theme-b" || failSetCalls[1] !== "theme-c" || failSetCalls[2] !== "theme-a") {
		throw new Error("setTheme attempts wrong: " + JSON.stringify(failSetCalls));
	}
	// Warning notification for the failed preview, naming the theme.
	const failWarn = failNotifications.find((n) => n.l === "warning" && /theme-c/.test(n.m) && /schema mismatch/.test(n.m));
	if (!failWarn) {
		throw new Error("preview failure warning missing: " + JSON.stringify(failNotifications));
	}
	// Picker state: still at theme-c (user's navigation, not snapped
	// back). User can press Esc to revert manually.
	if (failComponent.getPicker().getSelectedValue() !== "theme-c") {
		throw new Error("picker should remain at theme-c after preview failure, got: " + failComponent.getPicker().getSelectedValue());
	}
	console.log("OK preview failure warns but does not abort picker; Esc still reverts");

	// ---- 14. End-to-end preview + commit: handler calls setTheme on commit too ----
	// Unlike tests 9-13 (which use a null-resolving custom mock and
	// drive the picker manually), this test resolves custom with
	// the real chosen value so the handler's post-custom commit
	// path is exercised.
	let e2eSetCalls = [];
	let e2eNotifications = [];
	await themeCmd.handler("", {
		hasUI: true,
		ui: {
			notify: (m, l) => e2eNotifications.push({ m, l }),
			getAllThemes: () => previewThemes,
			setTheme: (n) => {
				e2eSetCalls.push(n);
				return { success: true };
			},
			theme: makeTheme({ currentName: "theme-a" }),
			custom: async (factory) => {
				const tui = { requestRender() {} };
				const t = makeTheme({ currentName: "theme-a" });
				let resolveDone;
				const donePromise = new Promise((resolve) => { resolveDone = resolve; });
				const component = factory(tui, t, {}, (v) => resolveDone(v));
				component.handleInput("\x1b[B"); // preview theme-b
				component.handleInput("\x1b[B"); // preview theme-c
				component.handleInput("\r");      // commit theme-c
				return await donePromise;
			},
		},
	});
	// 2 previews + 1 commit (idempotent) = 3 setTheme calls.
	if (e2eSetCalls.length !== 3) {
		throw new Error("expected 3 setTheme calls (2 preview + 1 commit), got " + e2eSetCalls.length + ": " + JSON.stringify(e2eSetCalls));
	}
	if (e2eSetCalls[0] !== "theme-b" || e2eSetCalls[1] !== "theme-c" || e2eSetCalls[2] !== "theme-c") {
		throw new Error("setTheme calls wrong: " + JSON.stringify(e2eSetCalls));
	}
	const e2eInfo = e2eNotifications.find((n) => n.l === "info" && /Switched to theme: theme-c/.test(n.m));
	if (!e2eInfo) {
		throw new Error("commit success notification missing: " + JSON.stringify(e2eNotifications));
	}
	console.log("OK end-to-end: preview fires setTheme on each move; commit fires setTheme + notify");

	// Drain the unresolved themeCheckPromise so the handler exits cleanly.
	await themeCheckPromise;

	console.log("\nALL THEME-CHECK CHECKS PASSED");
})().catch((err) => {
	console.error("FAIL:", err.message);
	if (err.stack) console.error(err.stack);
	process.exit(1);
});
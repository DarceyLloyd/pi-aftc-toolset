// Load-test harness for extensions/toolset/index.ts — no API calls, no TUI.
// Uses pi's bundled jiti to load the TS extension with a stub ExtensionAPI.
// Resolve the globally-installed pi package portably via `npm root -g`.
// Exercises the factory, every event handler, every slash command, and
// the widget render path end-to-end against a real SQLite DB so we
// verify per-turn recording actually inserts rows.
const { execSync } = require("node:child_process");
const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const PI_ROOT = require("node:path").join(
	globalRoot,
	"@earendil-works",
	"pi-coding-agent",
);
// sanity check
require("node:fs").statSync(PI_ROOT + "/package.json");
const fs = require("node:fs");
const { createJiti } = require(PI_ROOT + "/node_modules/jiti/lib/jiti.mjs");
const path = require("node:path");

const jiti = createJiti(__dirname, {
	// Function-style alias because jiti's string-alias rewrite loses the
	// package's `exports` map for nested subpaths (e.g. "compat", "oauth",
	// "providers/*"). This surfaces for the first time with cd.ts, which
	// imports SessionManager (which transitively loads
	// "@earendil-works/pi-ai/compat", "/oauth", "/providers/*", etc.).
	alias: (id) => {
		// Mirror the `@earendil-works/pi-ai/package.json` `exports` map for
		// the subpaths that pi-coding-agent's dist code reaches for.
		if (id === "@earendil-works/pi-coding-agent") return PI_ROOT;
		if (id === "@earendil-works/pi-ai")
			return PI_ROOT + "/node_modules/@earendil-works/pi-ai/dist/index.js";
		if (id === "@earendil-works/pi-ai/compat")
			return PI_ROOT + "/node_modules/@earendil-works/pi-ai/dist/compat.js";
		if (id === "@earendil-works/pi-ai/oauth")
			return PI_ROOT + "/node_modules/@earendil-works/pi-ai/dist/oauth.js";
		if (id === "@earendil-works/pi-ai/bedrock-provider")
			return (
				PI_ROOT + "/node_modules/@earendil-works/pi-ai/dist/bedrock-provider.js"
			);
		if (id.startsWith("@earendil-works/pi-ai/providers/"))
			return (
				PI_ROOT +
				"/node_modules/@earendil-works/pi-ai/dist/providers/" +
				id.slice("@earendil-works/pi-ai/providers/".length) +
				".js"
			);
		if (id.startsWith("@earendil-works/pi-ai/api/"))
			return (
				PI_ROOT +
				"/node_modules/@earendil-works/pi-ai/dist/api/" +
				id.slice("@earendil-works/pi-ai/api/".length) +
				".js"
			);
		if (id === "@earendil-works/pi-tui")
			return PI_ROOT + "/node_modules/@earendil-works/pi-tui";
		// Return undefined to defer to jiti's default resolution.
	},
});

// ---- Stub ExtensionAPI ----
const handlers = {};
const commands = {};
const shortcuts = {};
const tools = [
	{ name: "read", description: "Read a file", parameters: { type: "object" } },
	{
		name: "bash",
		description: "Run a shell command",
		parameters: { type: "object", properties: { command: { type: "string" } } },
	},
	{
		name: "skill_loader",
		description: "Load a skill",
		parameters: { type: "object" },
	},
];
let widgetSet; // current widget factory (or string[] / undefined)
let widgetKey = null;
let widgetOpts = null;

const pi = {
	on(evt, fn) {
		(handlers[evt] ||= []).push(fn);
	},
	registerCommand(name, opts) {
		commands[name] = opts;
	},
	registerShortcut(name, opts) {
		shortcuts[name] = opts;
	},
	registerTool() {},
	registerMessageRenderer() {},
	getAllTools() {
		return tools;
	},
	getActiveTools() {
		return tools.map((t) => t.name);
	},
	exec: async () => ({ stdout: "", stderr: "", code: 0 }),
	getThinkingLevel: () => "off",
	setWidget(key, content, opts) {
		if (content === undefined) {
			widgetKey = null;
			widgetSet = undefined;
			widgetOpts = null;
			return;
		}
		widgetKey = key;
		widgetSet = content;
		widgetOpts = opts || null;
	},
	_setTools(t) {
		tools.length = 0;
		tools.push(...t);
	},
	_getWidget() {
		return widgetSet;
	},
	_getWidgetKey() {
		return widgetKey;
	},
	_getWidgetOpts() {
		return widgetOpts;
	},
};

// stub ExtensionContext for session_start / events
function makeCtx() {
	return {
		hasUI: true,
		mode: "print",
		cwd: process.cwd(),
		ui: {
			notify: (m, l) => console.log(`[notify:${l}] ${m}`),
			select: async (title, lines, opts) => {
				console.log(`\n┌─ /${title} ─`);
				(lines || []).forEach((l) => console.log("│ " + l));
				console.log("└" + "─".repeat(title.length + 4));
				return undefined;
			},
			confirm: async () => true,
			setStatus: () => {}, // response.ts divider toggle calls this
			setWidget: (key, content, opts) => pi.setWidget(key, content, opts),
			// response.ts divider toggle calls theme.fg() for the status
			// indicator; provide a no-op stub.
			theme: { fg: () => "", bg: () => "", bold: (s) => s },
		},
		sessionManager: { getBranch: () => [], getEntries: () => [] },
		getSystemPrompt: () => "SYSTEM PROMPT v1",
		model: {
			name: "TestModel",
			id: "test-1",
			reasoning: true,
			contextWindow: 200000,
		},
	};
}

(async () => {
	// Clean up any persisted state files from previous test runs so
	// the test starts from a known-clean baseline. state.json persists
	// across runs; a leftover footerEnabled=false would mask the
	// default-on behaviour the test expects. (Leftover session_state.json
	// / data.json from the old per-session layout are also swept so they
	// don't linger in the data dir.)
	const dataDir = path.join(__dirname, "..", "..", ".pi-aftc-toolset", "data");
	for (const f of ["state.json", "session_state.json", "data.json"]) {
		const p = path.join(dataDir, f);
		if (fs.existsSync(p)) fs.unlinkSync(p);
	}

	// Timestamp captured before any message_end fires, so we can filter
	// rows to just THIS run (the shared DB has rows from previous test
	// invocations and from real pi sessions).
	const tsBefore = Date.now();
	console.log("=== Loading extension via jiti ===");
	const mod = jiti(
		path.resolve(__dirname, "../../extensions/toolset/index.ts"),
	);
	if (typeof mod.default !== "function")
		throw new Error("default export is not a function");
	mod.default(pi);
	console.log(
		"Factory ran OK. Registered commands:",
		Object.keys(commands).join(", "),
	);

	// session_start
	await Promise.all(
		(handlers.session_start || []).map((h) =>
			h({ reason: "startup" }, makeCtx()),
		),
	);
	console.log(
		"session_start OK. Widget set:",
		pi._getWidgetKey() || "(none)",
		"placement:",
		pi._getWidgetOpts()?.placement,
	);

	// before_agent_start
	await Promise.all(
		(handlers.before_agent_start || []).map((h) =>
			h({ systemPrompt: "SYSTEM PROMPT v1" }, makeCtx()),
		),
	);

	// model_select + thinking_level_select
	await Promise.all(
		(handlers.model_select || []).map((h) =>
			h(
				{
					model: {
						name: "M2",
						id: "m2",
						reasoning: false,
						contextWindow: 128000,
					},
				},
				makeCtx(),
			),
		),
	);
	await Promise.all(
		(handlers.thinking_level_select || []).map((h) =>
			h({ level: "high", previousLevel: "off" }, makeCtx()),
		),
	);

	// message_end — turn 1 (cold, no cache)
	await Promise.all(
		(handlers.message_start || []).map((h) =>
			h(
				{
					message: { role: "user", content: "hi" },
				},
				makeCtx(),
			),
		),
	);
	await Promise.all(
		(handlers.message_end || []).map((h) =>
			h(
				{
					message: {
						role: "assistant",
						usage: {
							cacheRead: 0,
							cacheWrite: 5000,
							input: 5000,
							output: 300,
							totalTokens: 5300,
							cost: { total: 0.01 },
						},
					},
					model: { name: "M2", id: "m2" },
				},
				makeCtx(),
			),
		),
	);

	// message_end — turn 2 (warm cache)
	await Promise.all(
		(handlers.message_start || []).map((h) =>
			h(
				{
					message: { role: "user", content: "follow-up" },
				},
				makeCtx(),
			),
		),
	);
	await Promise.all(
		(handlers.message_end || []).map((h) =>
			h(
				{
					message: {
						role: "assistant",
						usage: {
							cacheRead: 4800,
							cacheWrite: 200,
							input: 400,
							output: 350,
							totalTokens: 5750,
							cost: { total: 0.005 },
						},
					},
					model: { name: "M2", id: "m2" },
				},
				makeCtx(),
			),
		),
	);

	// message_end — turn 3 with a TOOL SET CHANGE to trigger churn detection
	pi._setTools([
		...tools,
		{
			name: "edit",
			description: "Edit a file",
			parameters: { type: "object" },
		},
	]);
	await Promise.all(
		(handlers.before_agent_start || []).map((h) =>
			h({ systemPrompt: "SYSTEM PROMPT v1" }, makeCtx()),
		),
	);
	await Promise.all(
		(handlers.message_start || []).map((h) =>
			h(
				{
					message: { role: "user", content: "third" },
				},
				makeCtx(),
			),
		),
	);
	await Promise.all(
		(handlers.message_end || []).map((h) =>
			h(
				{
					message: {
						role: "assistant",
						usage: {
							cacheRead: 200,
							cacheWrite: 5200,
							input: 5000,
							output: 200,
							totalTokens: 10400,
							cost: { total: 0.02 },
						},
					},
					model: { name: "M2", id: "m2" },
				},
				makeCtx(),
			),
		),
	);

	// agent_end
	await Promise.all((handlers.agent_end || []).map((h) => h({}, makeCtx())));

	// session_compact
	await Promise.all(
		(handlers.session_compact || []).map((h) => h({}, makeCtx())),
	);

	console.log("\n=== Running command handlers ===");
	// Render widget with REAL accumulated data (before reset)
	console.log("=== Widget render with real turn data (before reset) ===");
	const wf1 = pi._getWidget();
	if (typeof wf1 === "function") {
		const tui = { requestRender() {} };
		const theme = { bg: (_c, s) => s, fg: (_c, s) => s };
		const c1 = wf1(tui, theme);
		const ls = c1.render(100);
		ls.forEach((l, i) => console.log(`  L${i + 1}: ${l.trim()}`));
		c1.dispose?.();
	} else {
		throw new Error("widget factory not set: " + typeof wf1);
	}
	console.log("--- /cache-stats ---");
	await commands["cache-stats"].handler("", makeCtx());
	console.log("--- /cache-profile ---");
	await commands["cache-profile"].handler("", makeCtx());
	console.log("--- /aftc-footer (toggle off) ---");
	await commands["aftc-footer"].handler("", makeCtx());
	if (pi._getWidgetKey() !== null)
		throw new Error("/aftc-footer did not clear the widget");
	console.log("--- /aftc-footer (toggle on) ---");
	await commands["aftc-footer"].handler("", makeCtx());
	if (pi._getWidgetKey() !== "aftc-cache")
		throw new Error("/aftc-footer did not re-show the widget");
	console.log("--- /cache-reset ---");
	await commands["cache-reset"].handler("", makeCtx());

	// ---- Remaining safe commands (no side effects) ----
	console.log("--- /aftc-help ---");
	await commands["aftc-help"].handler("", makeCtx());
	console.log("--- /aftc-response-divider (toggle off) ---");
	await commands["aftc-response-divider"].handler("", makeCtx());
	console.log("--- /aftc-response-divider (toggle on) ---");
	await commands["aftc-response-divider"].handler("", makeCtx());
	console.log("--- /cost-timer-info (removed) ---");
	console.log("--- /cls ---");
	await commands["cls"].handler("", makeCtx());
	console.log("--- input-clear shortcut (alt+c) ---");
	if (!shortcuts["alt+c"]) throw new Error("alt+c shortcut not registered");
	await shortcuts["alt+c"].handler(makeCtx());
	// /usage-report writes .pi-aftc-toolset/data/report.html and tries to
	// launch a browser (fire-and-forget via the stub pi.exec). Just
	// verify the handler runs without throwing.
	console.log("--- /usage-report ---");
	await commands["usage-report"].handler("", makeCtx());

	// Test widget render directly
	console.log("\n=== Widget render test (after reset) ===");
	const widgetFactory = pi._getWidget();
	if (typeof widgetFactory === "function") {
		const tui = { requestRender() {} };
		const theme = { bg: (_c, s) => s, fg: (_c, s) => s };
		const widget = widgetFactory(tui, theme);
		const lines = widget.render(120);
		console.log(`Rendered ${lines.length} lines (width 120):`);
		lines.forEach((l, i) => console.log(`  L${i + 1}: ${l.trim()}`));
		widget.dispose?.();
		// render again to ensure no per-frame crash
		widget.render(40);
		console.log("Second render (width 40) OK");
	} else {
		throw new Error("widget not a factory function: " + typeof widgetFactory);
	}

	// Verify SQLite recording actually inserted rows for the 3 message_end
	// turns we triggered above. Each assistant turn with usage > 0 tokens
	// must produce exactly one row in `turns` with the right fields.
	console.log("\n=== SQLite recording verification ===");
	const Database = require("better-sqlite3");
	const dbPath = path.join(
		__dirname,
		"..",
		"..",
		".pi-aftc-toolset",
		"data",
		"turns.db",
	);
	const db = new Database(dbPath, { readonly: true });
	// Filter by the timestamp captured at the start of the test so we
	// only see rows from THIS run (cost values 0.01, 0.005, 0.02 are
	// unique to this test but the DB is shared with previous runs).
	const rows = db
		.prepare(`
        SELECT turn, model_name, thinking_level, thinking_ms, response_ms,
               cost_usd, input_tokens, output_tokens, cache_read, cache_write,
               user_prompt, base_prompt, sub_prompt, prompt_kind
        FROM turns
        WHERE timestamp >= ?
          AND cost_usd IN (0.01, 0.005, 0.02)
          AND model_name = 'M2'
        ORDER BY turn ASC
    `)
		.all(tsBefore);
	if (rows.length !== 3) {
		throw new Error(`expected 3 recorded turns, got ${rows.length}`);
	}
	console.log(`OK found ${rows.length} recorded turns for this run:`);
	rows.forEach((r) =>
		console.log(
			`  turn=${r.turn} model=${r.model_name} think=${r.thinking_level} cost=$${r.cost_usd} in=${r.input_tokens} cached=${r.cache_read} user_prompt=${r.user_prompt} kind=${r.prompt_kind}`,
		),
	);
	// Each recorded turn should be a user prompt (the message_start for
	// user we fired earlier made them so).
	for (const r of rows) {
		if (r.user_prompt !== 1)
			throw new Error(
				`turn ${r.turn}: user_prompt=${r.user_prompt}, expected 1`,
			);
		if (r.model_name !== "M2")
			throw new Error(
				`turn ${r.turn}: model_name=${r.model_name}, expected M2`,
			);
		if (r.thinking_level !== "high")
			throw new Error(
				`turn ${r.turn}: thinking_level=${r.thinking_level}, expected high (we set it via thinking_level_select)`,
			);
		if (r.cache_read < 0 || r.cache_write < 0)
			throw new Error(`turn ${r.turn}: negative cache tokens`);
		if (r.cost_usd <= 0)
			throw new Error(`turn ${r.turn}: cost_usd=${r.cost_usd}, expected > 0`);
		// Cost signatures should be exactly 0.01, 0.005, 0.02 in order
		// (asc). The first turn is the "base" prompt, the next two are
		// continuations (turn 3's tool-change churn).
	}
	const expectedCosts = [0.01, 0.005, 0.02];
	for (let i = 0; i < rows.length; i++) {
		if (Math.abs(rows[i].cost_usd - expectedCosts[i]) > 1e-9) {
			throw new Error(
				`turn ${i}: expected cost $${expectedCosts[i]}, got $${rows[i].cost_usd}`,
			);
		}
	}
	console.log(
		"OK all rows have correct model_name, thinking_level, user_prompt flag, cost signatures, and positive cost/cache tokens",
	);
	db.close();

	// Clean up persisted state so this run's /aftc-footer toggle (which
	// writes footerEnabled=false) doesn't suppress the widget in a later
	// test run that reads the same state.json.
	for (const f of ["state.json", "session_state.json", "data.json"]) {
		const p = path.join(dataDir, f);
		try { fs.unlinkSync(p); } catch (_) { /* ignore */ }
	}

	console.log("\n=== ALL TESTS PASSED ===");
})().catch((e) => {
	console.error("TEST FAILED:", e);
	process.exit(1);
});

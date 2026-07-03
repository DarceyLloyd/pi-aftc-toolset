// Stfu-check — focused smoke test for extensions/toolset/stfu.ts.
//
// Loads the stfu module via pi's bundled jiti with a stub ExtensionAPI,
// then verifies:
//   1. Both /aftc-stop and /stfu register.
//   2. When ctx.isIdle() returns true, both handlers emit the
//      "Agent is already idle" notification and do NOT call ctx.abort().
//   3. When ctx.isIdle() returns false, both handlers call ctx.abort()
//      and emit the "Stopped via /..." notification.
//
// No API calls, no TUI, no live pi session.
//
// Resolves paths from __dirname so it runs from any cwd (rules.md §11.4).

const { execSync } = require("node:child_process");
const path = require("node:path");

// ---- Locate the globally-installed pi package (portable) ----
const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const PI_ROOT = require("node:path").join(globalRoot, "@earendil-works", "pi-coding-agent");
require("node:fs").statSync(PI_ROOT + "/package.json");
const { createJiti } = require(PI_ROOT + "/node_modules/jiti/lib/jiti.mjs");

const jiti = createJiti(__dirname, {
    alias: {
        "@earendil-works/pi-coding-agent": PI_ROOT,
        "@earendil-works/pi-ai": PI_ROOT + "/node_modules/@earendil-works/pi-ai",
        "@earendil-works/pi-tui": PI_ROOT + "/node_modules/@earendil-works/pi-tui",
    },
});

// ---- Stub ExtensionAPI ----
const commands = {};
const pi = {
    on() {},
    registerCommand(name, opts) { commands[name] = opts; },
    registerShortcut() {},
    registerTool() {},
    registerMessageRenderer() {},
    getAllTools() { return []; },
    getActiveTools() { return []; },
    getThinkingLevel() { return "off"; },
    exec: async () => ({ stdout: "", stderr: "", code: 0 }),
    setWidget() {},
};

// ---- Per-test state — resets between cases ----
let idle = true;
let abortCalls = 0;
let lastNotify = null; // { message, level } or null
let lastAbortReason = null;
let notifyCallCount = 0;

function makeCtx() {
    return {
        hasUI: true,
        mode: "tui",
        cwd: process.cwd(),
        ui: {
            notify: (message, level) => { notifyCallCount++; lastNotify = { message, level }; },
            select: async () => undefined,
            confirm: async () => true,
            setStatus: () => {},
            setWidget: () => {},
            theme: { fg: () => "", bg: () => "", bold: (s) => s },
        },
        sessionManager: { getBranch: () => [], getEntries: () => [] },
        isIdle: () => idle,
        abort: () => { abortCalls++; lastAbortReason = "ctx.abort()"; },
    };
}

function reset() {
    idle = true;
    abortCalls = 0;
    lastNotify = null;
    lastAbortReason = null;
    notifyCallCount = 0;
}

function assert(cond, msg) {
    if (!cond) {
        console.error("FAIL:", msg);
        process.exit(1);
    }
    console.log("OK:", msg);
}

(async () => {
    // ---- 1. Load the module ----
    console.log("=== Loading stfu.ts via jiti ===");
    const mod = jiti(path.resolve(__dirname, "../../extensions/toolset/stfu.ts"));
    if (typeof mod.createStfu !== "function") {
        console.error("FAIL: createStfu is not a function");
        process.exit(1);
    }
    mod.createStfu(pi);
    console.log("Factory ran OK. Registered commands:", Object.keys(commands).join(", "));

    // ---- 2. Verify both commands registered ----
    assert(typeof commands["aftc-stop"] === "object", "/aftc-stop is registered");
    assert(typeof commands["stfu"] === "object", "/stfu is registered");
    assert(typeof commands["aftc-stop"].handler === "function", "/aftc-stop has handler");
    assert(typeof commands["stfu"].handler === "function", "/stfu has handler");
    assert(typeof commands["aftc-stop"].description === "string", "/aftc-stop has description");
    assert(typeof commands["stfu"].description === "string", "/stfu has description");

    // ---- 3. Idle behavior — both handlers should notify, not abort ----
    reset();
    await commands["aftc-stop"].handler("", makeCtx());
    assert(abortCalls === 0, "/aftc-stop does NOT call ctx.abort() when idle");
    assert(lastNotify && lastNotify.message.includes("already idle"),
        `/aftc-stop notifies "already idle" when idle (got: ${JSON.stringify(lastNotify)})`);
    assert(lastNotify.level === "info", "/aftc-stop idle notification level is 'info'");

    reset();
    await commands["stfu"].handler("", makeCtx());
    assert(abortCalls === 0, "/stfu does NOT call ctx.abort() when idle");
    assert(lastNotify && lastNotify.message.includes("already idle"),
        `/stfu notifies "already idle" when idle (got: ${JSON.stringify(lastNotify)})`);
    assert(lastNotify.level === "info", "/stfu idle notification level is 'info'");

    // ---- 4. Streaming behavior — both handlers should abort + notify ----
    reset();
    idle = false;
    await commands["aftc-stop"].handler("", makeCtx());
    assert(abortCalls === 1, "/aftc-stop calls ctx.abort() exactly once when streaming");
    assert(lastNotify && lastNotify.message.includes("aftc-stop"),
        `/aftc-stop notifies "Stopped via /aftc-stop" when streaming (got: ${JSON.stringify(lastNotify)})`);
    assert(lastNotify.level === "warning", "/aftc-stop streaming notification level is 'warning'");

    reset();
    idle = false;
    await commands["stfu"].handler("", makeCtx());
    assert(abortCalls === 1, "/stfu calls ctx.abort() exactly once when streaming");
    assert(lastNotify && lastNotify.message.includes("stfu"),
        `/stfu notifies "Stopped via /stfu" when streaming (got: ${JSON.stringify(lastNotify)})`);
    assert(lastNotify.level === "warning", "/stfu streaming notification level is 'warning'");

    // ---- 5. Headless mode — no notify, just console.log ----
    const headlessLogs = [];
    const origLog = console.log;
    console.log = (...args) => headlessLogs.push(args.join(" "));
    try {
        // idle
        idle = true;
        reset();
        const headlessIdle = makeCtx();
        headlessIdle.hasUI = false;
        const headlessIdleNotifyCount = { n: 0 };
        headlessIdle.ui.notify = () => { headlessIdleNotifyCount.n++; };
        await commands["aftc-stop"].handler("", headlessIdle);
        assert(abortCalls === 0, "headless /aftc-stop does NOT call ctx.abort() when idle");
        assert(headlessIdleNotifyCount.n === 0, "headless /aftc-stop does NOT call notify when idle");
        assert(headlessLogs.some(l => l.includes("already idle")),
            "headless /aftc-stop logs idle state to stdout");

        // streaming
        reset();
        idle = false;
        headlessLogs.length = 0;
        const headlessStreaming = makeCtx();
        headlessStreaming.hasUI = false;
        const headlessStreamingNotifyCount = { n: 0 };
        headlessStreaming.ui.notify = () => { headlessStreamingNotifyCount.n++; };
        await commands["stfu"].handler("", headlessStreaming);
        assert(abortCalls === 1, "headless /stfu calls ctx.abort() when streaming");
        assert(headlessStreamingNotifyCount.n === 0, "headless /stfu does NOT call notify");
        assert(headlessLogs.some(l => l.includes("aborted via /stfu")),
            "headless /stfu logs abort to stdout");
    } finally {
        console.log = origLog;
    }

    console.log("\n=== ALL STFU CHECKS PASSED ===");
})().catch((err) => {
    console.error("FATAL:", err.stack || err.message);
    process.exit(1);
});
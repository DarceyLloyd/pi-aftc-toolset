import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_TIMEOUT_MS = 30_000;
const watchdog = setTimeout(() => {
    console.error(`FAIL: test exceeded global ${TEST_TIMEOUT_MS}ms timeout`);
    process.exit(2);
}, TEST_TIMEOUT_MS);
watchdog.unref();

const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(dirname(testDir));
const npmRoots = process.platform === "win32"
    ? [join(process.env.APPDATA || "", "npm", "node_modules")]
    : [
        execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(),
        join(process.env.HOME || "", ".local", "lib", "node_modules"),
        join(process.env.HOME || "", ".local", "share", "pnpm", "global", "5", "node_modules"),
    ];
const jitiPath = npmRoots
    .map((root) => join(root, "@earendil-works", "pi-coding-agent", "node_modules", "jiti", "lib", "jiti.cjs"))
    .find(existsSync);
if (!jitiPath) throw new Error("Pi's bundled TypeScript loader was not found.");
const piPackageRoot = dirname(dirname(dirname(dirname(jitiPath))));
const piNodeModules = dirname(dirname(piPackageRoot));
process.env.NODE_PATH = [process.env.NODE_PATH, piNodeModules].filter(Boolean).join(delimiter);
Module._initPaths();
const createJiti = createRequire(import.meta.url)(jitiPath);
const { createAllowance, formatAdaptiveDuration, allowanceTestUtils } = createJiti(packageRoot, { interopDefault: true })(
    join(packageRoot, "extensions", "aftc-toolset", "allowance.ts"),
);

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll a condition (the timer tick is fire-and-forget, so its fetch
 *  completes a few microtasks after the tick callback returns). */
async function waitFor(condition, what) {
    for (let i = 0; i < 200; i++) {
        if (condition()) return;
        await sleep(10);
    }
    throw new Error(`Timed out waiting for ${what}`);
}

if (formatAdaptiveDuration(330) !== "05m 30s") {
    throw new Error("Allowance duration formatter returned an unexpected value.");
}

// ──────────────────────────────────────────────────────────────────────
// Codex regression (existing coverage)
// ──────────────────────────────────────────────────────────────────────
const handlers = new Map();
const allowance = createAllowance({
    on(name, handler) {
        handlers.set(name, handler);
    },
});
const originalFetch = globalThis.fetch;
let requestUrl = "";
globalThis.fetch = async (url) => {
    requestUrl = String(url);
    return new Response(JSON.stringify({
        plan_type: "plus",
        rate_limit: {
            primary_window: {
                limit_window_seconds: 604800,
                reset_after_seconds: 3600,
                reset_at: Math.floor(Date.now() / 1000) + 3600,
                used_percent: 42,
            },
        },
    }), { status: 200, headers: { "content-type": "application/json" } });
};

try {
    const sessionStart = handlers.get("session_start");
    if (!sessionStart) throw new Error("Allowance module did not register session_start.");
    await sessionStart({}, {
        model: { provider: "openai-codex" },
        modelRegistry: { getApiKeyForProvider: async () => "test-token" },
    });

    const view = allowance.getAllowance();
    if (requestUrl !== "https://chatgpt.com/backend-api/wham/usage") {
        throw new Error("Allowance module did not request the Codex usage endpoint.");
    }
    if (!view || view.providerLabel !== "ChatGPT Plus" || view.fiveHour !== null || view.weekly?.usedPercent !== 42) {
        throw new Error("Allowance module did not retain the Codex weekly allowance response.");
    }
} finally {
    globalThis.fetch = originalFetch;
}

console.log("Allowance provider and Codex regression checks passed.");

// ──────────────────────────────────────────────────────────────────────
// Kimi parser unit checks (pure, via the test-utils export)
// ──────────────────────────────────────────────────────────────────────
const kimiBody = {
    user: { userId: "u1", region: "REGION_OVERSEA", membership: { level: "LEVEL_INTERMEDIATE" }, businessId: "" },
    usage: { limit: "100", used: "66", remaining: "34", resetTime: "2026-07-24T03:31:57.067911Z" },
    limits: [
        {
            window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
            detail: { limit: "100", used: "22", remaining: "78", resetTime: "2026-07-18T14:31:57.067911Z" },
        },
    ],
    parallel: { limit: "20" },
    totalQuota: { limit: "100", remaining: "99" },
};

const kimiView = allowanceTestUtils.parseKimi(kimiBody);
assert(kimiView.providerLabel === "Kimi", "Kimi label should be plain 'Kimi'.");
assert(kimiView.weekly?.usedPercent === 66, "Kimi weekly usedPercent mismatch.");
assert(kimiView.fiveHour?.usedPercent === 22, "Kimi 5h usedPercent mismatch.");
assert(kimiView.weekly?.resetAt === Date.parse("2026-07-24T03:31:57.067911Z"), "Kimi weekly resetAt mismatch.");
assert(kimiView.fiveHour?.resetAt === Date.parse("2026-07-18T14:31:57.067911Z"), "Kimi 5h resetAt mismatch.");

// No membership tier -> plain label; no limits array -> 5h window null.
const kimiNoTier = allowanceTestUtils.parseKimi({ usage: kimiBody.usage });
assert(kimiNoTier.providerLabel === "Kimi", "Kimi label should fall back to plain 'Kimi'.");
assert(kimiNoTier.fiveHour === null, "Kimi 5h window should be null without a limits array.");
assert(kimiNoTier.weekly?.usedPercent === 66, "Kimi weekly window should still parse without a limits array.");

// A zero/invalid limit must not divide by zero — that window becomes null.
const kimiZeroLimit = allowanceTestUtils.parseKimi({ usage: { limit: "0", used: "0" }, limits: kimiBody.limits });
assert(kimiZeroLimit.weekly === null, "Kimi window with a zero limit should be null.");
assert(kimiZeroLimit.fiveHour?.usedPercent === 22, "Kimi 5h window should still parse when weekly is invalid.");

// No usable windows -> throws (refresh keeps the previous snapshot).
let kimiThrew = false;
try {
    allowanceTestUtils.parseKimi({ user: {} });
} catch {
    kimiThrew = true;
}
assert(kimiThrew, "Kimi parser should throw when both windows are missing.");

console.log("Kimi parser checks passed.");

// ──────────────────────────────────────────────────────────────────────
// Kimi fetch flow + periodic timer lifecycle
//
// The 3-minute timer must ONLY run while a prompt is in flight:
//   session_start      -> initial fetch, NO timer
//   before_agent_start -> timer starts (idempotent, 180000ms)
//   tick               -> throttled refresh while active
//   agent_end          -> throttled refresh, timer KEEPS running
//   agent_settled      -> final FORCED fetch, timer stopped
//   unsupported provider -> no timer at all
// ──────────────────────────────────────────────────────────────────────
const kimiHandlers = new Map();
const kimiAllowance = createAllowance({
    on(name, handler) {
        kimiHandlers.set(name, handler);
    },
});

const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
const realDateNow = Date.now;
const originalFetch2 = globalThis.fetch;

const timers = [];
globalThis.setInterval = (cb, ms) => {
    const t = { cb, ms, cleared: false, unref() {} };
    timers.push(t);
    return t;
};
globalThis.clearInterval = (t) => {
    if (t) t.cleared = true;
};

let dateOffset = 0;
Date.now = () => realDateNow() + dateOffset;

let kimiFetchCalls = 0;
let fetchMode = "ok"; // "ok" | "404" | "garbage"
globalThis.fetch = async (url) => {
    if (String(url) !== "https://api.kimi.com/coding/v1/usages") {
        throw new Error(`Unexpected allowance URL: ${url}`);
    }
    if (fetchMode === "404") {
        return new Response("not found", { status: 404 });
    }
    if (fetchMode === "garbage") {
        return new Response(JSON.stringify({ hello: "world" }), {
            status: 200, headers: { "content-type": "application/json" },
        });
    }
    kimiFetchCalls++;
    return new Response(JSON.stringify({
        user: { membership: { level: "LEVEL_INTERMEDIATE" } },
        usage: {
            limit: "100", used: "66", remaining: "34",
            resetTime: new Date(realDateNow() + 134 * 3600_000).toISOString(),
        },
        limits: [
            {
                window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
                detail: {
                    limit: "100", used: "22", remaining: "78",
                    resetTime: new Date(realDateNow() + 3600_000).toISOString(),
                },
            },
        ],
    }), { status: 200, headers: { "content-type": "application/json" } });
};

const kimiCtx = {
    model: { provider: "kimi-coding" },
    modelRegistry: { getApiKeyForProvider: async () => "kimi-test-token" },
    isIdle: () => false,
};

try {
    // 1) session_start: initial fetch, but NO timer while pi is idle.
    await kimiHandlers.get("session_start")({}, kimiCtx);
    assert(kimiFetchCalls === 1, "Kimi session_start should fetch once.");
    assert(timers.length === 0, "No timer may run before the first prompt.");
    let kv = kimiAllowance.getAllowance();
    assert(kv && kv.providerLabel === "Kimi", "Kimi view mismatch after session_start.");
    assert(kv.fiveHour?.usedPercent === 22 && kv.weekly?.usedPercent === 66, "Kimi view percentages mismatch.");
    assert(
        kv.fiveHour.resetSeconds !== null && kv.fiveHour.resetSeconds <= 3600 && kv.fiveHour.resetSeconds > 3500,
        "Kimi 5h reset countdown was not derived from resetTime.",
    );

    // 2) before_agent_start: a prompt is in flight -> timer starts.
    await kimiHandlers.get("before_agent_start")({}, kimiCtx);
    assert(timers.length === 1, "before_agent_start should start the periodic timer.");
    assert(timers[0].ms === 180_000, "Periodic timer should use a 180000ms cadence.");
    assert(!timers[0].cleared, "The new timer should be running.");
    assert(kimiFetchCalls === 1, "before_agent_start refresh should be throttled right after session_start.");

    // 3) Tick inside the 30s throttle window -> no fetch.
    timers[0].cb();
    await sleep(50);
    assert(kimiFetchCalls === 1, "Timer tick should respect the 30s fetch throttle.");

    // 4) Tick after the throttle window -> fetch #2 (no ctx needed: the
    //    tick reuses the registry captured from session_start).
    dateOffset += 31_000;
    timers[0].cb();
    await waitFor(() => kimiFetchCalls === 2, "timer tick refresh");
    assert(!timers[0].cleared, "Timer must keep running while the prompt is active.");

    // 5) agent_end: throttled refresh (skipped, just fetched), timer stays.
    await kimiHandlers.get("agent_end")({}, kimiCtx);
    assert(kimiFetchCalls === 2, "agent_end refresh should be throttled right after a tick fetch.");
    assert(!timers[0].cleared, "Timer must keep running at agent_end (pi may auto-continue).");

    // 6) agent_settled: one final FORCED fetch, then the timer stops.
    await kimiHandlers.get("agent_settled")({}, kimiCtx);
    assert(kimiFetchCalls === 3, "agent_settled should do a final forced fetch.");
    assert(timers[0].cleared, "Timer must be stopped at agent_settled.");

    // 7) Next prompt cycle restarts the timer; duplicate start signals
    //    (before_agent_start + repeated agent_start) never stack timers.
    await kimiHandlers.get("before_agent_start")({}, kimiCtx);
    await kimiHandlers.get("agent_start")({}, kimiCtx);
    await kimiHandlers.get("agent_start")({}, kimiCtx);
    assert(timers.length === 2, "A new prompt should start exactly one new timer.");
    assert(!timers[1].cleared, "The second-cycle timer should be running.");

    // 8) agent_settled again: final fetch + timer stopped.
    await kimiHandlers.get("agent_settled")({}, kimiCtx);
    assert(kimiFetchCalls === 4, "agent_settled should force a fetch in the second cycle.");
    assert(timers[1].cleared, "Second-cycle timer must be stopped at agent_settled.");

    // 9) Unsupported provider: view cleared, NO timer is started.
    await kimiHandlers.get("before_agent_start")({}, {
        model: { provider: "deepseek" },
        modelRegistry: { getApiKeyForProvider: async () => "deepseek-test-token" },
    });
    assert(kimiAllowance.getAllowance() === null, "Allowance view should clear for an unsupported provider.");
    assert(timers.length === 2, "No timer may start for an unsupported provider.");
    assert(kimiFetchCalls === 4, "Unsupported provider must not fetch.");

    // 10) Switching back to Kimi force-refreshes immediately.
    await kimiHandlers.get("model_select")({ model: { provider: "kimi-coding" } }, kimiCtx);
    assert(kimiFetchCalls === 5, "Switching back to Kimi should force a refresh.");
    kv = kimiAllowance.getAllowance();
    assert(kv && kv.providerLabel === "Kimi", "Kimi view should return after switching back.");

    // 11) Endpoint failures hide line 5 until the next success: never
    //     render stale numbers or data we did not get.
    fetchMode = "404";
    await kimiHandlers.get("agent_settled")({}, kimiCtx);
    assert(kimiAllowance.getAllowance() === null, "Allowance view must clear on an HTTP error.");

    fetchMode = "ok";
    await kimiHandlers.get("agent_settled")({}, kimiCtx);
    assert(kimiAllowance.getAllowance() !== null, "Allowance view should recover after the endpoint recovers.");

    fetchMode = "garbage";
    await kimiHandlers.get("agent_settled")({}, kimiCtx);
    assert(kimiAllowance.getAllowance() === null, "Allowance view must clear on an unexpected response shape.");

    fetchMode = "ok";
    await kimiHandlers.get("agent_settled")({}, kimiCtx);
    assert(kimiAllowance.getAllowance() !== null, "Allowance view should recover after the shape is restored.");

    // 12) A fresh session whose first fetch fails never shows line 5.
    const failHandlers = new Map();
    const failAllowance = createAllowance({ on(name, handler) { failHandlers.set(name, handler); } });
    fetchMode = "404";
    await failHandlers.get("session_start")({}, kimiCtx);
    assert(failAllowance.getAllowance() === null, "Line 5 must stay hidden when the first fetch fails.");
    fetchMode = "ok";

    // 13) Desync guard: while the timer is running the tick asks pi
    //     whether the agent is still active (ctx.isIdle). When pi reports
    //     idle — e.g. a completion event was missed — the tick does one
    //     final forced query and shuts the timer down.
    kimiCtx.isIdle = () => true;
    await kimiHandlers.get("before_agent_start")({}, kimiCtx);
    assert(timers.length === 3, "A new prompt should start a third timer.");
    assert(!timers[2].cleared, "The third timer should be running.");
    timers[2].cb();
    await waitFor(() => timers[2].cleared, "desync timer shutdown");
    assert(kimiFetchCalls === 8, "The desync tick should do one final forced fetch.");
    kimiCtx.isIdle = () => false;

    // 14) session_shutdown with no timer running: clean no-op.
    await kimiHandlers.get("session_shutdown")();
    assert(timers.every((t) => t.cleared), "All timers should be cleared at the end of the flow.");
} finally {
    globalThis.fetch = originalFetch2;
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
    Date.now = realDateNow;
}

console.log("Kimi fetch flow and periodic timer lifecycle checks passed.");

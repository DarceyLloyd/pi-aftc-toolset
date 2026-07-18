/**
 * pi-aftc-toolset — subscription allowance data module (footer line 5).
 *
 * Fetches the 5-hour rolling + weekly allowance windows for the
 * subscription providers that expose a usable usage endpoint, and
 * exposes a cached snapshot via `AllowanceProvider` (read by core.ts,
 * rendered as the footer's 5th line by footer-widget.ts).
 *
 * Supported providers (verified live against real credentials):
 *
 *   • `openai-codex` (ChatGPT Plus/Pro via OAuth) — FETCH
 *       GET https://chatgpt.com/backend-api/wham/usage
 *       Auth: Bearer <oauth access token> + ChatGPT-Account-Id
 *       Body: rate_limit.primary_window (5h) + .secondary_window (weekly),
 *             each with `used_percent` + `reset_after_seconds` (+ reset_at).
 *
 *   • `minimax` / `minimax-cn` (Token Plan) — FETCH
 *       GET https://www.minimax.io/v1/token_plan/remains  (CN: minimaxi.com)
 *       Auth: Bearer <subscription key> (= the provider API key in auth.json)
 *       Body: model_remains[] → entry where model_name == "general" is the
 *             LLM bucket. Reports REMAINING percent (converted to used here)
 *             and `remains_time` / `weekly_remains_time` in MILLISECONDS.
 *
 *   • `zai` / `zai-coding-cn` (GLM Coding Plan) — FETCH
 *       GET https://api.z.ai/api/monitor/usage/quota/limit
 *       (CN: https://open.bigmodel.cn/api/monitor/usage/quota/limit)
 *       Auth: Bearer <ZAI_API_KEY> (raw token also accepted).
 *       Body: data.limits[] → TOKENS_LIMIT unit 3 (5h) + unit 6 (weekly),
 *             each with `percentage` (USED) + `nextResetTime` (epoch MS).
 *             data.level = "lite"/"pro"/"max". NB: this endpoint lives under
 *             /api/monitor/, NOT the /api/coding/paas/v4/ chat base.
 *
 *   • `kimi-coding` (Kimi for Coding subscription) — FETCH
 *       GET https://api.kimi.com/coding/v1/usages
 *       Auth: Bearer <subscription key> (= the kimi-coding API key in auth.json)
 *       Body: usage{} is the WEEKLY window; limits[] holds the rolling
 *             5-hour rate window (window.duration 300 TIME_UNIT_MINUTE),
 *             each with `limit`/`used`/`remaining` as STRINGS and
 *             `resetTime` as an ISO-8601 UTC string. The website usage
 *             panel was verified to match this endpoint 1:1 (2026-07-18).
 *
 *   • `anthropic` (Claude Pro/Max via OAuth subscription) — HEADERS
 *       No fetch: reads `anthropic-ratelimit-unified-5h-utilization`,
 *       `-5h-reset`, `-7d-utilization`, `-7d-reset` from every response via
 *       pi's `after_provider_response` event (all headers are passed through
 *       unfiltered). Utilization is 0..1 → ×100 for used %.
 *       These unified headers ONLY appear on OAuth subscription tokens; on
 *       a plain Anthropic API key they are absent → line 5 stays hidden.
 *
 * NOT supported (line 5 stays hidden):
 *   • all other providers (google, deepseek, openrouter, bedrock, …).
 *
 * ## Refresh strategy
 *
 * The fetch is asynchronous and best-effort:
 *   • session_start — capture provider, do an initial fetch so line 5
 *     appears before the first prompt.
 *   • model_select — re-fetch if the provider changed.
 *   • agent_end    — refresh after each completed prompt (throttled to
 *     at most once per REFRESH_MS to avoid hammering on rapid prompts).
 *   • periodic     — a PERIODIC_REFRESH_MS (3 min) interval keeps line 5
 *     fresh while a response is in flight, which can be hours. The timer
 *     ONLY runs while a prompt is active: started by before_agent_start
 *     / agent_start (idempotent — never more than one, and only for
 *     fetch providers), and stopped on agent_settled (pi's "truly idle"
 *     event — every run ends there, including aborts and errors) after
 *     one final forced query so line 5 shows the latest numbers. Unref'd
 *     so it never holds the process open. As a desync guard the tick
 *     asks pi itself (ctx.isIdle captured from the last event ctx): if
 *     the agent is no longer active it does one final query and shuts
 *     itself down. Model changes need no timer restart — the tick
 *     refreshes whatever provider is current.
 *
 * Failures (network, auth, parse, non-200) are swallowed, and the
 * snapshot is CLEARED — line 5 is hidden while the endpoint is not
 * giving us the data we expect, and returns on the next successful
 * fetch. Stale or partial numbers are never rendered.
 *
 * Credentials come from pi's public ModelRegistry API. It resolves a usable
 * Bearer token and refreshes OAuth tokens with file locking, so the Codex
 * access token is always fresh. `readStoredCredential()` is used only for
 * credential metadata such as the Codex account id.
 *
 * Per .dev/dev_guide.md section 1.5 this module never imports core.ts or footer-widget.ts;
 * the orchestrator passes the returned `AllowanceProvider` into core.ts,
 * which re-exposes it on `FooterDataProvider`.
 *
 * See `allowance.readme.md` for the full contract.
 */

import * as piApi from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AllowanceProvider, AllowanceView, AllowanceWindow } from "./types";

// ──────────────────────────────────────────────────────────────────────
// Adaptive duration formatter
// ──────────────────────────────────────────────────────────────────────

/**
 * Format a number of seconds into a compact, adaptive countdown string:
 *   • drops all leading-zero units (never shows "00d 00h 00m 10s")
 *   • stops at minutes once hours or days are present (seconds are noise)
 *   • two-digit padding within the shown units for stable width
 *
 * Examples (matches the footer line-5 spec):
 *   45          → "45s"
 *   330         → "05m 30s"
 *   8100        → "02h 15m"
 *   413400      → "04d 18h 30m"
 *   <= 0 / NaN  → ""   (caller omits the reset clause)
 *
 * Pure on purpose so it can be unit-tested without any provider state.
 */
export function formatAdaptiveDuration(totalSeconds: number): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "";
    const s = Math.floor(totalSeconds);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const p2 = (n: number): string => String(n).padStart(2, "0");
    if (d > 0) return `${p2(d)}d ${p2(h)}h ${p2(m)}m`;
    if (h > 0) return `${p2(h)}h ${p2(m)}m`;
    if (m > 0) return `${p2(m)}m ${p2(sec)}s`;
    return `${p2(sec)}s`;
}

// ──────────────────────────────────────────────────────────────────────
// Provider → endpoint config + parsers
// ──────────────────────────────────────────────────────────────────────

interface ProviderConfig {
    /** Full usage URL. */
    url: string;
    /** Extra request headers (beyond Authorization). */
    extraHeaders?: (provider: string) => Promise<Record<string, string>>;
    /** Parse the JSON body into an AllowanceView. Throw on bad shape. */
    parse: (body: any) => AllowanceView;
}

/** Default (non-China) endpoints, keyed by pi provider id. */
const PROVIDERS: Record<string, ProviderConfig> = {
    "openai-codex": {
        url: "https://chatgpt.com/backend-api/wham/usage",
        extraHeaders: async (provider) => {
            const headers: Record<string, string> = {
                Accept: "application/json",
                originator: "pi-aftc-toolset",
            };
            // The Codex usage endpoint wants the ChatGPT account id when
            // present (it's stored on the OAuth credential, not the key).
            const cred = readStoredCredential(provider) as { accountId?: string } | undefined;
            if (cred?.accountId) headers["ChatGPT-Account-Id"] = cred.accountId;
            return headers;
        },
        parse: parseCodex,
    },
    minimax: {
        url: "https://www.minimax.io/v1/token_plan/remains",
        parse: parseMinimax,
    },
    "minimax-cn": {
        // China variant — www.minimaxi.com mirrors www.minimax.io. Default
        // to non-China; this branch only fires when the active model is the
        // CN provider (.dev/dev_guide.md / feature spec: default to non-CN routes).
        url: "https://www.minimaxi.com/v1/token_plan/remains",
        parse: parseMinimax,
    },
    zai: {
        // NB: usage lives under /api/monitor/, NOT the chat base
        // /api/coding/paas/v4/. (Probing the chat base 404s.)
        url: "https://api.z.ai/api/monitor/usage/quota/limit",
        parse: parseZai,
    },
    "zai-coding-cn": {
        url: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
        parse: parseZai,
    },
    "kimi-coding": {
        url: "https://api.kimi.com/coding/v1/usages",
        parse: parseKimi,
    },
    // NOTE: `anthropic` is handled separately — it's a HEADER provider, not
    // a fetch provider. See HEADER_PROVIDERS + parseAnthropicHeaders + the
    // after_provider_response handler below.
};

/** Providers whose allowance arrives via response HEADERS on every chat
 *  request (read from `after_provider_response`), not via a dedicated
 *  fetch. refresh() skips these so it doesn't clobber the header-derived
 *  view. */
const HEADER_PROVIDERS = new Set(["anthropic"]);

/** Parse the Codex `wham/usage` body. Throws if the shape is wrong. */
function parseCodex(body: any): AllowanceView {
    const rl = body?.rate_limit;
    const pw = rl?.primary_window;     // 5-hour window
    const sw = rl?.secondary_window;   // weekly window
    if (!pw && !sw) throw new Error("codex: missing rate_limit windows");
    const win = (w: any): AllowanceWindow | null => {
        if (!w || typeof w.used_percent !== "number") return null;
        return {
            usedPercent: clampPct(w.used_percent),
            resetSeconds: numSeconds(w.reset_after_seconds),
            resetAt: numMsFromSeconds(w.reset_at),
        };
    };
    const plan = typeof body?.plan_type === "string" ? capitalize(body.plan_type) : "";
    // OpenAI can change the primary subscription window by plan or during a
    // rollout. Do not call a seven-day primary window "5h": the live Plus
    // response currently reports limit_window_seconds = 604800. When that
    // happens, render it in the weekly slot. The usual 5h primary + weekly
    // secondary shape remains unchanged.
    const primarySeconds = typeof pw?.limit_window_seconds === "number"
        ? pw.limit_window_seconds
        : 0;
    const primaryIsWeekly = primarySeconds >= 24 * 60 * 60;
    return {
        providerLabel: plan ? `ChatGPT ${plan}` : "ChatGPT",
        fiveHour: primaryIsWeekly ? null : win(pw),
        weekly: primaryIsWeekly ? win(pw) : win(sw),
        fetchedAt: Date.now(),
    };
}

/** Parse the MiniMax `token_plan/remains` body. Throws if no usable bucket.
 *  MiniMax reports REMAINING percent; convert to USED. Times are in ms. */
function parseMinimax(body: any): AllowanceView {
    const remains: any[] = Array.isArray(body?.model_remains) ? body.model_remains : [];
    if (remains.length === 0) throw new Error("minimax: empty model_remains");
    // The LLM/token bucket is `model_name === "general"`. Other buckets
    // (e.g. "video") are unrelated to coding usage.
    const general =
        remains.find((r) => r?.model_name === "general") ?? remains[0];
    const win = (remainingKey: string, resetMsKey: string, resetAtKey: string): AllowanceWindow | null => {
        const remaining = general?.[remainingKey];
        if (typeof remaining !== "number") return null;
        return {
            usedPercent: clampPct(100 - remaining),
            resetSeconds: numSecondsFromMs(general?.[resetMsKey]),
            resetAt: numMs(general?.[resetAtKey]),
        };
    };
    return {
        providerLabel: "MiniMax",
        fiveHour: win(
            "current_interval_remaining_percent",
            "remains_time",
            "end_time",
        ),
        weekly: win(
            "current_weekly_remaining_percent",
            "weekly_remains_time",
            "weekly_end_time",
        ),
        fetchedAt: Date.now(),
    };
}

/** Parse the Z.ai `/api/monitor/usage/quota/limit` body. Throws if no
 *  limits array. data.limits[] entries: TOKENS_LIMIT unit 3 = 5h,
 *  unit 6 = weekly; percentage is USED; nextResetTime is epoch MS.
 *  data.level (lite/pro/max) becomes part of the label. */
function parseZai(body: any): AllowanceView {
    const limits: any[] = body?.data?.limits;
    if (!Array.isArray(limits)) throw new Error("zai: missing data.limits");
    const win = (unit: number): AllowanceWindow | null => {
        const l = limits.find((x) => x?.unit === unit && x?.type === "TOKENS_LIMIT");
        if (!l || typeof l.percentage !== "number") return null;
        const resetAt = numMs(l.nextResetTime);
        return {
            usedPercent: clampPct(l.percentage),
            resetSeconds: null, // derived from resetAt in getAllowance()
            resetAt,
        };
    };
    const level = typeof body?.data?.level === "string" ? capitalize(body.data.level) : "";
    return {
        providerLabel: level ? `Z.ai GLM ${level}` : "Z.ai GLM",
        fiveHour: win(3),
        weekly: win(6),
        fetchedAt: Date.now(),
    };
}

/** Parse the Kimi `coding/v1/usages` body. Throws if neither window is
 *  present. usage{} is the weekly window; limits[] holds the rolling
 *  5-hour rate window (window.duration 300 TIME_UNIT_MINUTE). Counts are
 *  STRINGS ("66") and resetTime is an ISO UTC string — unlike every
 *  other provider's numeric fields. */
function parseKimi(body: any): AllowanceView {
    const weekly = kimiWindow(body?.usage);
    const limits: any[] = Array.isArray(body?.limits) ? body.limits : [];
    const fiveHourEntry =
        limits.find((l) => l?.window?.timeUnit === "TIME_UNIT_MINUTE" && Number(l?.window?.duration) === 300)
        ?? limits[0];
    const fiveHour = kimiWindow(fiveHourEntry?.detail);
    if (!weekly && !fiveHour) throw new Error("kimi: missing usage windows");
    return {
        providerLabel: "Kimi",
        fiveHour,
        weekly,
        fetchedAt: Date.now(),
    };
}

/** Build one AllowanceWindow from a Kimi {limit, used, resetTime} object.
 *  Returns null when the counts are missing or the limit is not positive
 *  (a zero limit would divide by zero and shows as "no window"). */
function kimiWindow(raw: any): AllowanceWindow | null {
    if (!raw) return null;
    const limit = Number(raw.limit);
    const used = Number(raw.used);
    if (!Number.isFinite(limit) || limit <= 0) return null;
    if (!Number.isFinite(used) || used < 0) return null;
    return {
        usedPercent: clampPct((used / limit) * 100),
        resetSeconds: null, // derived from resetAt in liveView()
        resetAt: parseIsoMs(raw.resetTime),
    };
}

/** ISO-8601 string → epoch ms, or null when missing/invalid. */
function parseIsoMs(v: any): number | null {
    if (typeof v !== "string" || v.length === 0) return null;
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
}

/** Case-insensitive header lookup. pi's `headersToRecord` lowercases keys
 *  (Web Headers normalisation), but be defensive in case a provider or
 *  transport preserves the original casing. */
function getHeader(headers: Record<string, string>, name: string): string | undefined {
    const lower = name.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(headers, lower)) return headers[lower];
    for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === lower) return headers[k];
    }
    return undefined;
}

/** Build an AllowanceView from Anthropic subscription response headers.
 *  Returns null when the unified headers are absent (e.g. plain API-key
 *  mode), so line 5 stays hidden. Utilization is 0..1 → ×100. Reset is a
 *  unix timestamp in seconds. */
export function parseAnthropicHeaders(headers: Record<string, string>): AllowanceView | null {
    const u5 = getHeader(headers, "anthropic-ratelimit-unified-5h-utilization");
    const u7 = getHeader(headers, "anthropic-ratelimit-unified-7d-utilization");
    if (!u5 && !u7) return null; // API-key mode or non-subscription → hide
    const win = (utilRaw: string | undefined, resetKey: string): AllowanceWindow | null => {
        if (utilRaw === undefined) return null;
        const util = Number(utilRaw);
        if (!Number.isFinite(util)) return null;
        const resetAt = numMsFromSeconds(Number(getHeader(headers, resetKey) ?? NaN));
        return {
            usedPercent: clampPct(util * 100),
            resetSeconds: null, // derived from resetAt in getAllowance()
            resetAt,
        };
    };
    return {
        providerLabel: "Claude",
        fiveHour: win(u5, "anthropic-ratelimit-unified-5h-reset"),
        weekly: win(u7, "anthropic-ratelimit-unified-7d-reset"),
        fetchedAt: Date.now(),
    };
}

// ──────────────────────────────────────────────────────────────────
// Small coercion helpers (tolerate ms vs s and missing fields)
// ──────────────────────────────────────────────────────────────────

function clampPct(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
}
/** Field is whole seconds (Codex reset_after_seconds / reset_at unix-s). */
function numSeconds(v: any): number | null {
    if (v == null || typeof v !== "number" || !Number.isFinite(v)) return null;
    return Math.max(0, Math.floor(v));
}
/** Field is a unix timestamp in seconds → ms, or null. */
function numMsFromSeconds(v: any): number | null {
    if (v == null || typeof v !== "number" || !Number.isFinite(v)) return null;
    return Math.floor(v) * 1000;
}
/** Field is already milliseconds → seconds, or null. */
function numSecondsFromMs(v: any): number | null {
    if (v == null || typeof v !== "number" || !Number.isFinite(v)) return null;
    return Math.max(0, Math.floor(v / 1000));
}
/** Field is already milliseconds, or null. */
function numMs(v: any): number | null {
    if (v == null || typeof v !== "number" || !Number.isFinite(v)) return null;
    return Math.floor(v);
}
function capitalize(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Read credential metadata without resolving or exposing its key value.
 * Pi 0.80 exports readStoredCredential; older Pi releases exposed a
 * synchronous AuthStorage.get() compatibility method. */
function readStoredCredential(providerId: string): unknown {
    if (typeof piApi.readStoredCredential === "function") {
        return piApi.readStoredCredential(providerId);
    }
    // Legacy fallback for Pi < 0.80, which exposed a synchronous
    // AuthStorage.get() instead of readStoredCredential. AuthStorage is
    // not part of the current type defs, so access it through a typed cast.
    const legacy = piApi as typeof piApi & {
        AuthStorage?: { create?(): { get?(id: string): unknown } };
    };
    return legacy.AuthStorage?.create?.()?.get?.(providerId);
}

/** Pure parsers exposed only for the local allowance test harness. */
export const allowanceTestUtils = { parseCodex, parseMinimax, parseZai, parseKimi };

// ──────────────────────────────────────────────────────────────────────
// createAllowance — the data module
// ──────────────────────────────────────────────────────────────────────

/** Minimum gap between usage fetches. The footer already updates on every
 *  prompt via agent_end; throttling prevents hammering on rapid steers. */
const REFRESH_MS = 30_000;
/** Periodic refresh cadence for long-running turns: agent_end only fires
 *  when a prompt completes, which can be hours. Keeps line 5 fresh while
 *  a response is in flight. The timer only runs while a prompt is active
 *  (see the before_agent_start / agent_start / agent_settled handlers). */
const PERIODIC_REFRESH_MS = 180_000;
/** Abort the usage fetch if it takes longer than this (it's tiny JSON). */
const FETCH_TIMEOUT_MS = 12_000;

export function createAllowance(pi: ExtensionAPI): AllowanceProvider {
    let provider = "";                 // active model's provider id
    let view: AllowanceView | null = null;
    let lastFetchAt = 0;
    let inFlight: Promise<void> | null = null;
    // The periodic tick has no event ctx, so the registry that resolves
    // credentials is captured from the last event that carried one.
    let lastRegistry: ExtensionContext["modelRegistry"] | undefined;
    // Same for ctx.isIdle(): the tick asks pi (via the last captured
    // context) whether the agent is really still active.
    let lastIsIdle: (() => boolean) | undefined;
    // periodicTimer non-null means a timer is running; it is set/cleared
    // in exactly one place each so there is never more than one timer.
    // promptActive tracks whether a prompt is currently in flight.
    let periodicTimer: ReturnType<typeof setInterval> | null = null;
    let promptActive = false;

    /** Refresh from the active provider's usage endpoint. Best-effort:
     *  swallows all errors and keeps the last good snapshot. The caller
     *  (event handler) passes its ctx.signal so Escape cancels cleanly. */
    async function refresh(ctx?: ExtensionContext, force = false): Promise<void> {
        const cfg = provider ? PROVIDERS[provider] : undefined;
        if (!cfg) {
            // Header providers (anthropic) get their data from
            // after_provider_response, not a fetch — don't clobber it here.
            // For genuinely unsupported providers, clear any stale view so
            // we never show the wrong provider's data.
            if (!HEADER_PROVIDERS.has(provider)) view = null;
            return;
        }
        const now = Date.now();
        if (ctx?.modelRegistry) lastRegistry = ctx.modelRegistry;
        if (typeof ctx?.isIdle === "function") lastIsIdle = () => ctx.isIdle();
        if (!force && now - lastFetchAt < REFRESH_MS) return;
        lastFetchAt = now;

        // Collapse overlapping refreshes into one fetch.
        if (inFlight) return inFlight;
        inFlight = (async () => {
            try {
                // ModelRegistry is Pi's public credential-resolution API. It
                // refreshes OAuth credentials before returning the Bearer token.
                const key = await lastRegistry?.getApiKeyForProvider(provider);
                if (!key) { view = null; return; }
                const headers: Record<string, string> = {
                    Authorization: `Bearer ${key}`,
                    "Content-Type": "application/json",
                };
                if (cfg.extraHeaders) Object.assign(headers, await cfg.extraHeaders(provider));
                const signal = ctx?.signal;
                const res = await fetch(cfg.url, {
                    method: "GET",
                    headers,
                    signal: signal
                        ? mergeSignals(signal, FETCH_TIMEOUT_MS)
                        : AbortSignal.timeout(FETCH_TIMEOUT_MS),
                });
                if (!res.ok) {
                    // 4xx/5xx: the endpoint is not giving us usable data.
                    // Clear the view so line 5 hides instead of showing
                    // stale numbers; the next successful fetch brings it
                    // back.
                    console.log(`[aftc-toolset] allowance ${provider} HTTP ${res.status}`);
                    view = null;
                    return;
                }
                const body = await res.json();
                view = cfg.parse(body);
            } catch (err) {
                // Network / abort / parse failure (including a response
                // shape change): never render data we did not get — clear
                // the view so line 5 hides until the next success.
                console.log(`[aftc-toolset] allowance ${provider} error: ${(err as Error).message}`);
                view = null;
            } finally {
                inFlight = null;
            }
        })();
        return inFlight;
    }

    // Capture the active provider from event contexts (ctx.model can be
    // undefined on early renders, mirroring core.ts's model handling).
    function captureProvider(m: any): void {
        const next = m?.provider ?? m?.providerId ?? "";
        if (typeof next === "string" && next !== provider) {
            provider = next;
            view = null; // don't leak the previous provider's snapshot
            lastFetchAt = 0;
        }
    }

    /** True when no prompt is in flight. Asks pi directly (via the
     *  isIdle() captured from the last event ctx) in addition to the
     *  event-driven flag, so a missed completion event can never leave
     *  the timer running while pi is idle. */
    function isIdleNow(): boolean {
        if (!promptActive) return true;
        try {
            return lastIsIdle?.() === true;
        } catch {
            return false; // can't query pi — trust the event-driven flag
        }
    }

    /** Timer tick. Refreshes (throttled) while a prompt is in flight.
     *  When pi is idle (the prompt finished, or a completion event was
     *  missed), does one final forced query so line 5 shows the latest
     *  numbers, then shuts the timer down. */
    function onTimerTick(): void {
        if (isIdleNow()) {
            promptActive = false;
            void refresh(undefined, true).finally(() => stopPeriodicTimer());
            return;
        }
        void refresh();
    }

    /** Start the periodic refresh timer. Idempotent — no-op when a timer
     *  is already running, so multiple start signals never stack timers.
     *  Also a no-op for providers with nothing to poll (header providers
     *  like anthropic, and unsupported providers). Unref'd so it never
     *  holds the process open. */
    function startPeriodicTimer(): void {
        if (periodicTimer) return;
        if (!PROVIDERS[provider]) return;
        periodicTimer = setInterval(() => {
            try {
                onTimerTick();
            } catch (err) {
                console.log(`[aftc-toolset] allowance timer error: ${(err as Error).message}`);
            }
        }, PERIODIC_REFRESH_MS);
        periodicTimer.unref?.();
    }

    function stopPeriodicTimer(): void {
        if (!periodicTimer) return;
        clearInterval(periodicTimer);
        periodicTimer = null;
    }

    pi.on("session_start", async (_event, ctx) => {
        captureProvider((ctx as any).model);
        await refresh(ctx);
    });

    pi.on("session_shutdown", async () => {
        promptActive = false;
        stopPeriodicTimer();
    });

    pi.on("model_select", async (event, ctx) => {
        const before = provider;
        captureProvider((event as any).model);
        if (provider && provider !== before) await refresh(ctx, true);
    });

    // After each completed prompt — the user-facing trigger. agent_end
    // fires once per user prompt (not per tool turn), so this is the right
    // cadence for "after each prompt completion".
    // `session_start` can run before pi has restored the selected model.
    // Capture again immediately before the first request so a restored
    // ChatGPT/Codex session cannot remain stuck with provider === "" and
    // silently hide line 5 for the entire session.
    pi.on("before_agent_start", async (_event, ctx) => {
        const before = provider;
        captureProvider((ctx as any).model);
        await refresh(ctx, provider !== before);
        // A prompt is now in flight — start the periodic refresh timer.
        promptActive = true;
        startPeriodicTimer();
    });

    // Low-level run begin. Covers auto-retry / compaction runs that do not
    // fire before_agent_start; startPeriodicTimer() is idempotent, so this
    // never stacks a second timer on top of the before_agent_start one.
    pi.on("agent_start", async () => {
        promptActive = true;
        startPeriodicTimer();
    });

    pi.on("agent_end", async (_event, ctx) => {
        // Re-capture here too: this covers sessions whose model was set by
        // another extension without emitting model_select.
        const before = provider;
        captureProvider((ctx as any).model);
        await refresh(ctx, provider !== before);
        // NB: the timer keeps running here — pi may still auto-retry,
        // compact, or continue with queued follow-ups. agent_settled is
        // the real end of activity.
    });

    // True idle: no auto-retry, compaction, or queued follow-up left, and
    // every run ends here — normal completion, Escape aborts, and errors.
    // One final forced query so line 5 shows the latest numbers, then the
    // timer is stopped: it must only run while a prompt is in flight.
    pi.on("agent_settled", async (_event, ctx) => {
        promptActive = false;
        try {
            await refresh(ctx, true);
        } finally {
            stopPeriodicTimer();
        }
    });

    // Anthropic subscription allowance arrives as RESPONSE HEADERS on
    // every chat request (no dedicated usage endpoint). pi passes all
    // response headers through unfiltered, so we read them here. This
    // fires per LLM call (more often than agent_end), giving the Claude
    // path fresher numbers than the fetch providers. No-op for every
    // other provider (early return when provider !== "anthropic").
    pi.on("after_provider_response", async (event, _ctx) => {
        if (provider !== "anthropic") return;
        // Only OAuth subscription tokens carry the unified allowance
        // headers; plain Anthropic API keys never do. Gate on the credential
        // type so API-key users never see a (stale) allowance line, and so we
        // can safely ignore transient header absences on OAuth responses.
        const cred = readStoredCredential("anthropic") as { type?: string } | null | undefined;
        if (!cred || cred.type !== "oauth") { view = null; return; }
        const v = parseAnthropicHeaders((event as any)?.headers ?? {});
        if (v) view = v;
    });

    // Derive resetSeconds from resetAt on every read so the countdown
    // ticks down live at the footer's 1Hz cadence (works for all
    // providers, since every parser sets resetAt as the source of truth).
    function liveView(): AllowanceView | null {
        if (!view) return null;
        const now = Date.now();
        const fix = (w: AllowanceWindow | null): AllowanceWindow | null => {
            if (!w || w.resetAt === null || !Number.isFinite(w.resetAt)) return w;
            return { ...w, resetSeconds: Math.max(0, Math.floor((w.resetAt - now) / 1000)) };
        };
        return {
            providerLabel: view.providerLabel,
            fiveHour: fix(view.fiveHour),
            weekly: fix(view.weekly),
            fetchedAt: view.fetchedAt,
        };
    }

    return {
        getAllowance: () => liveView(),
    };
}

/** Combine an outer abort signal (Esc) with a hard timeout into one signal. */
function mergeSignals(outer: AbortSignal, timeoutMs: number): AbortSignal {
    // AbortSignal.any is available in Node 20+; fall back to timeout-only.
    const signals: AbortSignal[] = [outer, AbortSignal.timeout(timeoutMs)];
    if (typeof (AbortSignal as any).any === "function") {
        return (AbortSignal as any).any(signals);
    }
    return AbortSignal.timeout(timeoutMs);
}

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
 *
 * Failures (network, auth, parse, non-200) are swallowed and the last
 * good snapshot is kept (or null if there has never been one). Line 5 is
 * hidden while null, so a temporary outage never breaks the footer.
 *
 * Credentials come from pi's AuthStorage (`AuthStorage.create()` →
 * `~/.pi/agent/auth.json`); `getApiKey(provider)` returns a usable Bearer
 * token and auto-refreshes OAuth tokens with file locking, so the Codex
 * access token is always fresh.
 *
 * Per rules.md §1.5 this module never imports core.ts or footer-widget.ts;
 * the orchestrator passes the returned `AllowanceProvider` into core.ts,
 * which re-exposes it on `FooterDataProvider`.
 *
 * See `allowance.readme.md` for the full contract.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
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
    /** Short label shown on line 5, e.g. "MiniMax", "ChatGPT Plus". */
    label: string;
    /** Full usage URL. */
    url: string;
    /** Extra request headers (beyond Authorization). */
    extraHeaders?: (auth: AuthStorage, provider: string) => Promise<Record<string, string>>;
    /** Parse the JSON body into an AllowanceView. Throw on bad shape. */
    parse: (body: any) => AllowanceView;
}

/** Default (non-China) endpoints, keyed by pi provider id. */
const PROVIDERS: Record<string, ProviderConfig> = {
    "openai-codex": {
        label: "ChatGPT",
        url: "https://chatgpt.com/backend-api/wham/usage",
        extraHeaders: async (auth, provider) => {
            const headers: Record<string, string> = {
                Accept: "application/json",
                originator: "pi-aftc-toolset",
            };
            // The Codex usage endpoint wants the ChatGPT account id when
            // present (it's stored on the OAuth credential, not the key).
            const cred = auth.get(provider) as { accountId?: string } | undefined;
            if (cred?.accountId) headers["ChatGPT-Account-Id"] = cred.accountId;
            return headers;
        },
        parse: parseCodex,
    },
    minimax: {
        label: "MiniMax",
        url: "https://www.minimax.io/v1/token_plan/remains",
        parse: parseMinimax,
    },
    "minimax-cn": {
        label: "MiniMax",
        // China variant — www.minimaxi.com mirrors www.minimax.io. Default
        // to non-China; this branch only fires when the active model is the
        // CN provider (rules.md / feature spec: default to non-CN routes).
        url: "https://www.minimaxi.com/v1/token_plan/remains",
        parse: parseMinimax,
    },
    zai: {
        label: "Z.ai GLM",
        // NB: usage lives under /api/monitor/, NOT the chat base
        // /api/coding/paas/v4/. (Probing the chat base 404s.)
        url: "https://api.z.ai/api/monitor/usage/quota/limit",
        parse: parseZai,
    },
    "zai-coding-cn": {
        label: "Z.ai GLM",
        url: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
        parse: parseZai,
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
    return {
        providerLabel: plan ? `ChatGPT ${plan}` : "ChatGPT",
        fiveHour: win(pw),
        weekly: win(sw),
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

// ──────────────────────────────────────────────────────────────────────
// createAllowance — the data module
// ──────────────────────────────────────────────────────────────────────

/** Minimum gap between usage fetches. The footer already updates on every
 *  prompt via agent_end; throttling prevents hammering on rapid steers. */
const REFRESH_MS = 30_000;
/** Abort the usage fetch if it takes longer than this (it's tiny JSON). */
const FETCH_TIMEOUT_MS = 12_000;

export function createAllowance(pi: ExtensionAPI): AllowanceProvider {
    // AuthStorage.create() with no arg defaults to ~/.pi/agent/auth.json.
    // Reuse one instance; getApiKey() auto-refreshes OAuth tokens with file
    // locking, so the Codex access token is always fresh.
    const auth = AuthStorage.create();

    let provider = "";                 // active model's provider id
    let view: AllowanceView | null = null;
    let lastFetchAt = 0;
    let inFlight: Promise<void> | null = null;

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
        if (!force && now - lastFetchAt < REFRESH_MS) return;
        lastFetchAt = now;

        // Collapse overlapping refreshes into one fetch.
        if (inFlight) return inFlight;
        inFlight = (async () => {
            try {
                const key = await auth.getApiKey(provider);
                if (!key) { view = null; return; }
                const headers: Record<string, string> = {
                    Authorization: `Bearer ${key}`,
                    "Content-Type": "application/json",
                };
                if (cfg.extraHeaders) Object.assign(headers, await cfg.extraHeaders(auth, provider));
                const signal = ctx?.signal;
                const res = await fetch(cfg.url, {
                    method: "GET",
                    headers,
                    signal: signal
                        ? mergeSignals(signal, FETCH_TIMEOUT_MS)
                        : AbortSignal.timeout(FETCH_TIMEOUT_MS),
                });
                if (!res.ok) {
                    console.log(`[aftc-toolset] allowance ${provider} HTTP ${res.status}`);
                    return; // keep last good view
                }
                const body = await res.json();
                view = cfg.parse(body);
            } catch (err) {
                // Network / abort / parse failure — keep last good view.
                console.log(`[aftc-toolset] allowance ${provider} error: ${(err as Error).message}`);
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

    pi.on("session_start", async (_event, ctx) => {
        captureProvider((ctx as any).model);
        await refresh(ctx);
    });

    pi.on("model_select", async (event, ctx) => {
        const before = provider;
        captureProvider((event as any).model);
        if (provider && provider !== before) await refresh(ctx, true);
    });

    // After each completed prompt — the user-facing trigger. agent_end
    // fires once per user prompt (not per tool turn), so this is the right
    // cadence for "after each prompt completion".
    pi.on("agent_end", async (_event, ctx) => {
        await refresh(ctx);
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
        const cred = auth.get("anthropic");
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

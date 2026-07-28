/**
 * pi-aftc-toolset — Qwen Cloud / Alibaba Model Studio providers.
 *
 * Adds Alibaba's Qwen lineup to pi's NATIVE /login and model picker:
 *
 *   - "qwencloud-plan" (display: Qwen Coding Plan) — subscription Coding
 *     Plan tokens (sk-sp-… / sk-tok-…). Appears in /login under Plans as
 *     an OAuth-shaped token paste (works for Lite / Standard / Pro tiers;
 *     the tier only gates which models the account can call server-side).
 *   - "qwencloud" (display: Qwen Cloud (DashScope)) — pay-per-token
 *     DashScope API keys (sk-…). Appears in /login under "Use an API
 *     key", or authenticates via the DASHSCOPE_API_KEY env var.
 *
 * Credentials are 100% pi-owned: pi writes them to ~/.pi/agent/auth.json
 * on /login and clears them on /logout. This module NEVER reads or
 * writes auth.json; catalog fetches resolve the active key through the
 * documented ctx.modelRegistry.getApiKeyAndHeaders().
 *
 * Model catalogs come from each service's live `<baseUrl>/models`
 * endpoint (on session_start, on /qwencloud -> Refresh, and right after
 * a Plan login). The /models API returns only ids (+ optional names), so
 * capabilities (reasoning, vision, context window, max output) are
 * inferred from the model id. Fallback chain per provider:
 *   live fetch -> last-known-good cache in the persistent data dir
 *   -> built-in seed list.
 * The seed list exists so both providers stay visible in /login before
 * any credential exists — pi hides providers with zero registered models.
 *
 * Both providers default to the OpenAI-compatible endpoint shape
 * (openai-completions); /qwencloud can switch either provider to
 * Alibaba's Anthropic-compatible shape. DeepSeek-served ids are ALWAYS
 * forced to openai-completions (Alibaba's Anthropic path hangs for
 * DeepSeek models).
 *
 * User preferences (region, formats, plan endpoints) live in config.json
 * via config.ts — never secrets. Catalog caches are recreated lazily and
 * wiped on extension update like all other runtime data (by design, see
 * AGENTS.md). All network calls have a hard timeout; every failure path
 * is best-effort and logs with the [aftc-toolset] prefix — this module
 * must never take pi down with it.
 *
 * Slash commands: /qwencloud (status, refresh, cloud region/format,
 * plan endpoints/format, re-login help).
 *
 * Self-contained feature module: imports config.ts (preferences),
 * paths.ts (data dir) and ui/aftc-ui.ts (dialogs) — no feature-module
 * imports. Wired by providers/index.ts -> createProviders(pi).
 * See qwencloud-readme.md for the full contract.
 */

import type {
    ExtensionAPI,
    ExtensionCommandContext,
    ExtensionContext,
    ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";
import { getPreference, setPreference } from "../config";
import { getDataDir } from "../paths";
import { registerHelpEntry } from "../help-registry";
import { showInput, showMenu, showViewer } from "../ui/aftc-ui";
import * as aftcConsole from "../ui/aftc-console";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_PROVIDER_ID = "qwencloud-plan";
const CLOUD_PROVIDER_ID = "qwencloud";

const PLAN_DISPLAY_NAME = "Qwen Coding Plan";
const CLOUD_DISPLAY_NAME = "Qwen Cloud (DashScope)";

const DEFAULT_PLAN_OPENAI = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";
const DEFAULT_PLAN_ANTHROPIC = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic";
const DEFAULT_CLOUD_DOMAIN = "dashscope-intl.aliyuncs.com";
const CHINA_CLOUD_DOMAIN = "dashscope.aliyuncs.com";
const CLOUD_API_KEY_ENV = "DASHSCOPE_API_KEY";

/** Hard cap on every catalog fetch — a wedged endpoint must never stall pi. */
const FETCH_TIMEOUT_MS = 5000;
/** Plan tokens are long-lived bearer tokens; report a 1-year expiry. */
const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

type ApiFormat = "openai-completions" | "anthropic-messages";

/** Preference keys owned by this module (stored in config.json). */
type QwenPrefKey =
    | "qwencloudCloudDomain"
    | "qwencloudCloudApiFormat"
    | "qwencloudPlanApiFormat"
    | "qwencloudPlanOpenAI"
    | "qwencloudPlanAnthropic";

// ─────────────────────────────────────────────────────────────────────────────
// Model definitions + capability heuristics
//
// The /models endpoints return only ids/names — no capabilities. These
// heuristics infer reasoning / vision / context window / max output from
// the id. Sources: Alibaba Cloud Model Studio model docs. They err on the
// side of a safe 131072 window for unknown ids; pi auto-compacts on
// overflow errors, so a wrong guess degrades gracefully.
// ─────────────────────────────────────────────────────────────────────────────

interface QwenModelDef {
    id: string;
    name: string;
    reasoning: boolean;
    vision: boolean;
    contextWindow: number;
    maxTokens: number;
    /** DeepSeek ids: Alibaba's Anthropic path hangs — always openai-completions. */
    forceOpenAI: boolean;
}

/** Ids that are not chat models (image, audio, embeddings, …). */
const NON_CHAT_ID = /(image|audio|video|tts|asr|embed|vector|rerank|wan|omni|livetranslate|realtime)/i;

function isVisionModel(id: string): boolean {
    return /vl|vision/i.test(id) || /^qwen3\.\d+-plus\b/i.test(id) || /kimi/i.test(id);
}

function isReasoningModel(id: string): boolean {
    return /qwq|max|thinking|deepseek|minimax|kimi|glm|3\.[5-9]/i.test(id);
}

function inferContextWindow(id: string): number {
    // Third-party models served on the plan/aggregated catalog.
    if (/^glm-?5\.2\b/i.test(id)) return 1048576;
    if (/^glm/i.test(id)) return 202752;
    if (/deepseek-?v4/i.test(id)) return 1048576;
    if (/^deepseek/i.test(id)) return 131072;
    if (/kimi/i.test(id)) return 262144;
    if (/minimax/i.test(id)) return 196608;

    // Qwen 3.7+: all 1M. Qwen 3.5/3.6: plus/flash = 1M, max/open-weight = 256K.
    if (/^qwen3\.([7-9]|\d{2,})\b/i.test(id)) return 1048576;
    if (/^qwen3\.[56]\b/i.test(id)) return /(plus|flash)/i.test(id) ? 1048576 : 262144;

    return 131072;
}

function prettyName(id: string): string {
    // qwen3.6-plus -> "Qwen 3.6 Plus", glm-5 -> "GLM-5", MiniMax-M2.5 -> "MiniMax M2.5"
    if (/^qwen/i.test(id)) {
        return id.replace(/^qwen/i, "Qwen ").replace(/-/g, " ").replace(/\b([a-z])/g, (s) => s.toUpperCase());
    }
    if (/^glm/i.test(id)) return id.toUpperCase();
    if (/^kimi/i.test(id)) return id.replace(/^kimi/i, "Kimi").replace(/-/g, " ");
    if (/^minimax/i.test(id)) return id.replace(/-/g, " ");
    if (/^deepseek/i.test(id)) return id.replace(/^deepseek/i, "DeepSeek").replace(/-/g, " ");
    return id;
}

/** Turn a bare model id into a full definition via the heuristics. */
function inferDef(id: string): QwenModelDef {
    const forceOpenAI = /deepseek/i.test(id);
    const reasoning = isReasoningModel(id);
    return {
        id,
        name: prettyName(id),
        reasoning,
        vision: isVisionModel(id),
        contextWindow: inferContextWindow(id),
        maxTokens: forceOpenAI ? 16384 : 65536,
        forceOpenAI,
    };
}

/**
 * Parse a /models API payload into defs. Pure function (fetch lives in
 * fetchCatalog). Filters non-chat ids, de-dupes, sorts by id. Returns []
 * for anything unexpected — callers treat empty as "fetch failed".
 */
function parseModelsPayload(payload: unknown): QwenModelDef[] {
    const data = (payload as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    const defs: QwenModelDef[] = [];
    for (const entry of data) {
        if (typeof entry !== "object" || entry === null) continue;
        const id = String((entry as { id?: unknown }).id ?? "").trim();
        if (!id || NON_CHAT_ID.test(id) || seen.has(id)) continue;
        seen.add(id);
        const def = inferDef(id);
        const rawName = (entry as { name?: unknown }).name;
        if (typeof rawName === "string" && rawName.trim()) def.name = rawName.trim();
        defs.push(def);
    }
    defs.sort((a, b) => a.id.localeCompare(b.id));
    return defs;
}

/** Plan token shape check: sk-sp-… (Singapore) or sk-tok-… (alternate). */
function isPlanToken(key: string): boolean {
    return key.startsWith("sk-sp-") || key.startsWith("sk-tok-");
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed catalogs — keep both providers visible in /login with no credential.
// Ids chosen for stability (present on every DashScope account / the
// advertised plan lineup). A wrong guess only errors at send time; the
// first successful login replaces the seed with the live catalog.
// ─────────────────────────────────────────────────────────────────────────────

const CLOUD_SEED_IDS = ["qwen-max", "qwen-plus", "qwen-flash", "qwen3-coder-plus", "qwq-plus"];
const PLAN_SEED_IDS = ["qwen3.7-max", "qwen3.7-plus"];

// ─────────────────────────────────────────────────────────────────────────────
// Catalog cache (persistent data dir; see paths.ts) — offline fallback only.
// The live API is always the source of truth; a reachable endpoint
// overwrites the cache. Atomic writes (tmp + rename), best-effort reads.
// ─────────────────────────────────────────────────────────────────────────────

interface CatalogCache {
    fetchedAt: number;
    source: string;
    models: QwenModelDef[];
}

function readCache(cachePath: string): CatalogCache | null {
    try {
        const raw = fs.readFileSync(cachePath, "utf-8");
        const parsed = JSON.parse(raw) as CatalogCache;
        if (!parsed || !Array.isArray(parsed.models) || typeof parsed.fetchedAt !== "number") return null;
        // Re-derive every cached entry through the CURRENT heuristics (they
        // improve over time); keep the API-provided display name only.
        const models: QwenModelDef[] = [];
        for (const m of parsed.models) {
            if (!m || typeof m.id !== "string" || !m.id) continue;
            const def = inferDef(m.id);
            if (typeof m.name === "string" && m.name.trim()) def.name = m.name;
            models.push(def);
        }
        if (!models.length) return null;
        return { fetchedAt: parsed.fetchedAt, source: String(parsed.source ?? ""), models };
    } catch {
        return null;
    }
}

function writeCache(cachePath: string, cache: CatalogCache): void {
    try {
        const dir = path.dirname(cachePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmpPath = cachePath + ".tmp";
        fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), "utf-8");
        fs.renameSync(tmpPath, cachePath);
    } catch (err) {
        console.log(`[aftc-toolset] qwencloud cache write error: ${(err as Error).message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Live catalog fetch — hard timeout, throws on any failure.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchCatalog(modelsUrl: string, apiKey: string): Promise<QwenModelDef[]> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(modelsUrl, {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
            signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const defs = parseModelsPayload(await res.json());
        if (!defs.length) throw new Error("no chat models in response");
        return defs;
    } finally {
        clearTimeout(timer);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ProviderModelConfig builders — apply the current region/format prefs to
// a def list. forceOpenAI ids always stay on openai-completions.
// ─────────────────────────────────────────────────────────────────────────────

function cloudBaseUrls(domain: string): { openai: string; anthropic: string } {
    return {
        openai: `https://${domain}/compatible-mode/v1`,
        anthropic: `https://${domain}/apps/anthropic`,
    };
}

function toModelConfig(def: QwenModelDef, urls: { openai: string; anthropic: string }, fmt: ApiFormat): ProviderModelConfig {
    const useOpenAI = def.forceOpenAI || fmt === "openai-completions";
    return {
        id: def.id,
        name: def.name,
        reasoning: def.reasoning,
        input: def.vision ? ["text", "image"] : ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: def.contextWindow,
        maxTokens: def.maxTokens,
        baseUrl: useOpenAI ? urls.openai : urls.anthropic,
        api: useOpenAI ? "openai-completions" : "anthropic-messages",
        compat: def.reasoning ? { thinkingFormat: "qwen" as const } : undefined,
        thinkingLevelMap: def.reasoning ? { off: null } : undefined,
    };
}

function buildCloudModels(defs: QwenModelDef[], domain: string, fmt: ApiFormat): ProviderModelConfig[] {
    const urls = cloudBaseUrls(domain);
    return defs.map((d) => toModelConfig(d, urls, fmt));
}

function buildPlanModels(defs: QwenModelDef[], endpoints: { openai: string; anthropic: string }, fmt: ApiFormat): ProviderModelConfig[] {
    return defs.map((d) => toModelConfig(d, endpoints, fmt));
}

// ─────────────────────────────────────────────────────────────────────────────
// Module options (test injection) + factory
// ─────────────────────────────────────────────────────────────────────────────

export interface QwencloudModuleOptions {
    /** Override the cache directory (tests). Defaults to paths.getDataDir(). */
    dataDir?: string;
    /** Override preference reads (tests). Command writes still go to config.json. */
    preferences?: Partial<Record<QwenPrefKey, string>>;
}

export function createQwenCloud(pi: ExtensionAPI, options?: QwencloudModuleOptions): void {
    const cacheDir = options?.dataDir ?? getDataDir();
    const planCachePath = path.join(cacheDir, "qwencloud-plan-models.json");
    const cloudCachePath = path.join(cacheDir, "qwencloud-cloud-models.json");

    // ── Preferences (config.json; test override wins) ──────────────────
    const readPref = (key: QwenPrefKey, fallback: string): string => {
        const injected = options?.preferences?.[key];
        if (typeof injected === "string" && injected) return injected;
        const saved = getPreference(key, fallback);
        return typeof saved === "string" && saved ? saved : fallback;
    };
    const cloudDomain = () => readPref("qwencloudCloudDomain", DEFAULT_CLOUD_DOMAIN);
    const cloudFormat = (): ApiFormat =>
        readPref("qwencloudCloudApiFormat", "openai-completions") === "anthropic-messages"
            ? "anthropic-messages"
            : "openai-completions";
    const planFormat = (): ApiFormat =>
        readPref("qwencloudPlanApiFormat", "openai-completions") === "anthropic-messages"
            ? "anthropic-messages"
            : "openai-completions";
    const planEndpoints = () => ({
        openai: readPref("qwencloudPlanOpenAI", DEFAULT_PLAN_OPENAI),
        anthropic: readPref("qwencloudPlanAnthropic", DEFAULT_PLAN_ANTHROPIC),
    });

    // ── Catalog state (boot: cache -> seed) ────────────────────────────
    const initialPlan = readCache(planCachePath);
    const initialCloud = readCache(cloudCachePath);
    let planDefs: QwenModelDef[] = initialPlan?.models ?? PLAN_SEED_IDS.map(inferDef);
    let cloudDefs: QwenModelDef[] = initialCloud?.models ?? CLOUD_SEED_IDS.map(inferDef);
    let planFetchedAt: number | null = initialPlan?.fetchedAt ?? null;
    let cloudFetchedAt: number | null = initialCloud?.fetchedAt ?? null;

    // ── Registration (sync, immediate; re-calls apply in place) ────────
    const registerAll = (): void => {
        const ep = planEndpoints();
        const pFmt = planFormat();
        pi.registerProvider(PLAN_PROVIDER_ID, {
            name: PLAN_DISPLAY_NAME,
            baseUrl: pFmt === "anthropic-messages" ? ep.anthropic : ep.openai,
            api: pFmt,
            authHeader: true,
            models: buildPlanModels(planDefs, ep, pFmt),
            oauth: {
                name: PLAN_DISPLAY_NAME,
                login: planLogin,
                refreshToken: (creds: OAuthCredentials) => Promise.resolve(creds),
                getApiKey: (creds: OAuthCredentials) => creds.access,
            },
        });
        const domain = cloudDomain();
        const cFmt = cloudFormat();
        pi.registerProvider(CLOUD_PROVIDER_ID, {
            name: CLOUD_DISPLAY_NAME,
            baseUrl: cFmt === "anthropic-messages" ? cloudBaseUrls(domain).anthropic : cloudBaseUrls(domain).openai,
            apiKey: `$${CLOUD_API_KEY_ENV}`,
            api: cFmt,
            authHeader: true,
            models: buildCloudModels(cloudDefs, domain, cFmt),
        });
    };

    // ── Plan login (pi /login -> Plans -> Qwen Coding Plan) ────────────
    async function planLogin(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
        const raw = await callbacks.onPrompt({
            message:
                "Qwen Coding Plan token (sk-sp-… or sk-tok-…). " +
                "DashScope sk-… keys: cancel here and use /login -> Use an API key -> Qwen Cloud (DashScope).",
        });
        const key = (raw ?? "").trim();
        if (!isPlanToken(key)) {
            throw new Error("That does not look like a Coding Plan token (expected sk-sp-… or sk-tok-…).");
        }
        // Best-effort: pull the live catalog with the fresh token so the
        // picker fills in right after login. Re-registration is deferred
        // until after the login flow unwinds (setImmediate).
        try {
            const ep = planEndpoints();
            const defs = await fetchCatalog(`${ep.openai}/models`, key);
            planDefs = defs;
            planFetchedAt = Date.now();
            writeCache(planCachePath, { fetchedAt: planFetchedAt, source: `${ep.openai}/models`, models: defs });
            setImmediate(() => {
                try {
                    registerAll();
                } catch {
                    // Re-registration is cosmetic here; next refresh retries.
                }
            });
        } catch (err) {
            console.log(`[aftc-toolset] qwencloud plan catalog fetch after login failed (${(err as Error).message}); keeping ${planDefs.length} existing model(s).`);
        }
        return { access: key, refresh: "", expires: Date.now() + TOKEN_TTL_MS };
    }

    // ── Key resolution via pi's model registry (never auth.json) ───────
    async function resolveKey(ctx: ExtensionContext, providerId: string, defs: QwenModelDef[]): Promise<string | null> {
        const registry = ctx.modelRegistry;
        if (registry) {
            for (const def of defs) {
                try {
                    const model = registry.find(providerId, def.id);
                    if (!model) continue;
                    const auth = await registry.getApiKeyAndHeaders(model);
                    if (auth.ok && auth.apiKey) return auth.apiKey;
                } catch {
                    // Try the next registered model id.
                }
            }
        }
        if (providerId === CLOUD_PROVIDER_ID) {
            const envKey = process.env[CLOUD_API_KEY_ENV];
            if (envKey) return envKey;
        }
        return null;
    }

    // ── Catalog refresh (session_start, /qwencloud -> Refresh) ─────────
    interface RefreshResult {
        planModels: number;
        cloudModels: number;
        planLoggedIn: boolean;
        cloudLoggedIn: boolean;
    }

    async function refreshCatalogs(ctx: ExtensionContext): Promise<RefreshResult> {
        const [planKey, cloudKey] = await Promise.all([
            resolveKey(ctx, PLAN_PROVIDER_ID, planDefs),
            resolveKey(ctx, CLOUD_PROVIDER_ID, cloudDefs),
        ]);
        const jobs: Promise<void>[] = [];
        if (planKey) {
            jobs.push((async () => {
                try {
                    const url = `${planEndpoints().openai}/models`;
                    const defs = await fetchCatalog(url, planKey);
                    planDefs = defs;
                    planFetchedAt = Date.now();
                    writeCache(planCachePath, { fetchedAt: planFetchedAt, source: url, models: defs });
                } catch (err) {
                    console.log(`[aftc-toolset] qwencloud plan catalog refresh failed (${(err as Error).message}); keeping ${planDefs.length} existing model(s).`);
                }
            })());
        }
        if (cloudKey) {
            jobs.push((async () => {
                try {
                    const url = `${cloudBaseUrls(cloudDomain()).openai}/models`;
                    const defs = await fetchCatalog(url, cloudKey);
                    cloudDefs = defs;
                    cloudFetchedAt = Date.now();
                    writeCache(cloudCachePath, { fetchedAt: cloudFetchedAt, source: url, models: defs });
                } catch (err) {
                    console.log(`[aftc-toolset] qwencloud cloud catalog refresh failed (${(err as Error).message}); keeping ${cloudDefs.length} existing model(s).`);
                }
            })());
        }
        await Promise.all(jobs);
        if (planKey || cloudKey) {
            try {
                registerAll();
            } catch (err) {
                console.log(`[aftc-toolset] qwencloud re-register error: ${(err as Error).message}`);
            }
        }
        return {
            planModels: planDefs.length,
            cloudModels: cloudDefs.length,
            planLoggedIn: !!planKey,
            cloudLoggedIn: !!cloudKey,
        };
    }

    // ── Status text (viewer + headless print) ──────────────────────────
    async function buildStatusLines(ctx: ExtensionContext): Promise<string[]> {
        const [planKey, cloudKey] = await Promise.all([
            resolveKey(ctx, PLAN_PROVIDER_ID, planDefs),
            resolveKey(ctx, CLOUD_PROVIDER_ID, cloudDefs),
        ]);
        const age = (ts: number | null, count: number): string => {
            if (ts === null) return count ? "seed list (never fetched live)" : "none";
            const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
            return mins < 1 ? "live (just fetched)" : `cached, ${mins}m old`;
        };
        const ep = planEndpoints();
        const envKey = process.env[CLOUD_API_KEY_ENV];
        const cloudLogin = cloudKey
            ? envKey && cloudKey === envKey
                ? `via $${CLOUD_API_KEY_ENV}`
                : "logged in (via /login)"
            : "not logged in";
        return [
            `Plan:   ${planKey ? "logged in" : "not logged in"}`,
            `        Token:      sk-sp-… / sk-tok-… (via /login -> Plans)`,
            `        Format:     ${planFormat()}`,
            `        OpenAI:     ${ep.openai}`,
            `        Anthropic:  ${ep.anthropic}`,
            `        Models:     ${planDefs.length} (${age(planFetchedAt, planDefs.length)})`,
            ``,
            `Cloud:  ${cloudLogin}`,
            `        Key:        sk-… (via /login -> Use an API key, or $${CLOUD_API_KEY_ENV})`,
            `        Format:     ${cloudFormat()}`,
            `        Domain:     ${cloudDomain()}`,
            `        Models:     ${cloudDefs.length} (${age(cloudFetchedAt, cloudDefs.length)})`,
        ];
    }

    // ── Command helpers ────────────────────────────────────────────────
    const notify = (ctx: ExtensionCommandContext, msg: string, level: "info" | "warning" | "error"): void => {
        if (!ctx.hasUI) { aftcConsole.log(msg); return; }
        if (level === "warning") aftcConsole.warn(ctx, msg);
        else if (level === "error") aftcConsole.error(ctx, msg);
        else aftcConsole.emphasis(ctx, msg);
    };

    const validateUrl = (v: string): string | null =>
        /^https:\/\/\S+$/i.test(v.trim()) ? null : "Enter a full https:// URL (no spaces).";

    const validateDomain = (v: string): string | null =>
        /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(v.trim()) ? null : "Enter a plain domain (no https://, no path).";

    // ── /qwencloud ─────────────────────────────────────────────────────
    async function handleCommand(ctx: ExtensionCommandContext): Promise<void> {
        if (!ctx.hasUI) {
            const lines = await buildStatusLines(ctx);
            for (const line of lines) console.log(`[aftc-toolset] ${line}`);
            return;
        }
        const choice = await showMenu(ctx, {
            title: "QwenCloud",
            body: ["Alibaba Qwen providers. Login runs through pi's native /login."],
            labelWidth: 26,
            items: [
                { value: "status", label: "Status", description: " Login state, endpoints, model counts, cache age" },
                { value: "refresh", label: "Refresh model lists", description: " Re-pull the live catalogs now" },
                { value: "cloud-domain", label: "Cloud region / domain", description: " International, China, or a custom domain" },
                { value: "cloud-format", label: "Cloud API format", description: " OpenAI-compatible (default) or Anthropic-compatible" },
                { value: "plan-format", label: "Plan API format", description: " OpenAI-compatible (default) or Anthropic-compatible" },
                { value: "plan-endpoints", label: "Plan endpoints (advanced)", description: " Singapore default or custom base URLs" },
                { value: "relogin", label: "Re-login help", description: " How to wipe and re-enter credentials" },
            ],
        });
        if (!choice) return;

        if (choice === "status") {
            const lines = await buildStatusLines(ctx);
            await showViewer(ctx, { title: "QwenCloud status", lines });
            return;
        }

        if (choice === "refresh") {
            notify(ctx, "Fetching live Qwen catalogs…", "info");
            const result = await refreshCatalogs(ctx);
            const bits = [
                `Plan: ${result.planLoggedIn ? `${result.planModels} models` : "skipped (not logged in)"}`,
                `Cloud: ${result.cloudLoggedIn ? `${result.cloudModels} models` : "skipped (not logged in)"}`,
            ];
            notify(ctx, bits.join("  ·  "), "info");
            return;
        }

        if (choice === "cloud-domain") {
            const sel = await showMenu(ctx, {
                title: "Cloud region / domain",
                labelWidth: 14,
                items: [
                    { value: "intl", label: "International", description: ` ${DEFAULT_CLOUD_DOMAIN}` },
                    { value: "china", label: "China", description: ` ${CHINA_CLOUD_DOMAIN}` },
                    { value: "custom", label: "Custom…", description: " Enter a DashScope-compatible domain" },
                ],
            });
            if (!sel) return;
            let domain = sel === "china" ? CHINA_CLOUD_DOMAIN : DEFAULT_CLOUD_DOMAIN;
            if (sel === "custom") {
                const input = await showInput(ctx, {
                    title: "Custom cloud domain",
                    label: "Domain",
                    initial: cloudDomain(),
                    required: true,
                    validate: validateDomain,
                });
                if (input === null || !input.trim()) return;
                domain = input.trim().toLowerCase();
            }
            if (domain === cloudDomain()) {
                notify(ctx, `Cloud domain unchanged: ${domain}`, "info");
                return;
            }
            setPreference("qwencloudCloudDomain", domain);
            registerAll();
            const result = await refreshCatalogs(ctx);
            notify(ctx, `Cloud domain set to ${domain}. Cloud models: ${result.cloudModels}.`, "info");
            return;
        }

        if (choice === "cloud-format" || choice === "plan-format") {
            const isCloud = choice === "cloud-format";
            const sel = await showMenu(ctx, {
                title: isCloud ? "Cloud API format" : "Plan API format",
                labelWidth: 21,
                items: [
                    { value: "openai-completions", label: "OpenAI-compatible", description: " Default. /compatible-mode/v1" },
                    { value: "anthropic-messages", label: "Anthropic-compatible", description: " /apps/anthropic" },
                ],
            });
            if (!sel) return;
            setPreference(isCloud ? "qwencloudCloudApiFormat" : "qwencloudPlanApiFormat", sel);
            registerAll();
            notify(ctx, `${isCloud ? "Cloud" : "Plan"} API format: ${sel}. Applies to the next message you send.`, "info");
            return;
        }

        if (choice === "plan-endpoints") {
            const sel = await showMenu(ctx, {
                title: "Plan endpoints",
                labelWidth: 20,
                items: [
                    { value: "default", label: "Singapore (default)", description: " token-plan.ap-southeast-1.maas.aliyuncs.com" },
                    { value: "custom", label: "Custom…", description: " Enter both base URLs (other regions)" },
                ],
            });
            if (!sel) return;
            if (sel === "default") {
                setPreference("qwencloudPlanOpenAI", DEFAULT_PLAN_OPENAI);
                setPreference("qwencloudPlanAnthropic", DEFAULT_PLAN_ANTHROPIC);
            } else {
                const ep = planEndpoints();
                const openai = await showInput(ctx, {
                    title: "Plan OpenAI-compatible base URL",
                    label: "OpenAI URL",
                    initial: ep.openai,
                    required: true,
                    validate: validateUrl,
                });
                if (openai === null || !openai.trim()) return;
                const anthropic = await showInput(ctx, {
                    title: "Plan Anthropic-compatible base URL",
                    label: "Anthropic URL",
                    initial: ep.anthropic,
                    required: true,
                    validate: validateUrl,
                });
                if (anthropic === null || !anthropic.trim()) return;
                setPreference("qwencloudPlanOpenAI", openai.trim());
                setPreference("qwencloudPlanAnthropic", anthropic.trim());
            }
            registerAll();
            const result = await refreshCatalogs(ctx);
            notify(ctx, `Plan endpoints updated. Plan models: ${result.planModels}.`, "info");
            return;
        }

        if (choice === "relogin") {
            await showViewer(ctx, {
                title: "Re-login",
                lines: [
                    "Credentials are owned by pi and stored in ~/.pi/agent/auth.json.",
                    "Use pi's native /logout and /login to re-enter them.",
                    "",
                    "Plan (Coding Plan token):",
                    "  1. /logout  ->  choose \"Qwen Coding Plan\"",
                    "  2. /login   ->  Plans  ->  \"Qwen Coding Plan\"",
                    "     paste your sk-sp-… or sk-tok-… token",
                    "",
                    "Cloud (DashScope API key):",
                    "  1. /logout  ->  choose \"Qwen Cloud (DashScope)\"",
                    "  2. /login   ->  Use an API key  ->  \"Qwen Cloud (DashScope)\"",
                    "     paste your sk-… key",
                    "     (or set DASHSCOPE_API_KEY in your environment and restart pi)",
                    "",
                    "The catalog refreshes automatically after a Plan login and on",
                    "every pi start; run /qwencloud -> Refresh model lists any time.",
                ],
            });
            return;
        }
    }

    // ── Wire-up ────────────────────────────────────────────────────────
    registerAll();

    pi.on("session_start", async (_event, ctx) => {
        try {
            await refreshCatalogs(ctx);
        } catch (err) {
            console.log(`[aftc-toolset] qwencloud session_start refresh error: ${(err as Error).message}`);
        }
    });

    registerHelpEntry({
        command: "qwencloud",
        description: "Manage Qwen Cloud + Coding Plan providers (status, refresh, region, format)",
        category: "Providers",
    });

    pi.registerCommand("qwencloud", {
        description: "Manage the Qwen Cloud / Coding Plan providers (status, refresh, region, API format).",
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            try {
                await handleCommand(ctx);
            } catch (err) {
                notify(ctx, `/qwencloud error: ${(err as Error).message}`, "error");
            }
        },
    });

    console.log("[aftc-toolset] loaded — /qwencloud (Qwen Cloud + Coding Plan providers via pi /login)");
}

// ─────────────────────────────────────────────────────────────────────────────
// Test surface — pure helpers + constants (no pi instance required).
// ─────────────────────────────────────────────────────────────────────────────

export const qwencloudTestUtils = {
    PLAN_PROVIDER_ID,
    CLOUD_PROVIDER_ID,
    PLAN_DISPLAY_NAME,
    CLOUD_DISPLAY_NAME,
    DEFAULT_PLAN_OPENAI,
    DEFAULT_PLAN_ANTHROPIC,
    DEFAULT_CLOUD_DOMAIN,
    CHINA_CLOUD_DOMAIN,
    CLOUD_API_KEY_ENV,
    PLAN_SEED_IDS,
    CLOUD_SEED_IDS,
    NON_CHAT_ID,
    isPlanToken,
    isVisionModel,
    isReasoningModel,
    inferContextWindow,
    prettyName,
    inferDef,
    parseModelsPayload,
    cloudBaseUrls,
    buildCloudModels,
    buildPlanModels,
    readCache,
    writeCache,
};

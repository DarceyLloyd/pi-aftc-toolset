/**
 * pi-aftc-toolset — persistent configuration module.
 *
 * One file, one concern: `config.json` holds cross-session USER
 * PREFERENCES that persist forever (until the user changes the
 * value). Loaded on every session start. Survives /reload, /new,
 * fresh pi startup, and machine reboot.
 *
 * Currently tracked preferences:
 *   - footerTimeframe        (Today / 3h / 6h / 24h / 2d / 3d / 7d / 28d)
 *   - footerEnabled          (footer widget on/off)
 *   - responseDividerEnabled (response divider on/off)
 *   - thinkProcessingEnabled (inline <think>…</think> → ThinkingContent block)
 *   - "aftc-intro" (AFTC startup wordmark animation on/off)
 *   - qwencloud* (QwenCloud provider prefs: cloud domain, API formats, plan endpoints)
 *   - aftcCodex* (aftc-codex knowledge-base feature: master switch, guidance inject,
 *     auto-load, codex root override, seeded flag — off by default)
 *
 * SSH connection records are intentionally stored separately in `ssh.json`.
 * `config.json` is created with `DEFAULT_PREFERENCES` on first access
 * if it doesn't already exist. It is ONLY re-written when one of those
 * preference actually changes (via `setPreference`) — never on a
 * timer, never on every turn, never on shutdown.
 *
 * All operations are best-effort. Errors are logged and the call falls
 * back to defaults rather than crashing pi. The file lives in the
 * persistent OS data dir (see paths.ts getDataDir — outside the installed
 * package), so it survives `pi update --extensions`; a fresh install
 * re-creates it from `DEFAULT_PREFERENCES` on first access, and a legacy
 * package-local copy is migrated forward by migrateLegacyData().
 *
 * Atomic writes: each save goes through a tmp file + rename so a crash
 * mid-write can't leave the file half-written.
 *
 * Self-contained module — no event subscriptions, no cross-module
 * imports. Feature modules import `getPreference` / `setPreference`.
 *
 * See `config-readme.md` for the full contract.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getConfigJson, getDataDir } from "./paths";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User preferences that persist across all session boundaries.
 * Each field is optional on disk (so a partial or older config.json
 * still loads cleanly) but always populated in memory after the
 * defaults-merge in `loadPreferencesInternal`.
 */
export interface Preferences {
    /** Footer 4th-line time window: today | 3h | 6h | 24h | 2d | 3d | 7d | 28d. */
    footerTimeframe?: string;
    /** Whether the footer widget is currently shown. */
    footerEnabled?: boolean;
    /** Whether the response divider is currently shown. */
    responseDividerEnabled?: boolean;
    /** Whether the think-parser hook converts inline <think>…</think>
     *  text tags in assistant messages into proper ThinkingContent
     *  blocks. Off by default — users opt in via
     *  /aftc-enable-think-processing. */
    thinkProcessingEnabled?: boolean;
    /** Whether the AFTC startup wordmark animation is shown. */
    "aftc-intro"?: boolean;
    /** QwenCloud: DashScope cloud domain (International default, China, or custom). */
    qwencloudCloudDomain?: string;
    /** QwenCloud: cloud API format ("openai-completions" | "anthropic-messages"). */
    qwencloudCloudApiFormat?: string;
    /** QwenCloud: plan API format ("openai-completions" | "anthropic-messages"). */
    qwencloudPlanApiFormat?: string;
    /** QwenCloud: plan OpenAI-compatible base URL (region override). */
    qwencloudPlanOpenAI?: string;
    /** QwenCloud: plan Anthropic-compatible base URL (region override). */
    qwencloudPlanAnthropic?: string;
    /** Audio notifications master on/off. OFF by default (fresh installs are
     *  silent); toggled in /aftc-audio-notifications. Migration enables it for
     *  users who already had sounds configured (preserves their behaviour). */
    notifyEnabled?: boolean;
    /** Audio notification: filename of the MP3 in data/aftc-audio-notifications/question/ played
     *  when the AI asks a question, or "" for none. Set via /aftc-audio-notifications. */
    notifySoundQuestion?: string;
    /** Audio notification: filename of the MP3 in data/aftc-audio-notifications/task-complete/
     *  played when a task completes, or "" for none. Set via /aftc-audio-notifications. */
    notifySoundTaskComplete?: string;
    notifyTimeSec?: number;
    /** Audio notification: filename of the MP3 in data/aftc-audio-notifications/error/ played
     *  when the agent ends with a provider/network error, or "" for none. */
    notifySoundError?: string;
    /** Audio notification: filename of the MP3 in data/aftc-audio-notifications/aborted/ played
     *  when the user aborts the agent, or "" for none. */
    notifySoundAborted?: string;
    /** Audio notification: filename of the MP3 in data/aftc-audio-notifications/startup/ played
     *  when pi starts a fresh session, or "" for none. */
    notifySoundStartup?: string;
    /** Saved replay prompt text (previously in replay.json). Empty = none saved. */
    replayPrompt?: string;
    /** WarGames intro: full-screen typewriter animation on session start. */
    warGamesEnabled?: boolean;
    /** aftc-codex: master on/off. Off = the feature does nothing. Off by default. */
    aftcCodexEnabled?: boolean;
    /** aftc-codex: inject thought-and-action-guidance.md when master is on. */
    aftcCodexInjectGuidance?: boolean;
    /** aftc-codex: auto-detect project techs and tell the model to fetch their docs. */
    aftcCodexAutoLoad?: boolean;
    /** aftc-codex: first-run seed choice (pre-trained vs fresh) has been done. */
    aftcCodexSeeded?: boolean;
    /** aftc-codex: auto-add entries without confirmation (true) or propose-then-confirm (false). */
    aftcCodexAutoAddEntries?: boolean;
    /** run_script tool: reliable large-script execution (workaround for a pi bash-tool
     *  truncation bug). On = tool registered; off = tool absent. /run-script-on|off. */
    runScriptEnabled?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults — the single source of truth for a fresh config.json
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default preferences. Used to:
 *   - generate a brand-new config.json on first access
 *     (`ensureConfigFile`), and
 *   - merge against a partial / older config.json so missing keys
 *     always get their default value.
 *
 * No schema version is tracked. Adding new preference fields just
 * means users on older files get the new field's default until they
 * change it; existing saved values are never discarded.
 *
 * Keep this object in sync with the `Preferences` interface above
 * and with the setPreference call sites in the extension
 * (footer-widget.ts, response.ts, think-parser.ts, intro.ts).
 */
export const DEFAULT_PREFERENCES: Preferences = {
    footerTimeframe: "3d",
    footerEnabled: true,
    responseDividerEnabled: true,
    thinkProcessingEnabled: false,
    "aftc-intro": true,
    qwencloudCloudDomain: "dashscope-intl.aliyuncs.com",
    qwencloudCloudApiFormat: "openai-completions",
    qwencloudPlanApiFormat: "openai-completions",
    qwencloudPlanOpenAI: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    qwencloudPlanAnthropic: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic",
    notifyEnabled: false,
    notifySoundQuestion: "voc_question_07.mp3",
    notifySoundTaskComplete: "voc_task_complete_07.mp3",
    notifyTimeSec: 1,
    notifySoundError: "voc_we_got_a_problem_01.mp3",
    notifySoundAborted: "",
    notifySoundStartup: "xp.mp3",
    replayPrompt: "",
    warGamesEnabled: false,
    aftcCodexEnabled: false,
    aftcCodexInjectGuidance: true,
    aftcCodexAutoLoad: true,
    aftcCodexSeeded: false,
    aftcCodexAutoAddEntries: true,
    runScriptEnabled: true,
};
// ─────────────────────────────────────────────────────────────────────────────
// Preferences (config.json) - ensure, read, write, cache
// ─────────────────────────────────────────────────────────────────────────────

let cachedPreferences: Preferences | null = null;

/**
 * Create config.json with `DEFAULT_PREFERENCES` if it doesn't exist
 * yet. Called lazily on the first `loadPreferencesInternal`. Also
 * creates the parent data dir if needed. Best-effort: any I/O error
 * is logged and swallowed so pi still boots (the in-memory cache
 * falls back to defaults).
 */
function ensureConfigFile(): void {
    const filePath = getConfigJson();
    try {
        if (!fs.existsSync(filePath)) {
            const legacyPath = path.join(getDataDir(), "state.json");
            if (fs.existsSync(legacyPath)) {
                fs.renameSync(legacyPath, filePath);
                return;
            }
            const dataDir = path.dirname(filePath);
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            const tmpPath = filePath + ".tmp";
            fs.writeFileSync(tmpPath, JSON.stringify(DEFAULT_PREFERENCES, null, 2), "utf-8");
            fs.renameSync(tmpPath, filePath);
        }
    } catch (err) {
        console.log(`[aftc-toolset] config.json ensure error: ${(err as Error).message}`);
    }
}

function loadPreferencesInternal(): Preferences {
    if (cachedPreferences !== null) return cachedPreferences;
    ensureConfigFile();
    const filePath = getConfigJson();
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw) as Preferences;
        if (!parsed || typeof parsed !== "object") {
            cachedPreferences = { ...DEFAULT_PREFERENCES };
            return cachedPreferences;
        }
        // Merge so missing keys still get their defaults. Existing
        // saved values are preserved even if the file has extra
        // unknown fields (e.g. a leftover `version` from an earlier
        // release is silently ignored).
        //
        // Some preferences are written back immediately when missing or
        // the wrong type. This migrates config.json files from versions
        // released before those preferences existed, making the defaults
        // explicit on disk and preserving them for later sessions.
        const needsIntroMigration = typeof parsed["aftc-intro"] !== "boolean";
        const needsNotifyQuestionMigration = typeof parsed.notifySoundQuestion !== "string";
        const needsNotifyTaskMigration = typeof parsed.notifySoundTaskComplete !== "string";
        const needsNotifyTimeMigration = typeof parsed.notifyTimeSec !== "number";
        const needsWarGamesMigration = typeof parsed.warGamesEnabled !== "boolean";
        const needsCodexEnabledMigration = typeof parsed.aftcCodexEnabled !== "boolean";
        const needsCodexGuidanceMigration = typeof parsed.aftcCodexInjectGuidance !== "boolean";
        const needsCodexAutoLoadMigration = typeof parsed.aftcCodexAutoLoad !== "boolean";
        const needsCodexSeededMigration = typeof parsed.aftcCodexSeeded !== "boolean";
        const needsCodexAutoAddMigration = typeof parsed.aftcCodexAutoAddEntries !== "boolean";
        const needsNotifyErrorMigration = typeof parsed.notifySoundError !== "string";
        const needsNotifyAbortedMigration = typeof parsed.notifySoundAborted !== "string";
        const needsNotifyStartupMigration = typeof parsed.notifySoundStartup !== "string";
        const needsReplayPromptMigration = typeof parsed.replayPrompt !== "string";
        const needsRunScriptMigration = typeof parsed.runScriptEnabled !== "boolean";
        const needsNotifyEnabledMigration = typeof parsed.notifyEnabled !== "boolean";
        // When adding the notifyEnabled key to an existing config.json: users
        // who already had notification sounds configured keep the feature ON
        // (their setup is never silenced); everyone else starts disabled.
        const migratedNotifyEnabled = [
            parsed.notifySoundQuestion, parsed.notifySoundTaskComplete,
            parsed.notifySoundError, parsed.notifySoundAborted, parsed.notifySoundStartup,
        ].some((v) => typeof v === "string" && v.length > 0);
        const needsMigration =
            needsIntroMigration || needsNotifyQuestionMigration ||
            needsNotifyTaskMigration || needsNotifyTimeMigration ||
            needsNotifyErrorMigration || needsNotifyAbortedMigration ||
            needsNotifyStartupMigration || needsReplayPromptMigration ||
            needsWarGamesMigration || needsCodexEnabledMigration ||
            needsCodexGuidanceMigration ||
            needsCodexAutoLoadMigration ||
            needsCodexSeededMigration || needsCodexAutoAddMigration ||
            needsRunScriptMigration || needsNotifyEnabledMigration;

        cachedPreferences = {
            ...DEFAULT_PREFERENCES,
            ...parsed,
            ...(needsIntroMigration ? { "aftc-intro": DEFAULT_PREFERENCES["aftc-intro"] } : {}),
            ...(needsNotifyQuestionMigration ? { notifySoundQuestion: DEFAULT_PREFERENCES.notifySoundQuestion } : {}),
            ...(needsNotifyTaskMigration ? { notifySoundTaskComplete: DEFAULT_PREFERENCES.notifySoundTaskComplete } : {}),
            ...(needsNotifyTimeMigration ? { notifyTimeSec: DEFAULT_PREFERENCES.notifyTimeSec } : {}),
            ...(needsNotifyErrorMigration ? { notifySoundError: DEFAULT_PREFERENCES.notifySoundError } : {}),
            ...(needsNotifyAbortedMigration ? { notifySoundAborted: DEFAULT_PREFERENCES.notifySoundAborted } : {}),
            ...(needsNotifyStartupMigration ? { notifySoundStartup: DEFAULT_PREFERENCES.notifySoundStartup } : {}),
            ...(needsReplayPromptMigration ? { replayPrompt: DEFAULT_PREFERENCES.replayPrompt } : {}),
            ...(needsWarGamesMigration ? { warGamesEnabled: DEFAULT_PREFERENCES.warGamesEnabled } : {}),
            ...(needsCodexEnabledMigration ? { aftcCodexEnabled: DEFAULT_PREFERENCES.aftcCodexEnabled } : {}),
            ...(needsCodexGuidanceMigration ? { aftcCodexInjectGuidance: DEFAULT_PREFERENCES.aftcCodexInjectGuidance } : {}),
            ...(needsCodexAutoLoadMigration ? { aftcCodexAutoLoad: DEFAULT_PREFERENCES.aftcCodexAutoLoad } : {}),
            ...(needsCodexSeededMigration ? { aftcCodexSeeded: DEFAULT_PREFERENCES.aftcCodexSeeded } : {}),
            ...(needsCodexAutoAddMigration ? { aftcCodexAutoAddEntries: DEFAULT_PREFERENCES.aftcCodexAutoAddEntries } : {}),
            ...(needsRunScriptMigration ? { runScriptEnabled: DEFAULT_PREFERENCES.runScriptEnabled } : {}),
            ...(needsNotifyEnabledMigration ? { notifyEnabled: migratedNotifyEnabled } : {}),
        };
        // Strip obsolete keys from older versions
        delete (cachedPreferences as any).notifySound;
        if (needsMigration) savePreferencesInternal(cachedPreferences);
        return cachedPreferences;
    } catch (err) {
        console.log(`[aftc-toolset] config.json read/parse error: ${(err as Error).message}`);
        cachedPreferences = { ...DEFAULT_PREFERENCES };
        return cachedPreferences;
    }
}

function savePreferencesInternal(prefs: Preferences): void {
    cachedPreferences = prefs;
    const filePath = getConfigJson();
    const dataDir = path.dirname(filePath);
    try {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        // Atomic write: tmp + rename so a crash mid-write can't leave
        // the file half-written.
        const tmpPath = filePath + ".tmp";
        fs.writeFileSync(tmpPath, JSON.stringify(prefs, null, 2), "utf-8");
        fs.renameSync(tmpPath, filePath);
    } catch (err) {
        console.log(`[aftc-toolset] config.json write error: ${(err as Error).message}`);
    }
}

/** Clear the in-memory cache so the next read hits disk. Test-only. */
export function _resetPreferencesCacheForTests(): void {
    cachedPreferences = null;
}

/**
 * Read a single preference. Returns the saved value if present,
 * otherwise the supplied default. Type-safe - the return type is
 * inferred from the default.
 */
export function getPreference<K extends keyof Omit<Preferences, "version">>(
    key: K,
    defaultValue: Preferences[K],
): Preferences[K] {
    const prefs = loadPreferencesInternal();
    const value = prefs[key];
    // `value` is typed as Preferences[K] but on disk it could be
    // anything if the file was hand-edited. Fall back to the default
    // when the saved value is undefined.
    return (value === undefined ? defaultValue : value) as Preferences[K];
}

/**
 * Persist a single preference. Updates the cache and writes
 * config.json atomically. Best-effort: errors are logged, never
 * thrown. This is the ONLY path that writes config.json after the
 * initial ensure — call it when footerEnabled / footerTimeframe /
 * responseDividerEnabled, thinkProcessingEnabled, or "aftc-intro"
 * actually changes.
 */
export function setPreference<K extends keyof Omit<Preferences, "version">>(
    key: K,
    value: Preferences[K],
): void {
    const prefs = loadPreferencesInternal();
    prefs[key] = value;
    savePreferencesInternal(prefs);
}

// ─────────────────────────────────────────────────────────────────────────────
// Data dir re-export (tests / other modules may want it)
// ─────────────────────────────────────────────────────────────────────────────

/** Test helper: re-export the data dir so tests can verify cleanup. */
export function _dataDirForTests(): string {
    return getDataDir();
}

/**
 * pi-aftc-toolset — persistent configuration module.
 *
 * One file, one concern: `config.json` holds cross-session USER
 * PREFERENCES that persist forever (until the user changes the
 * value). Survives /reload, /new, fresh pi startup, and machine reboot.
 *
 * NO IN-MEMORY CACHE (binding rule, see docs/working-with-config.md):
 * every read hits the file on disk. pi keeps extension modules alive
 * across /new, so a module-level cache would serve stale values after
 * the user hand-edits the file — and a later setPreference would
 * silently clobber those edits by flushing the stale cache back.
 * The file is tiny and local; reading it each time is free.
 *
 * Currently tracked preferences:
 *   - footerTimeframe        (footer line-4 window key: 1h-72h rolling,
 *                             1d/2d/3d/5d/7d/month/3m/6m/1y date-based)
 *   - footerEnabled          (footer widget on/off)
 *   - footerAveragesEnabled  (footer line-4 recorded averages on/off)
 *   - responseDividerEnabled (response divider on/off)
 *   - thinkProcessingEnabled (inline <think>…</think> → ThinkingContent block)
 *   - "aftc-intro" (AFTC startup wordmark animation on/off)
 *   - qwencloud* (QwenCloud provider prefs: cloud domain, API formats, plan endpoints)
 *   - aftcCodex* (aftc-codex knowledge-base feature: on/off switch, guidance inject,
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
    /** Footer 4th-line time window key: 1h | 2h | 3h | 4h | 5h | 6h |
     *  12h | 24h | 48h | 72h (rolling) or 1d | 2d | 3d | 5d | 7d |
     *  month | 3m | 6m | 1y (date-based). Legacy values (today, 28d)
     *  are migrated by core.ts on load. */
    footerTimeframe?: string;
    /** Whether the footer widget is currently shown. */
    footerEnabled?: boolean;
    /** Whether the footer's line 4 (recorded averages from turns.db)
     *  is shown. Toggled in the /aftc-footer menu. */
    footerAveragesEnabled?: boolean;
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
    /** Audio notifications on/off. OFF by default (fresh installs are
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
    /** Audio notification: filename of the MP3 in data/aftc-audio-notifications/context-window/25/
     *  played when context-window usage crosses 25%, or "" for none. */
    notifySoundContext25?: string;
    /** Audio notification: filename of the MP3 in data/aftc-audio-notifications/context-window/50/
     *  played when context-window usage crosses 50%, or "" for none. */
    notifySoundContext50?: string;
    /** Audio notification: filename of the MP3 in data/aftc-audio-notifications/context-window/75/
     *  played when context-window usage crosses 75%, or "" for none. */
    notifySoundContext75?: string;
    /** Saved replay prompt text (previously in replay.json). Empty = none saved. */
    replayPrompt?: string;
    /** WarGames intro: full-screen typewriter animation on session start. */
    warGamesEnabled?: boolean;
    /** aftc-codex: feature on/off. Off = the feature does nothing. Off by default. */
    aftcCodexEnabled?: boolean;
    /** aftc-codex: inject thought-and-action-guidance.md when the feature is on. */
    aftcCodexInjectGuidance?: boolean;
    /** aftc-codex: auto-detect project techs and tell the model to fetch their docs. */
    aftcCodexAutoLoad?: boolean;
    /** aftc-codex: first-run seed choice (pre-trained vs fresh) has been done. */
    aftcCodexSeeded?: boolean;
    /** aftc-codex: auto-add entries without confirmation (true) or propose-then-confirm (false). */
    aftcCodexAutoAddEntries?: boolean;
    /** aftc-codex: version of the user's live codex copy. Compared against the
     *  shipped seed version (data/extension-config.json codexVersion); a mismatch means the live
     *  AFTC Codex is out of date and /codex-install wipes + re-seeds it. 0 = unknown
     *  (pre-versioning installs) — always treated as out of date. Internal bookkeeping,
     *  not user-facing. */
    aftcCodexVersion?: number;
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
    footerAveragesEnabled: true,
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
    notifySoundContext25: "",
    notifySoundContext50: "",
    notifySoundContext75: "",
    replayPrompt: "",
    warGamesEnabled: false,
    aftcCodexEnabled: false,
    aftcCodexInjectGuidance: true,
    aftcCodexAutoLoad: true,
    aftcCodexSeeded: false,
    aftcCodexAutoAddEntries: true,
    aftcCodexVersion: 0,
    runScriptEnabled: true,
};
// ─────────────────────────────────────────────────────────────────────────────
// Preferences (config.json) - ensure, read, write (NO cache)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create config.json with `DEFAULT_PREFERENCES` if it doesn't exist
 * yet. Called lazily on the first `loadPreferencesInternal`. Also
 * creates the parent data dir if needed. Best-effort: any I/O error
 * is logged and swallowed so pi still boots (callers fall back to
 * defaults).
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
    // Fresh read on EVERY call — no in-memory cache (see module header).
    ensureConfigFile();
    const filePath = getConfigJson();
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw) as Preferences;
        if (!parsed || typeof parsed !== "object") {
            return { ...DEFAULT_PREFERENCES };
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
        const needsFooterAveragesMigration = typeof parsed.footerAveragesEnabled !== "boolean";
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
        const needsNotifyContext25Migration = typeof parsed.notifySoundContext25 !== "string";
        const needsNotifyContext50Migration = typeof parsed.notifySoundContext50 !== "string";
        const needsNotifyContext75Migration = typeof parsed.notifySoundContext75 !== "string";
        const needsReplayPromptMigration = typeof parsed.replayPrompt !== "string";
        const needsRunScriptMigration = typeof parsed.runScriptEnabled !== "boolean";
        const needsNotifyEnabledMigration = typeof parsed.notifyEnabled !== "boolean";
        const needsCodexVersionMigration = typeof parsed.aftcCodexVersion !== "number";
        // When adding the notifyEnabled key to an existing config.json: users
        // who already had notification sounds configured keep the feature ON
        // (their setup is never silenced); everyone else starts disabled.
        const migratedNotifyEnabled = [
            parsed.notifySoundQuestion, parsed.notifySoundTaskComplete,
            parsed.notifySoundError, parsed.notifySoundAborted, parsed.notifySoundStartup,
        ].some((v) => typeof v === "string" && v.length > 0);
        const needsMigration =
            needsIntroMigration || needsFooterAveragesMigration || needsNotifyQuestionMigration ||
            needsNotifyTaskMigration || needsNotifyTimeMigration ||
            needsNotifyErrorMigration || needsNotifyAbortedMigration ||
            needsNotifyStartupMigration || needsNotifyContext25Migration ||
            needsNotifyContext50Migration || needsNotifyContext75Migration ||
            needsReplayPromptMigration ||
            needsWarGamesMigration || needsCodexEnabledMigration ||
            needsCodexGuidanceMigration ||
            needsCodexAutoLoadMigration ||
            needsCodexSeededMigration || needsCodexAutoAddMigration ||
            needsRunScriptMigration || needsNotifyEnabledMigration ||
            needsCodexVersionMigration;

        const merged: Preferences = {
            ...DEFAULT_PREFERENCES,
            ...parsed,
            ...(needsIntroMigration ? { "aftc-intro": DEFAULT_PREFERENCES["aftc-intro"] } : {}),
            ...(needsFooterAveragesMigration ? { footerAveragesEnabled: DEFAULT_PREFERENCES.footerAveragesEnabled } : {}),
            ...(needsNotifyQuestionMigration ? { notifySoundQuestion: DEFAULT_PREFERENCES.notifySoundQuestion } : {}),
            ...(needsNotifyTaskMigration ? { notifySoundTaskComplete: DEFAULT_PREFERENCES.notifySoundTaskComplete } : {}),
            ...(needsNotifyTimeMigration ? { notifyTimeSec: DEFAULT_PREFERENCES.notifyTimeSec } : {}),
            ...(needsNotifyErrorMigration ? { notifySoundError: DEFAULT_PREFERENCES.notifySoundError } : {}),
            ...(needsNotifyAbortedMigration ? { notifySoundAborted: DEFAULT_PREFERENCES.notifySoundAborted } : {}),
            ...(needsNotifyStartupMigration ? { notifySoundStartup: DEFAULT_PREFERENCES.notifySoundStartup } : {}),
            ...(needsNotifyContext25Migration ? { notifySoundContext25: DEFAULT_PREFERENCES.notifySoundContext25 } : {}),
            ...(needsNotifyContext50Migration ? { notifySoundContext50: DEFAULT_PREFERENCES.notifySoundContext50 } : {}),
            ...(needsNotifyContext75Migration ? { notifySoundContext75: DEFAULT_PREFERENCES.notifySoundContext75 } : {}),
            ...(needsReplayPromptMigration ? { replayPrompt: DEFAULT_PREFERENCES.replayPrompt } : {}),
            ...(needsWarGamesMigration ? { warGamesEnabled: DEFAULT_PREFERENCES.warGamesEnabled } : {}),
            ...(needsCodexEnabledMigration ? { aftcCodexEnabled: DEFAULT_PREFERENCES.aftcCodexEnabled } : {}),
            ...(needsCodexGuidanceMigration ? { aftcCodexInjectGuidance: DEFAULT_PREFERENCES.aftcCodexInjectGuidance } : {}),
            ...(needsCodexAutoLoadMigration ? { aftcCodexAutoLoad: DEFAULT_PREFERENCES.aftcCodexAutoLoad } : {}),
            ...(needsCodexSeededMigration ? { aftcCodexSeeded: DEFAULT_PREFERENCES.aftcCodexSeeded } : {}),
            ...(needsCodexAutoAddMigration ? { aftcCodexAutoAddEntries: DEFAULT_PREFERENCES.aftcCodexAutoAddEntries } : {}),
            ...(needsRunScriptMigration ? { runScriptEnabled: DEFAULT_PREFERENCES.runScriptEnabled } : {}),
            ...(needsNotifyEnabledMigration ? { notifyEnabled: migratedNotifyEnabled } : {}),
            ...(needsCodexVersionMigration ? { aftcCodexVersion: DEFAULT_PREFERENCES.aftcCodexVersion } : {}),
        };
        // Strip obsolete keys from older versions so the saved file
        // matches the current Preferences schema. Removed keys:
        //   - notifySound: pre-multi-category single-key for the
        //     task-complete sound. Replaced by per-category keys
        //     (notifySoundQuestion / notifySoundTaskComplete / etc.).
        //   - aftcCodexInjectMode: dev-only v1.17.0 toggle that became
        //     per-session state in /codex-inject-rules.
        // Mirror this table in docs/data-and-packaging.md when the
        // list grows.
        delete (merged as any).notifySound;
        delete (merged as any).aftcCodexInjectMode;
        if (needsMigration) savePreferencesInternal(merged);
        return merged;
    } catch (err) {
        console.log(`[aftc-toolset] config.json read/parse error: ${(err as Error).message}`);
        return { ...DEFAULT_PREFERENCES };
    }
}

function savePreferencesInternal(prefs: Preferences): void {
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
 * Persist a single preference. Fresh read-modify-write of config.json
 * (the merge in loadPreferencesInternal preserves any hand edits made
 * since the last write), saved atomically. Best-effort: errors are
 * logged, never thrown. This is the ONLY path that writes config.json
 * after the initial ensure and the missing-key migration — call it
 * when a preference actually changes.
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

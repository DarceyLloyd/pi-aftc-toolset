/**
 * pi-aftc-toolset / aftc-codex — system-prompt injection + session lifecycle.
 *
 * The cache-friendly "hybrid" injection design (spec D1 / D7):
 *
 *   - STABLE ALWAYS-ON CONTENT (codex-rules.md + thought-and-action-guidance.md
 *     when enabled + the generated codex-resource-list.md) rides the CACHED
 *     system-prompt prefix via `before_agent_start` returning `{ systemPrompt }`.
 *     Read fresh from disk each turn (byte-stable files -> no prefix churn).
 *     Never pollutes history, never accumulates, resume-proof. Injected only when
 *     `enabled && prepped && !silent`.
 *
 *   - A lightweight MARKER custom message ("aftc-codex-marker") is the detectable /
 *     prunable "codex presence" in history. It carries a short visible note + the
 *     instruction to fetch relevant docs via codex_load. Rendered in the transcript
 *     so the user sees codex is active.
 *
 *   - The `prepped` / `silent` state is per-session and DURABLE: persisted via
 *     `pi.appendEntry("aftc-codex-state", …)` (a custom entry — NOT in LLM context),
 *     restored on session_start by scanning the entries. Survives compaction.
 *
 *   - Fresh-session detection uses `session_start.reason` (no getEntries heuristic):
 *     fresh = "new" | "startup"; restore = "resume" | "reload" | "fork". On a fresh
 *     enabled+un-prepped session, append a stand-out transcript notice (TUI) or
 *     auto-prep (print/headless). The notice is a durable custom entry rendered via
 *     registerEntryRenderer — NO timer / NO TUI-ready wait (spec D7). The renderer
 *     derives from CURRENT truth (compat guard + live session state) on every paint,
 *     never the append-time snapshot, so re-renders on /reload//resume can never
 *     show a stale out-of-date warning or a stale /codex-init nag.
 *
 * The `context`-event prune filter lives here too (added in step 3.1).
 *
 * See `codex-inject-readme.md` for the full contract.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Box, Spacer, Text } from "@earendil-works/pi-tui";
import { getPreference } from "../config";
import type { CodexContext, CodexDetectResult } from "./aftc-codex";
import * as aftcConsole from "../ui/aftc-console";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Custom-entry type holding the durable per-session prepped/silent state. */
export const CODEX_STATE_ENTRY = "aftc-codex-state";
/** Custom-entry type for the fresh-session "prep me" notice (TUI only, not in LLM). */
export const CODEX_PREP_NOTICE_ENTRY = "aftc-codex-prep-notice";
/** Custom-message type for the in-history codex marker (in LLM context, prunable). */
export const CODEX_MARKER_MESSAGE = "aftc-codex-marker";
/** Custom-entry type tracking a codex resource read (durable; survives reload/resume/compaction). */
export const CODEX_READ_ENTRY = "aftc-codex-read";
/** Custom-entry type for the /aftc-codex-status colored transcript output (not in LLM). */
export const CODEX_STATUS_ENTRY = "aftc-codex-status";

/**
 * Marker content — STABLE (no counts/timestamps) to preserve conversation
 * caching (spec M-M5). The resource count lives in the system-prompt list,
 * not here.
 */

/** Extract the "## Critical Global Rules" section (heading included) from a
 *  codex-rules.md text — the rules-only injection block. "" when absent. */
function extractCriticalRules(rules: string): string {
    const m = /^## Critical Global Rules[ \t]*$/m.exec(rules);
    if (!m) return "";
    const rest = rules.slice(m.index);
    const next = /^## /m.exec(rest.slice(m[0].length));
    const body = next ? rest.slice(0, m[0].length + next.index) : rest;
    return body.trim();
}

const MARKER_CONTENT =
    "AFTC-CODEX ACTIVE - the codex rules + guidance are loaded into your system prompt, " +
    "and the Codex Resource List is available there too.\n\n" +
    "Do these steps IN ORDER:\n" +
    "1. Work out the project tech stack and the current task, then retrieve the relevant " +
    "codex resources with the codex_load tool (eg codex_load(\"typescript\")). Load a resource " +
    "before you rely on that technology's conventions. Do NOT codex_load rules, guidance, or " +
    "list - they are already in your system prompt. When the user's request involves planning or " +
    "documentation work, your first tool call is codex_load(\"documentation-and-planning\") - its " +
    "work-methodology rules apply even before the project stack is known.\n" +
    "2. Confirm with ONE short line stating which topics were loaded (eg \"Codex resources " +
    "loaded for: css, html, javascript.\") - do NOT list or summarise the individual " +
    "gotchas/entries you found inside them.\n" +
    "3. Find the default entry point: this agent tool's auto-loaded context file (AGENTS.md, " +
    "CLAUDE.md, GEMINI.md, .github/copilot-instructions.md, .cursorrules or .windsurfrules). " +
    "It is usually already in your context; if it is not, look for those files in the project " +
    "root and read the one that exists.\n" +
    "4. LAST STEP: if the entry point contains a docx section (an AFTC-DOCX block), follow its " +
    "instructions and read the root documentation and map files (docx/project_documentation.md " +
    "and docx/project_map.md) immediately after completing step 1's codex resource discovery " +
    "and loading.";

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface CodexInjectApi {
    /** Append the codex marker message. `busy` = agent currently streaming.
     *  `eager` = trigger a turn now (the /codex-init force). `topics` =
     *  optional detected project topics named in the instruction (autoLoad);
     *  `missing` = mapped topics with no resource file yet (bootstrap hint). */
    injectMarker(busy: boolean, eager: boolean, topics?: string[], missing?: string[]): void;
    /** Build the system-prompt block, or null when nothing should be injected. */
    buildPromptBlock(): string | null;
    /** Persist the current prepped/silent state as a durable custom entry. */
    persistState(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createCodexInject(
    ctx: CodexContext,
    detect?: { detect(cwd: string): CodexDetectResult; resetCache(): void },
): CodexInjectApi {
    const { pi, store, state, checkCompat } = ctx;


    const boldWhite = (text: string, theme: any) => {
        try {
            return theme.bold(text);
        } catch {
            return text;
        }
    }

    const boldOrange = (text: string, theme: any) => {
        try {
            return theme.fg("mdHeading", theme.bold(text));
        } catch {
            return text;
        }
    }

    const randSpaces = () => {
        // 1 to 5 spaces — a small visual jitter so the prep-notice box
        // looks hand-drawn. Used to be `Math.random() * 50 + 1` (50 max)
        // which inflated the jitter and made the box look weirdly wide.
        const count = Math.floor(Math.random() * 5) + 1;
        return " ".repeat(count);
    }


    // ---- entry renderer: fresh-session prep notice (registered once) ----
    // This entry is DURABLE: pi re-renders it on every /reload and /resume,
    // long after the append-time snapshot in entry.data was taken. NEVER render
    // the snapshot blindly — derive from the CURRENT truth (the compat guard's
    // fresh disk reads + live session state) on every paint:
    //   - the out-of-date warning shows only while the guard STILL fails (an
    //     auto-sync /codex-sync moments later flips it to a resolved line —
    //     regression: the warning used to replay forever on /reload, and /new
    //     "fixed" it only because a fresh session has no old entries);
    //   - the "run /codex-init" nag shows only while the session is genuinely
    //     un-prepped (a prepped session gets a one-line "active" note instead).
    // compatSafeNow is TTL-cached (2s): renderers can fire per redraw frame and
    // the guard does two small disk reads. Fail-soft: an error reads as SAFE —
    // a renderer must never cry wolf.
    let compatCache: { at: number; safe: boolean } | null = null;
    const compatSafeNow = (): boolean => {
        const now = Date.now();
        if (compatCache && now - compatCache.at < 2000) return compatCache.safe;
        let safe = true;
        try { safe = checkCompat().isSafe; } catch { /* keep fail-soft default */ }
        compatCache = { at: now, safe };
        return safe;
    };

    pi.registerEntryRenderer(CODEX_PREP_NOTICE_ENTRY, (_entry, _opts, theme) => {
        const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
        box.addChild(new Text(theme.fg("accent", theme.bold("AFTC CODEX [PI Skills on steroids]" + randSpaces())), 0, 0));

        let noticeData: { outOfSync?: boolean } = {};
        try { noticeData = (_entry.data ?? {}) as { outOfSync?: boolean }; } catch { /* fail-soft */ }

        // Out of date RIGHT NOW -> the warning (even if this entry was appended
        // as a plain prep notice: a newer seed can land mid-session via update).
        if (!compatSafeNow()) {
            box.addChild(new Text(
                theme.fg("warning", "WARNING: Your AFTC codex is outdated."),
                0, 0,
            ));
            box.addChild(new Text(
                "Run " + boldWhite("`/codex-sync`", theme) + " to update (keeps your learned entries) or " + boldWhite("`/codex-install`", theme) + " for a fresh copy.",
                0, 0,
            ));
            return box;
        }

        // Appended as a warning, since resolved (auto-sync / manual /codex-sync).
        if (noticeData.outOfSync === true) {
            box.addChild(new Text(
                theme.fg("accent", "Codex was synced — you are up to date now. Run " + boldWhite("`/codex-init`", theme) + " to prep the AI."),
                0, 0,
            ));
            return box;
        }

        // Session already live -> a one-line note, not the full prep nag.
        if (state.rulesOnly) {
            box.addChild(new Text(
                "Codex RULES-ONLY mode is active for this session (critical rules only).",
                0, 0,
            ));
            return box;
        }


        if (state.prepped && !state.silent) {
            box.addChild(new Text(
                "Codex is active - rules + resources are in the AI's system prompt.",
                0, 0,
            ));
            return box;
        }



        // box.addChild(new Text("Codex is ENABLED but the AI is not prepped yet.", 0, 0));

        let str: any = "";


        str += theme.fg("text", "1. Load codex resources on demand via");
        str += theme.fg("warning", " `codex load <resource>`");
        str += theme.fg("text", ".\nList available codex resources via ");
        str += theme.fg("warning", "`codex load <resource>`");

        str += theme.fg("text", "\n\n2. Auto prep the AI via");
        str += theme.fg("warning", " `/codex-init` ");
        str += theme.fg("text", "(injects rules + guidance into the SYSTEM PROMPT).\n");
        str += theme.fg("warning", "WARNING: this could load a lot of skills into the SYSTEM PROMPT.");

        str += theme.fg("text", "\n\n3. Inject codex rules only into system prompt via");
        str += theme.fg("warning", " `/codex-rules-only`.");

        str += theme.fg("text", "\n\n4. List available codex resources via");
        str += theme.fg("warning", " `/codex-list`.");

        str += theme.fg("text", "\n\n5. Pick codex resources to load via");
        str += theme.fg("warning", " `/codex-load` ");
        str += theme.fg("text", "(loads into the chat - NOT the system prompt).\n");
        str += theme.fg("text", "You can also ask the AI to load resources via ");
        str += theme.fg("warning", "`codex load <resource>");
        str += theme.fg("text", ".");

        str += theme.fg("text", "\n\nDissable codex via the `/codex` menu.");

        box.addChild(new Text(
            str,
            0, 0,
        ));
        box.addChild(new Spacer(1));



        str = theme.fg("warning", "IMPORTANT:\n");
        str += theme.fg("text", "When you're done, run ");
        str += theme.fg("warning", "`/codex-learn`",);
        str += theme.fg("text", ", CODEX will learn ");
        str += theme.fg("warning", "Rules, Gotchyas and Issues & Solutions\n");
        str += theme.fg("text", "for your tech stack and help AI models better one shot your tasks, making codex skills more effective.\n");
        box.addChild(new Text(
            str,
            0, 0,
        ));


        box.addChild(new Spacer(1));

        str = theme.fg("text", "DISSABLE CODEX VIA:");
        str += theme.fg("warning", "`/codex` ");
        box.addChild(new Text(
            str,
            0, 0,
        ));




        return box;
    });

    // ---- message renderer: the in-history marker ----
    pi.registerMessageRenderer(CODEX_MARKER_MESSAGE, (message, _opts, theme) => {
        const text = typeof message.content === "string" ? message.content : MARKER_CONTENT;
        return new Text(theme.fg("accent", text), 0, 0);
    });

    // ---- entry renderer: /aftc-codex-status colored output (registered once) ----
    // Each line is "<title>: <state>" — title white (mdHeading), state accent (#fca02f).
    pi.registerEntryRenderer(CODEX_STATUS_ENTRY, (entry, _opts, theme) => {
        const d = (entry.data ?? {}) as { enabled?: boolean; embedded?: boolean; read?: number; total?: number; version?: string };
        const yn = (b: boolean) => (b ? "Yes" : "No");
        const rows: Array<[string, string]> = [
            ["AFTC Codex Enabled", yn(!!d.enabled)],
            ["Embedded in context/conversation window", yn(!!d.embedded)],
            ["No' of codex files read", `${d.read ?? 0}/${d.total ?? 0}`],
            ["Codex version", d.version ?? "unknown"],
        ];
        const box = new Box(1, 1, (text) => text);
        for (const [title, value] of rows) {
            try {
                box.addChild(new Text(
                    `${theme.fg("mdHeading", theme.bold(`${title}:`))} ${theme.fg("accent", value)}`,
                    0, 0,
                ));
            } catch {
                // Fail-soft: a theme without the expected color keys still shows plain text.
                box.addChild(new Text(`${title}: ${value}`, 0, 0));
            }
        }
        return box;
    });

    function persistState(): void {
        try {
            pi.appendEntry(CODEX_STATE_ENTRY, {
                prepped: state.prepped,
                silent: state.silent,
                rulesOnly: state.rulesOnly,
            });
        } catch (err) {
            aftcConsole.logError(`[aftc-toolset] codex persistState error: ${(err as Error).message}`);
        }
    }

    function injectMarker(busy: boolean, eager: boolean, topics?: string[], missing?: string[]): void {
        try {
            // Detected-topics hint (autoLoad, step 4.2). Kept after the stable base so
            // the always-present instruction reads identically turn to turn.
            let content = MARKER_CONTENT;
            if (topics && topics.length > 0) {
                content += `\n\nDetected project topics: ${topics.join(", ")}. Load these with codex_load first.`;
            }
            if (missing && missing.length > 0) {
                content += `\n\nNo codex resource yet for: ${missing.join(", ")}. Do NOT codex_load these — ` +
                    `if you learn a durable lesson about one, create the resource with codex_add_entry (topic "category/name").`;
            }
            if (busy) {
                // Streaming: deliverAs is required or pi throws (spec M-I5).
                pi.sendMessage(
                    { customType: CODEX_MARKER_MESSAGE, content, display: true },
                    { deliverAs: "followUp" },
                );
            } else if (eager) {
                // Idle + eager (/codex-init): trigger a turn so the model fetches now.
                pi.sendMessage(
                    { customType: CODEX_MARKER_MESSAGE, content, display: true },
                    { triggerTurn: true },
                );
            } else {
                // Idle + lazy (print auto-prep): append to context, no turn.
                pi.sendMessage(
                    { customType: CODEX_MARKER_MESSAGE, content, display: true },
                );
            }
        } catch (err) {
            aftcConsole.logError(`[aftc-toolset] codex injectMarker error: ${(err as Error).message}`);
        }
    }

    function buildPromptBlock(): string | null {
        try {
            // Rules-only mode (per-session state, /codex-inject-rules): inject
            // ONLY the Critical Global Rules section. Zero ceremony: no
            // enabled/prepped/silent/compat gates, no marker, no list, no
            // guidance. Reads the live copy when seeded (user-customised rules
            // honoured), else the seed (works unseeded; always current after
            // pi update).
            if (state.rulesOnly) {
                const rulesOnly = store.readRules() || store.readSeedRules();
                const critical = extractCriticalRules(rulesOnly);
                if (!critical) return null;
                return "\n\n---\n\n# AFTC Codex — Critical Rules\n\n" + critical;
            }

            if (!getPreference("aftcCodexEnabled", false)) return null;
            if (!state.prepped || state.silent) return null;
            // Version guard: an out-of-date live codex must not be injected —
            // codex features pause until /codex-install wipes + re-seeds.
            if (!checkCompat().isSafe) return null;

            const rules = store.readRules();
            if (!rules.trim()) return null; // not seeded / no rules -> nothing to inject

            const parts: string[] = [];
            parts.push("\n\n---\n\n# AFTC Codex — Knowledge Base Rules & Resources\n");
            parts.push(rules.trim());

            // Auto-insert AGENTS.md codex load list: gated by the
            // aftcCodexAutoInsertAgentsEnabled preference. The base rules
            // instruct creating/updating the AFTC-CODEX-STACK block; when the
            // user turned auto-insert OFF (default) that instruction must be
            // overridden so codex never writes those files (it may still READ
            // an existing block for detection).
            if (getPreference("aftcCodexAutoInsertAgentsEnabled", false)) {
                parts.push(
                    "\n\n## Auto-insert AGENTS.md codex load list (ON)\n" +
                    "Auto-insert of the codex resources-to-load list (the AFTC-CODEX-STACK block) into " +
                    "the project's auto-inject files is ENABLED - maintain it as the rules above say " +
                    "(create when missing, update when the stack changes, keep it identical across " +
                    "the recognised files).",
                );
            } else {
                parts.push(
                    "\n\n## Auto-insert AGENTS.md codex load list (OFF)\n" +
                    "Auto-insert of the codex resources-to-load list (the AFTC-CODEX-STACK block) into " +
                    "auto-inject files (AGENTS.md, CLAUDE.md, GEMINI.md, .cursorrules, .windsurfrules, " +
                    ".github/copilot-instructions.md) is DISABLED. Do NOT create, update, or remove an " +
                    "AFTC-CODEX-STACK block in any of them. Detection may still read an existing block.",
                );
            }

            if (getPreference("aftcCodexInjectGuidance", true)) {
                const guidance = store.readGuidance();
                if (guidance.trim()) {
                    parts.push("\n\n## Thinking & Action Guidance\n");
                    parts.push(guidance.trim());
                }
            }

            const list = store.readList();
            if (list.trim()) {
                parts.push("\n\n## Codex Resource List\n");
                parts.push(list.trim());
            }

            parts.push(
                "\n\nFetch any listed resource on demand with the codex_load tool " +
                "(eg codex_load(\"typescript\")). Load the relevant resources before " +
                "relying on a technology's conventions. " +
                "Do NOT codex_load the rules, guidance, or resource list — they are already " +
                "in this system prompt above.",
            );

            return parts.join("\n");
        } catch (err) {
            aftcConsole.logError(`[aftc-toolset] codex buildPromptBlock error: ${(err as Error).message}`);
            return null;
        }
    }

    // ---- before_agent_start: inject the stable block into the cached prefix ----
    pi.on("before_agent_start", async (event) => {
        const block = buildPromptBlock();
        if (!block) return undefined;
        return { systemPrompt: event.systemPrompt + block };
    });

    // ---- context: prune accumulated codex docs + markers (step 3.1) ----
    // Non-destructive filter of the LLM-bound deep copy only (stored history is
    // untouched — spec G1/G2). codex_load docs are removed as matched tool_use+
    // tool_result PAIRS so a tool_use is never orphaned (spec M-C1). When disabled
    // or silent, ALL codex is removed; otherwise the latest generation of docs
    // and the latest marker are kept (spec M-C5).
    pi.on("context", async (event) => {
        try {
            const enabled = getPreference("aftcCodexEnabled", false);
            const removeAll = !enabled || state.silent;
            const messages = event.messages as Array<any>;

            const hasCodex = messages.some((m) =>
                (m.role === "custom" && m.customType === CODEX_MARKER_MESSAGE) ||
                (m.role === "toolResult" && m.toolName === "codex_load") ||
                (m.role === "assistant" && Array.isArray(m.content) &&
                    m.content.some((b: any) => b.type === "toolCall" && b.name === "codex_load")));
            if (!hasCodex) return undefined;

            // Latest generation = the last assistant message that has codex_load calls.
            let latestGenMsgIndex = -1;
            for (let i = 0; i < messages.length; i++) {
                const m = messages[i];
                if (m.role === "assistant" && Array.isArray(m.content) &&
                    m.content.some((b: any) => b.type === "toolCall" && b.name === "codex_load")) {
                    latestGenMsgIndex = i;
                }
            }
            const keepIds = new Set<string>();
            if (!removeAll && latestGenMsgIndex >= 0) {
                for (const b of messages[latestGenMsgIndex].content) {
                    if (b.type === "toolCall" && b.name === "codex_load") keepIds.add(b.id);
                }
            }

            // Latest marker index (kept when not removeAll).
            let latestMarkerIndex = -1;
            for (let i = 0; i < messages.length; i++) {
                const m = messages[i];
                if (m.role === "custom" && m.customType === CODEX_MARKER_MESSAGE) latestMarkerIndex = i;
            }

            const out: Array<any> = [];
            let changed = false;
            for (let i = 0; i < messages.length; i++) {
                const m = messages[i];

                if (m.role === "custom" && m.customType === CODEX_MARKER_MESSAGE) {
                    if (removeAll || i !== latestMarkerIndex) { changed = true; continue; }
                    out.push(m);
                    continue;
                }

                if (m.role === "toolResult" && m.toolName === "codex_load") {
                    if (keepIds.has(m.toolCallId)) out.push(m);
                    else changed = true; // pruned pair
                    continue;
                }

                if (m.role === "assistant" && Array.isArray(m.content) &&
                    m.content.some((b: any) => b.type === "toolCall" && b.name === "codex_load")) {
                    const newContent = m.content.filter(
                        (b: any) => !(b.type === "toolCall" && b.name === "codex_load" && !keepIds.has(b.id)),
                    );
                    if (newContent.length === 0) { changed = true; continue; } // emptied -> drop
                    if (newContent.length !== m.content.length) {
                        out.push({ ...m, content: newContent });
                        changed = true;
                        continue;
                    }
                    out.push(m);
                    continue;
                }

                out.push(m);
            }

            return changed ? { messages: out } : undefined;
        } catch (err) {
            aftcConsole.logError(`[aftc-toolset] codex context prune error: ${(err as Error).message}`);
            return undefined;
        }
    });

    // ---- session_start: restore state + fresh-session notice / auto-prep ----
    pi.on("session_start", async (event, sctx) => {
        try {
            state.noticedThisSession = false;

            // Restore prepped/rulesOnly from the latest aftc-codex-state entry.
            // Runs even when the feature is disabled: rules-only mode works
            // without the enabled pref, so its state must survive /reload.
            // Fresh sessions have no entries -> everything resets to false.
            state.prepped = false;
            state.silent = false;
            state.rulesOnly = false;
            if (detect) detect.resetCache();
            try {
                const entries = sctx.sessionManager.getEntries() as Array<{
                    type?: string;
                    customType?: string;
                    data?: { prepped?: boolean; silent?: boolean; rulesOnly?: boolean };
                }>;
                for (const entry of entries) {
                    if (entry.type === "custom" && entry.customType === CODEX_STATE_ENTRY && entry.data) {
                        state.prepped = entry.data.prepped === true;
                        state.rulesOnly = entry.data.rulesOnly === true;
                        // `silent` resets each session (spec H Q1) — only `prepped`
                        // and `rulesOnly` are restored from the durable entry.
                    }
                }
            } catch {
                // leave defaults (all false)
            }

            // Rules-only mode: no prep ceremony, ever (no notice, no marker, no
            // auto-prep) — buildPromptBlock injects the critical rules section
            // without any gate.
            if (state.rulesOnly) return;

            if (!getPreference("aftcCodexEnabled", false)) return;

            const reason = event.reason;
            const isRestore = reason === "resume" || reason === "reload" || reason === "fork";
            if (isRestore) {
                // Prepped -> rules live (before_agent_start handles it). Not prepped ->
                // stay un-prepped, no notice (avoid nagging on resume). Spec D7 step 3.
                return;
            }

            // Fresh session (new | startup), enabled, not prepped -> notice / auto-prep.
            if (state.prepped) return;

            // Prep assumes seeded (spec M-C6): seed if needed (pre-trained default).
            store.ensureSeeded("pretrained");

            const isTui = sctx.hasUI && sctx.mode === "tui";
            if (isTui) {
                if (!state.noticedThisSession) {
                    // Codex out of date? The notice gains a NOTICE line.
                    let outOfSync = false;
                    try {
                        outOfSync = !checkCompat().isSafe;
                    } catch { /* fail-soft */ }
                    pi.appendEntry(CODEX_PREP_NOTICE_ENTRY, { at: Date.now(), outOfSync });
                    state.noticedThisSession = true;
                }
            } else {
                // Print / headless: the enabled flag IS the decision -> auto-prep.
                state.prepped = true;
                state.silent = false;
                persistState();
                const detected = (getPreference("aftcCodexAutoLoad", true) && detect && sctx.cwd)
                    ? detect.detect(sctx.cwd)
                    : undefined;
                injectMarker(false, false, detected?.topics, detected?.missing);
            }
        } catch (err) {
            aftcConsole.logError(`[aftc-toolset] codex session_start error: ${(err as Error).message}`);
        }
    });

    return { injectMarker, buildPromptBlock, persistState };
}

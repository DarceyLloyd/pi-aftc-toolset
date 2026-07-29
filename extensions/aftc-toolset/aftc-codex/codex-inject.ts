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
 *     registerEntryRenderer — NO timer / NO TUI-ready wait (spec D7).
 *
 * The `context`-event prune filter lives here too (added in step 3.1).
 *
 * See `codex-inject-readme.md` for the full contract.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Box, Spacer, Text } from "@earendil-works/pi-tui";
import { getPreference } from "../config";
import type { CodexContext } from "./aftc-codex";

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
const MARKER_CONTENT =
    "AFTC-CODEX ACTIVE — the codex rules + guidance are loaded into your system prompt, " +
    "and the Codex Resource List is available there too.\n\n" +
    "Based on the project tech stack and the current task, retrieve the relevant codex " +
    "resources with the codex_load tool (eg codex_load(\"typescript\")). Load a resource " +
    "before you rely on that technology's conventions. " +
    "Do NOT codex_load rules, guidance, or list — they are already in your system prompt.\n\n" +
    "After loading, confirm with ONE short line stating which topics were loaded " +
    "(eg \"Codex resources loaded for: css, html, javascript.\") — do NOT list or summarise " +
    "the individual gotchas/entries you found inside them. Then wait for the user's task.";

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface CodexInjectApi {
    /** Append the codex marker message. `busy` = agent currently streaming.
     *  `eager` = trigger a turn now (the /codex-init force). `topics` =
     *  optional detected project topics named in the instruction (autoLoad). */
    injectMarker(busy: boolean, eager: boolean, topics?: string[]): void;
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
    detect?: { detectTopics(cwd: string): string[]; resetCache(): void },
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
        const count = Math.floor(Math.random() * 50) + 1; // 1 to 5 spaces
        return " ".repeat(count);
    }


    // ---- entry renderer: fresh-session prep notice (registered once) ----
    pi.registerEntryRenderer(CODEX_PREP_NOTICE_ENTRY, (_entry, _opts, theme) => {
        const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
        box.addChild(new Text(theme.fg("accent", theme.bold("AFTC CODEX (ALPHA 1)" + randSpaces())), 0, 0));


        const noticeData = (_entry.data ?? {}) as { outOfSync?: boolean };
        if (noticeData.outOfSync === true) {
            box.addChild(new Text(
                theme.fg("warning", "WARNING: Your AFTC codex is outdated. Run /codex-install to replace it."),
                0, 0,
            ));
        } else {

            box.addChild(new Text("Codex is ENABLED but the AI is not prepped yet.", 0, 0));
            box.addChild(new Text(
                "Run " + boldWhite("`/codex-init`", theme) + " to load the codex resources relevant for this project.",
                0, 0,
            ));
            box.addChild(new Spacer(1));


            box.addChild(new Text(
                theme.fg("warning", boldOrange("WARNING:", theme)),
                0, 0,
            ));
            box.addChild(new Text(
                "Codex loads resources on-demand and can use low tier subscriptions hourly quotas fast.",
                0, 0,
            ));
            box.addChild(new Spacer(1));


            box.addChild(new Text(
                theme.fg("warning", boldOrange("Recommended models & plans:", theme)),
                0, 0,
            ));
            box.addChild(new Text(
                theme.fg("warning", "- Kimi K3 (Vivace plan)"),
                0, 0,
            ));
            box.addChild(new Text(
                theme.fg("warning", "- ZAI GLM 5.2 (Max plan)"),
                0, 0,
            ));
            box.addChild(new Text(
                theme.fg("warning", "- Qwen 3.8 Max (Pro plan) etc."),
                0, 0,
            ));

            box.addChild(new Spacer(1));
            box.addChild(new Text(
                "I find that GLM 5.2 Coding Pro and Kimi Allegretto plans 5 hour quota is used up in 1.5 to 2.5 hours.",
                0, 0,
            ));
            box.addChild(new Text(
                "This does depend on how complex or big the task and project is.",
                0, 0,
            ));

        }

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
        const d = (entry.data ?? {}) as { enabled?: boolean; embedded?: boolean; read?: number; total?: number };
        const yn = (b: boolean) => (b ? "Yes" : "No");
        const rows: Array<[string, string]> = [
            ["AFTC Codex Enabled", yn(!!d.enabled)],
            ["Embedded in context/conversation window", yn(!!d.embedded)],
            ["No' of codex files read", `${d.read ?? 0}/${d.total ?? 0}`],
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
            });
        } catch (err) {
            console.log(`[aftc-toolset] codex persistState error: ${(err as Error).message}`);
        }
    }

    function injectMarker(busy: boolean, eager: boolean, topics?: string[]): void {
        try {
            // Detected-topics hint (autoLoad, step 4.2). Kept after the stable base so
            // the always-present instruction reads identically turn to turn.
            let content = MARKER_CONTENT;
            if (topics && topics.length > 0) {
                content += `\n\nDetected project topics: ${topics.join(", ")}. Load these with codex_load first.`;
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
            console.log(`[aftc-toolset] codex injectMarker error: ${(err as Error).message}`);
        }
    }

    function buildPromptBlock(): string | null {
        try {
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
            console.log(`[aftc-toolset] codex buildPromptBlock error: ${(err as Error).message}`);
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
            console.log(`[aftc-toolset] codex context prune error: ${(err as Error).message}`);
            return undefined;
        }
    });

    // ---- session_start: restore state + fresh-session notice / auto-prep ----
    pi.on("session_start", async (event, sctx) => {
        try {
            state.noticedThisSession = false;

            if (!getPreference("aftcCodexEnabled", false)) return;

            // Restore prepped/silent from the latest aftc-codex-state entry.
            state.prepped = false;
            state.silent = false;
            if (detect) detect.resetCache();
            try {
                const entries = sctx.sessionManager.getEntries() as Array<{
                    type?: string;
                    customType?: string;
                    data?: { prepped?: boolean; silent?: boolean };
                }>;
                for (const entry of entries) {
                    if (entry.type === "custom" && entry.customType === CODEX_STATE_ENTRY && entry.data) {
                        state.prepped = entry.data.prepped === true;
                        // `silent` resets each session (spec H Q1) — only `prepped`
                        // is restored from the durable entry.
                    }
                }
            } catch {
                // leave defaults (false/false)
            }

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
                const topics = (getPreference("aftcCodexAutoLoad", true) && detect && sctx.cwd)
                    ? detect.detectTopics(sctx.cwd)
                    : undefined;
                injectMarker(false, false, topics);
            }
        } catch (err) {
            console.log(`[aftc-toolset] codex session_start error: ${(err as Error).message}`);
        }
    });

    return { injectMarker, buildPromptBlock, persistState };
}

/** Command-context busy check helper (mirrors replay.ts). */
export function isCommandBusy(ctx: ExtensionCommandContext | undefined): boolean {
    if (!ctx) return false;
    return ctx.isIdle ? !ctx.isIdle() : false;
}

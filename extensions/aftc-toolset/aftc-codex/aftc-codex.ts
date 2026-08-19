/**
 * pi-aftc-toolset / aftc-codex — feature coordinator.
 *
 * An opt-in knowledge-base feature: injects the maintainer's unified codex rules +
 * thinking guidance + a generated resource list into the model's system prompt, and
 * gives the model a `codex_load` tool to fetch topic docs on demand. Off by default.
 *
 * Coordinator pattern (AGENTS.md): this file owns the shared closure state and wires
 * the sub-modules; sub-modules import shared types FROM this file (type-only) and
 * never import each other. Wired into the extension by ONE `createAftcCodex(pi)`
 * line in `extensions/aftc-toolset/index.ts`.
 *
 * Sub-modules:
 *   - codex-store.ts    — data-dir layout, fixed-doc seeding, resource reads, list sync spawn
 *   - codex-inject.ts   — before_agent_start injection + session lifecycle + marker
 *   - codex-commands.ts — the /aftc-codex-* commands
 *   - codex-detect.ts   — project technology auto-detection
 *   - codex-learn.ts    — /aftc-codex-learn
 *   - codex-entries.ts  — codex_add_entry / codex_edit_entry / codex_remove_entry tools
 *   - codex-intent.ts   — planning/documentation intent suggestion
 *
 * This file also registers the `codex_load` model tool, owns the shared
 * read-tracker (durable read-entry dedup + the session-scoped set the entry
 * tools' read-before-write guard enforces), and runs the startup override that
 * re-copies the shipped fixed docs into the live codex when the package
 * version changes (once per extension load, first session_start; user resources
 * are never touched).
 *
 * Production-safety (spec Part G): off by default; fail-soft everywhere; never
 * destroys user data; seeding is copy-only. See `aftc-codex-readme.md`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_LINES,
    formatSize,
    truncateTail,
} from "@earendil-works/pi-coding-agent";
import { createCodexStore, type CodexStore, type CodexResourceRead, readPackageVersion } from "./codex-store";
import { createCodexInject, type CodexInjectApi, CODEX_READ_ENTRY } from "./codex-inject";
import { createCodexDetect } from "./codex-detect";
import { createCodexLearn, type CodexLearnApi } from "./codex-learn";
import { createCodexEntries, type CodexReadTracker } from "./codex-entries";
import { createCodexIntent } from "./codex-intent";
import { createCodexCommands } from "./codex-commands";
import { getPreference } from "../config";
import * as aftcConsole from "../ui/aftc-console";

// ─────────────────────────────────────────────────────────────────────────────
// Shared types (sub-modules import these type-only from "./aftc-codex")
// ─────────────────────────────────────────────────────────────────────────────

/** Mutable per-session state owned by the coordinator closure. */
export interface CodexState {
    /** The AI has been prepped this session (rules inject when enabled). */
    prepped: boolean;
    /** Per-session suppression set by /codex-disable (cleared by -run). */
    silent: boolean;
    /** Per-session rules-only mode set by /codex-inject-rules: inject ONLY the
     *  Critical Global Rules section; init/refresh refuse, learn still works; a fresh
     *  session (/new) clears it. Works even when the feature is disabled. */
    rulesOnly: boolean;
    /** Guard so the fresh-session notice is appended once per session. */
    noticedThisSession: boolean;
}

/** Detection result: topics with a live resource (loadable) and mapped topics
 *  with no resource file yet (bootstrap-able via codex_add_entry). Defined here
 *  so codex-detect/inject/commands share it type-only via the coordinator. */
export interface CodexDetectResult {
    topics: string[];
    missing: string[];
}

/** Shared context handed to each sub-module factory. */
export interface CodexContext {
    pi: ExtensionAPI;
    store: CodexStore;
    state: CodexState;
    /** Detect codex topics relevant to a cwd (Phase 4). Set after detect is built. */
    detect?(cwd: string): CodexDetectResult;
    /** The auto-inject file at `cwd` declaring an AFTC-CODEX-STACK block, or
     *  null. Set after detect is built (backing the auto-insert AGENTS.md
     *  notification). */
    stackBlockFile?(cwd: string): string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// codex_load tool (step 2.4)
// ─────────────────────────────────────────────────────────────────────────────

function registerCodexLoadTool(pi: ExtensionAPI, store: CodexStore, readTracker: CodexReadTracker): void {
    /** Track a successful read (session set for the entry tools' guard +
     *  durable entry for /aftc-codex-status). */
    function trackRead(relPath: string): void {
        readTracker.sessionReads.add(relPath);
        if (!readTracker.durableSeen.has(relPath)) {
            readTracker.durableSeen.add(relPath);
            try { pi.appendEntry(CODEX_READ_ENTRY, { relPath }); } catch { /* fail-soft */ }
        }
    }

    /**
     * D10 cascade: loading a topic whose TOP-LEVEL category has a
     * `<category>-common.md` loads that common too, once per session. Scoped
     * by the top-level path segment (ui-ux/web/web-app.md cascades
     * ui-ux/ui-ux-common.md); root-level topics and the common itself never
     * cascade.
     */
    function cascadeCommon(read: CodexResourceRead): { text?: string; relPath?: string; absPath?: string } | null {
        const rel = read.relPath;
        if (!rel.includes("/")) return null; // root-level topic: no category common
        const topSeg = rel.split("/")[0]!;
        const commonRel = `${topSeg}/${topSeg}-common.md`;
        if (rel === commonRel) return null; // the common itself
        if (readTracker.sessionReads.has(commonRel)) return null; // already loaded this session
        const common = store.readResource(`${topSeg}/${topSeg}-common`);
        if (!common) return null; // the category has no common
        trackRead(common.relPath);
        return { text: common.content, relPath: common.relPath, absPath: common.absPath };
    }

    pi.registerTool({
        name: "codex_load",
        label: "Codex Load",
        description:
            "Load an aftc-codex knowledge-base resource by topic name. Searches across " +
            "all category folders (flat and nested) and the top-level guidance files, so a " +
            "file's folder does not matter. Accepts aliases (ts, py, js) and the special " +
            "topics 'rules', 'guidance', 'list', 'markdown'. Loading a topic also loads its " +
            "category's <category>-common.md once per session (when the category has one). " +
            "Use this to fetch the conventions/gotchas for a " +
            "technology before you rely on them.",
        promptSnippet: "Load an aftc-codex knowledge-base resource (topic doc) by name on demand",
        promptGuidelines: [
            "Use codex_load to fetch the conventions and gotchas for a language, library, framework, engine, or tool before relying on them (eg codex_load(\"typescript\")).",
            "Use codex_load(\"list\") to see every available aftc-codex resource, and codex_load(\"guidance\") for the thinking-and-action guidance.",
        ],
        parameters: Type.Object({
            topic: Type.String({
                description:
                    "Resource topic name (eg \"typescript\", \"docker\", \"threejs\"). " +
                    "Aliases: ts, py, js. Specials: rules, guidance, list, markdown.",
            }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ectx) {
            const read = store.readResource(params.topic);
            if (!read) {
                const topics = store.listTopics();
                const listStr = topics.length > 0 ? topics.join(", ") : "(no resources seeded yet)";
                throw new Error(
                    `Unknown codex topic "${params.topic}". Available topics: ${listStr}`,
                );
            }

            // Session-scoped read set: the codex entry tools (codex-entries.ts)
            // require a codex_load of the topic THIS session before any write.
            // The durable entry lets /aftc-codex-status count files read.
            trackRead(read.relPath);

            // D10 cascade: the category's <category>-common.md rides along once
            // per session.
            const cascade = cascadeCommon(read);
            let cascadeText = "";
            if (cascade?.text !== undefined) {
                const cTrunc = truncateTail(cascade.text, {
                    maxLines: DEFAULT_MAX_LINES,
                    maxBytes: DEFAULT_MAX_BYTES,
                });
                cascadeText =
                    `\n\n# codex resource (auto-loaded category common): ${cascade.relPath}\n# file: ${cascade.absPath}\n\n${cTrunc.content}` +
                    (cTrunc.truncated ? `\n\n[Truncated. Full file: ${cascade.absPath}]` : "");
            }

            // Empty skeleton (headings but no entry bullets): a fixed one-liner
            // instead of the file content — no point spending context on an
            // empty doc. The read above still counts for the entry tools'
            // read-before-write guard (adding the FIRST entry needs it).
            if (!/^- \S/m.test(read.content)) {
                return {
                    content: [{ type: "text", text: `codex resource "${read.relPath}" exists but has no entries yet.${cascadeText}` }],
                    details: { relPath: read.relPath, absPath: read.absPath, empty: true, cascaded: cascade?.relPath },
                };
            }

            const truncation = truncateTail(read.content, {
                maxLines: DEFAULT_MAX_LINES,
                maxBytes: DEFAULT_MAX_BYTES,
            });

            let text = `# codex resource: ${read.relPath}\n# file: ${read.absPath}\n\n${truncation.content}`;
            if (truncation.truncated) {
                text +=
                    `\n\n[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines` +
                    ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).` +
                    ` Full file: ${read.absPath}]`;
            }
            text += cascadeText;

            return {
                content: [{ type: "text", text }],
                details: { relPath: read.relPath, absPath: read.absPath, truncated: truncation.truncated, cascaded: cascade?.relPath },
            };
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Coordinator
// ─────────────────────────────────────────────────────────────────────────────

export function createAftcCodex(pi: ExtensionAPI): void {
    const store = createCodexStore();
    const state: CodexState = { prepped: false, silent: false, rulesOnly: false, noticedThisSession: false };
    const ctx: CodexContext = { pi, store, state };

    // Project technology auto-detection (Phase 4). Wired onto ctx so inject/commands
    // can name detected topics without importing codex-detect directly.
    const detect = createCodexDetect(ctx);
    ctx.detect = (cwd: string) => detect.detect(cwd);
    ctx.stackBlockFile = (cwd: string) => detect.stackBlockFile(cwd);

    // Injection + session lifecycle (+ marker). Registers the entry/message
    // renderers and the before_agent_start / session_start / context handlers.
    const inject: CodexInjectApi = createCodexInject(ctx, detect);

    // Self-education (-learn) (Phase 5).
    const learn: CodexLearnApi = createCodexLearn(ctx);

    // The codex_load model tool. readTracker.durableSeen dedupes the durable
    // read-tracking entries appended within this process (the count is rebuilt
    // from entries); readTracker.sessionReads backs the entry tools'
    // read-before-write guard (maintained per session by codex-entries).
    const readTracker: CodexReadTracker = { durableSeen: new Set<string>(), sessionReads: new Set<string>() };
    registerCodexLoadTool(pi, store, readTracker);

    // The codex entry write tools (add/edit/remove) — deterministic writes:
    // TS-generated [ID]s, per-kind validation, canonical section placement,
    // topic/category creation, internal list-sync on new topic files.
    createCodexEntries(ctx, readTracker);

    // Planning/documentation intent suggestion (D14 - the optional heuristic
    // layer; the D5 directive wording in the marker/rules stays the robust path).
    createCodexIntent(ctx, readTracker);

    // The /aftc-codex-* commands + config menu (sync-first wrapper).
    createCodexCommands(ctx, inject, learn);

    // ---- startup maintenance: override shipped fixed docs on version change ----
    // Attempted ONCE per extension load, on the FIRST session_start of ANY
    // reason. The ONLY shipped-content update remaining: when the package
    // version changed, re-copy the shipped fixed docs (rules/guidance/markdown)
    // into the live codex and stamp the new version. User resources under
    // resources/ and the SQLite DB are NEVER touched. Fire-and-forget, never
    // throws.
    let startupMaintenanceDone = false;
    pi.on("session_start", () => {
        try {
            if (startupMaintenanceDone) return;
            startupMaintenanceDone = true;
            if (!store.isSeeded()) return; // first enable seeds via ensureSeeded
            const pkg = readPackageVersion();
            const installed = getPreference("aftcCodexInstalledVersion", "") ?? "";
            if (pkg && installed !== pkg) {
                store.seed();
            }
        } catch (err) {
            aftcConsole.logError(`[aftc-toolset] codex startup override error: ${(err as Error).message}`);
        }
    });

    aftcConsole.log("loaded — aftc-codex (off by default; /codex-enable to enable)");
}

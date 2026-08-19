/**
 * pi-aftc-toolset / aftc-codex — entry write tools (add / edit / remove).
 *
 * Three model tools that make codex resource WRITES deterministic instead of
 * prompt-choreographed (the model used to hand-edit files, hand-generate the
 * 6-char [ID]s, and run the sync script via bash):
 *
 *   - codex_add_entry    — append one or more entries (batched) under the
 *                          correct canonical section of a topic file. Generates
 *                          the [ID] in TypeScript, validates the per-kind format,
 *                          creates a missing topic file (three-heading skeleton)
 *                          and missing category folders, and regenerates the
 *                          resource list internally when a topic file is created.
 *   - codex_edit_entry   — targeted replacement of one entry by [ID] (optionally
 *                          moving it to a different section when `kind` changes).
 *   - codex_remove_entry — delete one entry by [ID] (all of its lines).
 *
 * Guards (BINDING):
 *   - Read-before-write: an EXISTING topic file must have been read via
 *     codex_load THIS SESSION before it can be modified (stale-content guard).
 *     Tracked in a session-scoped set shared with codex_load (the coordinator
 *     owns it; this module clears/rebuilds it on session_start).
 *   - Top-level fixed docs (rules / guidance / markdown / resource list) are
 *     refused — the tools only write resources/<category>/<topic>.md.
 *   - Exact-duplicate backstop: a normalized identical lead already in the file
 *     is rejected with the existing entry's [ID]. Semantic near-duplicates stay
 *     the model's job (it was forced to read the file first).
 *
 * Writes are atomic (tmp + rename) and serialised through withFileMutationQueue
 * keyed on the absolute target path. All I/O is fail-soft logged, but tool
 * errors (unknown topic, unread file, duplicate, bad format) THROW so the model
 * sees a real failure.
 *
 * See `codex-entries-readme.md` for the full contract.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { CodexContext } from "./aftc-codex";
import { CODEX_READ_ENTRY } from "./codex-inject";
import * as aftcConsole from "../ui/aftc-console";

// ─────────────────────────────────────────────────────────────────────────────
// Shared read-tracking (owned by the coordinator, shared with codex_load)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * durableSeen — dedupes the durable aftc-codex-read entries appended by
 *   codex_load (process lifetime, never cleared).
 * sessionReads — every relPath read via codex_load THIS session. Cleared on a
 *   fresh session, rebuilt from the durable entries on resume/reload/fork.
 *   This is the read-before-write enforcement set.
 */
export interface CodexReadTracker {
    durableSeen: Set<string>;
    sessionReads: Set<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry format constants (mirror the entry-format rules in the codex docs)
// ─────────────────────────────────────────────────────────────────────────────

const ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ID_LENGTH = 6;
/** Entry start with an ID: "- [xxxxxx] " or "- `[xxxxxx] " (backtick-wrapped). */
const ENTRY_ID_RE = /^- `?\[([a-zA-Z0-9]{6})\]\s?/;
/** Any entry bullet start. */
const ENTRY_START_RE = /^- \S/;
/** Indented continuation line (Issue Cause:/Fix: etc). */
const CONTINUATION_RE = /^\s+\S/;

type EntryKind = "rule" | "gotcha" | "issue";
const SECTION_HEADINGS: Record<EntryKind, string> = {
    rule: "## Rules",
    gotcha: "## Gotchyas",
    issue: "## Issues & Solutions",
};

/** Top-level fixed maintainer docs the entry tools must never write. */
const REFUSED_TOPICS = new Set([
    "rules", "codex-rules",
    "guidance", "thought-and-action-guidance", "thinking",
    "markdown", "markdown-guidance",
    "list", "resources", "codex-resource-list",
]);

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function log(msg: string): void {
    console.log(`[aftc-toolset] codex-entries: ${msg}`);
}

function currentYearMonth(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Normalise a topic/category parameter: strip "@", trim, drop trailing .md,
 *  lowercase. */
function cleanName(raw: string): string {
    let s = (raw ?? "").trim();
    if (s.startsWith("@")) s = s.slice(1);
    s = s.trim();
    if (s.toLowerCase().endsWith(".md")) s = s.slice(0, -3);
    return s.toLowerCase();
}

/** Strip wrapper noise a model may add to entry text: leading "- ", backticks,
 *  a hand-made [ID], a "Cause:"/"Fix:" prefix, a trailing (YYYY-MM) date. */
function cleanText(raw: string, opts: { stripCauseFix?: boolean; stripDate?: boolean } = {}): string {
    let s = (raw ?? "").trim();
    // Unwrap iteratively: a model may nest the noise in any order
    // (e.g. "`- [id] text`" needs the leading dash stripped first,
    // THEN the backticks, THEN the [id]), so a single pass is not
    // enough. The loop short-circuits on stability (no change in
    // a pass) and is capped at 3 iterations as a defensive bound;
    // in practice 1-2 passes suffice for any noise a single model
    // output can produce.
    for (let i = 0; i < 3; i++) {
        const before = s;
        if (s.startsWith("- ")) s = s.slice(2).trim();
        if (s.startsWith("`")) s = s.slice(1);
        if (s.endsWith("`") && s.length > 1) s = s.slice(0, -1);
        const idMatch = /^\[([a-zA-Z0-9]{6})\]\s?/.exec(s);
        if (idMatch) s = s.slice(idMatch[0].length).trim();
        if (s === before) break;
    }
    if (opts.stripCauseFix) s = s.replace(/^(Cause|Fix):\s*/i, "");
    if (opts.stripDate) s = s.replace(/\s*\(\d{4}-\d{2}\)\.?\s*$/, "");
    return s.trim();
}

/** Whitespace/case-insensitive normal form for the duplicate backstop. */
function normalizeForDup(s: string): string {
    return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function generateId(existing: Set<string>): string {
    // 6 chars from a 64-char base64url alphabet (a-zA-Z0-9-_) — the
    // namespace is bigger than the old 62-char alphanumeric and the
    // source is `crypto.randomBytes`, not `Math.random()`. The
    // collision check stays in case the existing-id set is huge.
    let id = "";
    do {
        const bytes = randomBytes(ID_LENGTH);
        id = "";
        for (let i = 0; i < ID_LENGTH; i++) {
            id += ID_CHARS[bytes[i]! % ID_CHARS.length];
        }
    } while (existing.has(id));
    return id;
}

/** Atomic write: tmp file + rename (a crash must never leave a half-written file). */
function atomicWrite(absPath: string, content: string): void {
    const tmp = `${absPath}.tmp`;
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, absPath);
}

interface ParsedEntry {
    id: string;
    /** Index of the "- [id] ..." line. */
    start: number;
    /** Index one past the last line of the entry (continuation lines included). */
    end: number;
    lead: string;
    cause?: string;
    fix?: string;
    /** Section heading the entry currently sits under ("" when legacy/unknown). */
    section: string;
}

/** Locate an entry by ID. Null when absent. */
function findEntry(lines: string[], id: string): ParsedEntry | null {
    let currentSection = "";
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("## ")) { currentSection = line.trim(); continue; }
        const m = ENTRY_ID_RE.exec(line);
        if (!m || m[1] !== id) continue;
        let end = i + 1;
        while (end < lines.length && CONTINUATION_RE.test(lines[end])) end++;
        const parsed: ParsedEntry = {
            id,
            start: i,
            end,
            lead: cleanText(line),
            section: currentSection,
        };
        for (let j = i + 1; j < end; j++) {
            const cm = /^\s+Cause:\s?(.*)$/.exec(lines[j]);
            if (cm) { parsed.cause = cm[1].trim(); continue; }
            const fm = /^\s+Fix:\s?(.*)$/.exec(lines[j]);
            if (fm) parsed.fix = cleanText(fm[1], { stripDate: true });
        }
        return parsed;
    }
    return null;
}

/** Collect every [ID] already used in the file. */
function collectIds(lines: string[]): Set<string> {
    const ids = new Set<string>();
    for (const line of lines) {
        if (!ENTRY_START_RE.test(line)) continue;
        const m = ENTRY_ID_RE.exec(line);
        if (m) ids.add(m[1]);
    }
    return ids;
}

/** Every entry lead line (ID stripped) for the duplicate backstop. */
function collectLeads(lines: string[]): Array<{ id: string | null; norm: string }> {
    const leads: Array<{ id: string | null; norm: string }> = [];
    for (const line of lines) {
        if (!ENTRY_START_RE.test(line)) continue;
        const m = ENTRY_ID_RE.exec(line);
        leads.push({ id: m ? m[1] : null, norm: normalizeForDup(cleanText(line)) });
    }
    return leads;
}

/** Insert entry lines at the END of a canonical section. Appends the section
 *  heading at EOF when it is missing (legacy file tolerance). */
function insertIntoSection(lines: string[], heading: string, entryLines: string[]): string[] {
    let h = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === heading) { h = i; break; }
    }
    if (h === -1) {
        const out = [...lines];
        while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
        out.push("", heading, "", ...entryLines, "");
        return out;
    }
    let e = lines.length;
    for (let i = h + 1; i < lines.length; i++) {
        if (lines[i].startsWith("## ")) { e = i; break; }
    }
    let insertAt = e;
    while (insertAt - 1 > h && lines[insertAt - 1].trim() === "") insertAt--;
    const before = lines.slice(0, insertAt);
    const after = lines.slice(insertAt);
    if (before.length > 0 && before[before.length - 1].trim() !== "") before.push("");
    const out = [...before, ...entryLines];
    if (after.length > 0 && after[0].trim() !== "") out.push("");
    out.push(...after);
    return out;
}

/** Format the canonical lines for one entry (ID already generated). */
function formatEntryLines(kind: EntryKind, id: string, text: string, cause: string | undefined, fix: string | undefined): string[] {
    if (kind === "issue") {
        return [
            `- [${id}] ${text}`,
            `  Cause: ${cause}`,
            `  Fix: ${fix} (${currentYearMonth()})`,
        ];
    }
    return [`- [${id}] ${text}`];
}

/** Validate one entry input. Throws with a labelled reason on any problem. */
function validateEntryInput(label: string, kind: EntryKind, text: string, cause: string | undefined, fix: string | undefined): void {
    if (!text) throw new Error(`${label}: text is required.`);
    if (text.includes("\n")) throw new Error(`${label}: text must be a single line.`);
    if (kind === "issue") {
        if (!cause) throw new Error(`${label}: cause is required for kind "issue".`);
        if (!fix) throw new Error(`${label}: fix is required for kind "issue".`);
        if (cause.includes("\n") || fix.includes("\n")) {
            throw new Error(`${label}: cause and fix must be single lines.`);
        }
    } else {
        if (cause || fix) throw new Error(`${label}: cause/fix are only valid for kind "issue".`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generality guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Placeholder markers that make a path/URL generic documentation shorthand
 * instead of a real machine location ("/path/to/x", "C:\\Users\\me\\...",
 * "https://example.com/", "http://localhost:3000", "https://cdn...@<ver>/").
 */
const GENERIC_PLACEHOLDERS = [
    "path/to", "/me/", "\\me\\", "example.", "localhost", "127.0.0.", "...", "<", "program files",
];

/** Real-looking absolute machine path: drive-letter or user-home with a name. */
const ABS_PATH_RE = /[A-Za-z]:[\\\/]\S+|\/(?:home|Users)\/\S+/;
const URL_RE = /https?:\/\/\S+/i;

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Secret-leak patterns. Assignment form requires a CONCRETE-looking value
 * (>= 6 chars, no placeholder chars) so schema/code examples like
 * `apiKey: credential.key` or `Authorization: Bearer <token>` still pass.
 */
const SECRET_ASSIGN_RE = /(?:password|passwd|secret|api[-_]?key|access[-_]?token|auth[-_]?token|private[-_]?key)\s*[:=]\s*["']?([^\s"']{6,})["']?/i;
const SECRET_VALUE_PLACEHOLDER_RE = /[$<>{}[\]]|\.\.\.|^your[-_]|^x{3,}$|^\*{3,}$|^redacted$/i;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const PRIVATE_KEY_BLOCK_RE = /BEGIN [A-Z ]*PRIVATE KEY/;
const BEARER_LITERAL_RE = /\bBearer\s+(?!\.\.\.)[A-Za-z0-9._~+/=-]{10,}/;

/** Returns a short description of the credential found, or null. */
function findSecret(text: string): string | null {
    if (JWT_RE.test(text)) return "a JWT";
    if (PRIVATE_KEY_BLOCK_RE.test(text)) return "a private key block";
    if (BEARER_LITERAL_RE.test(text)) return "a bearer token";
    const assign = SECRET_ASSIGN_RE.exec(text);
    if (assign && !SECRET_VALUE_PLACEHOLDER_RE.test(assign[1])) return assign[0];
    return null;
}

/**
 * Heuristic project-specificity guard. TRADE-OFF (documented, do not
 * re-litigate): a mechanical check can only catch the OBVIOUS leaks - a real
 * absolute machine path, a real URL, or the current project's directory
 * name. Project-invented VOCABULARY (terms only one project's docs use) is
 * mechanically undetectable; the /aftc-codex-learn prompt's generality
 * check owns that layer. Patterns are tuned so legitimate generic entries
 * still pass: placeholder paths/URLs are allowed (see GENERIC_PLACEHOLDERS),
 * and the project-name check requires a distinctive name (>= 6 chars) and
 * is skipped when it equals the topic (a project folder named "docker"
 * must not block docker lessons about docker).
 *
 * Returns the offending fragment, or null when the text looks general.
 */
function findProjectSpecific(text: string, projectName: string, topicName: string): string | null {
    const absPath = ABS_PATH_RE.exec(text);
    if (absPath && !GENERIC_PLACEHOLDERS.some((m) => absPath[0].toLowerCase().includes(m))) {
        return absPath[0];
    }
    const url = URL_RE.exec(text);
    if (url && !GENERIC_PLACEHOLDERS.some((m) => url[0].toLowerCase().includes(m))) {
        return url[0];
    }
    if (
        projectName.length >= 6 &&
        projectName.toLowerCase() !== topicName.toLowerCase()
    ) {
        const re = new RegExp(`\\b${escapeRegExp(projectName)}\\b`, "i");
        if (re.test(text)) return projectName;
    }
    return null;
}

/**
 * Run the generality guard over every supplied field of one entry. Throws
 * with a labelled, actionable reason on a match.
 */
function guardGeneral(
    label: string,
    fields: Array<string | undefined>,
    projectName: string,
    topicName: string,
): void {
    for (const field of fields) {
        if (!field) continue;
        const secret = findSecret(field);
        if (secret) {
            throw new Error(
                `${label}: appears to contain a credential (${secret}) — codex entries must NEVER ` +
                `contain passwords, API keys, tokens, private keys or any secret, not even as ` +
                `examples. Describe the shape only ("the API key env var"), never a value. Retry.`,
            );
        }
        const hit = findProjectSpecific(field, projectName, topicName);
        if (hit) {
            throw new Error(
                `${label}: looks project-specific ("${hit}") — codex entries must be GLOBAL: ` +
                `no real absolute paths, URLs, or project names/terms. Reword generically ` +
                `(placeholder paths like /path/to/x are fine) or drop the entry, then retry.`,
            );
        }
    }
}

/** New-topic skeleton with the three canonical headings (always present). */
function skeleton(topicName: string): string {
    const title = topicName.charAt(0).toUpperCase() + topicName.slice(1);
    return `# ${title}\n\n## Rules\n\n## Gotchyas\n\n## Issues & Solutions\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createCodexEntries(ctx: CodexContext, readTracker: CodexReadTracker): void {
    const { pi, store } = ctx;

    // ---- session_start: maintain the session-scoped read set ----
    // Fresh session (new | startup) -> nothing has been read. Restore
    // (resume | reload | fork) -> rebuild from the durable read entries so a
    // resumed session keeps its read-before-write allowance.
    pi.on("session_start", async (event, sctx) => {
        try {
            readTracker.sessionReads.clear();
            const reason = event.reason;
            if (reason === "new" || reason === "startup") return;
            const entries = sctx.sessionManager.getEntries() as Array<{
                type?: string;
                customType?: string;
                data?: { relPath?: string };
            }>;
            for (const entry of entries) {
                if (entry.type === "custom" && entry.customType === CODEX_READ_ENTRY && entry.data?.relPath) {
                    readTracker.sessionReads.add(entry.data.relPath);
                }
            }
        } catch (err) {
            log(`session_start read-track error: ${(err as Error).message}`);
        }
    });

    /** Resolve a write target. Throws on refused top-level docs, unknown topics
     *  without a category, invalid names, and nesting deeper than the depth-2
     *  cap. Accepted shapes: "name" (existing topic anywhere — category folder,
     *  nested, or a root-level loose topic like documentation-and-planning),
     *  "category/name", "category/sub/name" (nested; the category must already
     *  exist), and a NEW bare "name" with the category param ("category" or
     *  "category/sub"). New ROOT-LEVEL topics are never created by the tools —
     *  the resources root is reserved (spec D5/D24). */
    function resolveTarget(topicRaw: string, categoryRaw?: string): {
        absPath: string;
        relPath: string;
        exists: boolean;
        newCategory: boolean;
    } {
        const topic = cleanName(topicRaw);
        if (!topic) throw new Error("topic is required.");
        const resourcesDir = store.getResourcesDir();
        const fileExists = (absPath: string): boolean => {
            try { return fs.statSync(absPath).isFile(); } catch { return false; }
        };
        const dirExists = (absPath: string): boolean => {
            try { return fs.statSync(absPath).isDirectory(); } catch { return false; }
        };

        if (topic.includes("/")) {
            // Explicit path form: "category/name" or "category/sub/name".
            const parts = topic.split("/").filter((p) => p.length > 0);
            if (parts.length < 2 || parts.length > 3) {
                throw new Error(`Invalid topic "${topicRaw}" — use "name", "category/name" or "category/sub/name" (max depth 2).`);
            }
            for (let i = 0; i < parts.length; i++) {
                const p = parts[i]!;
                if (!NAME_RE.test(p)) {
                    const what = i === parts.length - 1 ? "topic name" : i === 0 ? "category" : "topic path segment";
                    throw new Error(`Invalid ${what} "${p}" — lowercase letters, digits, dash/underscore only.`);
                }
            }
            const categoryDir = path.join(resourcesDir, parts[0]!);
            if (parts.length === 3 && !dirExists(categoryDir)) {
                throw new Error(`Unknown category "${parts[0]}" — a nested topic (category/sub/name) needs an existing category folder.`);
            }
            const relPath = `${parts.join("/")}.md`;
            const absPath = path.join(resourcesDir, relPath);
            return { absPath, relPath, exists: fileExists(absPath), newCategory: !dirExists(categoryDir) };
        }

        if (REFUSED_TOPICS.has(topic)) {
            throw new Error(
                `"${topic}" is a fixed top-level maintainer doc — codex entry tools only write ` +
                `resources/ topic files. These docs are never written by the model.`,
            );
        }

        // Existing file anywhere (category folder, nested, or root-level loose)?
        const existing = store.readResource(topic);
        if (existing) {
            return { absPath: existing.absPath, relPath: existing.relPath, exists: true, newCategory: false };
        }

        // New topic: the category param decides the folder ("category" or
        // "category/sub" — never the resources root).
        const category = cleanName(categoryRaw ?? "");
        if (!category) {
            const cats = store.listCategories();
            throw new Error(
                `Unknown codex topic "${topic}". To create it, pass a category ` +
                `(existing: ${cats.length > 0 ? cats.join(", ") : "none yet"} — or a new one).`,
            );
        }
        const catParts = category.split("/").filter((p) => p.length > 0);
        if (catParts.length > 2) {
            throw new Error(`Invalid category "${category}" — max depth 2 ("category" or "category/sub").`);
        }
        for (const p of catParts) {
            if (!NAME_RE.test(p)) {
                throw new Error(`Invalid category "${category}" — lowercase letters, digits, dash/underscore only.`);
            }
        }
        if (!NAME_RE.test(topic)) {
            throw new Error(`Invalid topic name "${topic}" — lowercase letters, digits, dash/underscore only.`);
        }
        const categoryDir = path.join(resourcesDir, catParts[0]!);
        if (catParts.length === 2 && !dirExists(categoryDir)) {
            throw new Error(`Unknown category "${catParts[0]}" — a nested topic needs an existing category folder.`);
        }

        const absPath = path.join(resourcesDir, category, `${topic}.md`);
        const relPath = `${category}/${topic}.md`;
        return { absPath, relPath, exists: fileExists(absPath), newCategory: !dirExists(categoryDir) };
    }

    /** Read-before-write enforcement for EXISTING files. */
    function requireRead(relPath: string, topic: string): void {
        if (readTracker.sessionReads.has(relPath)) return;
        throw new Error(
            `Stale-content guard: codex_load("${topic}") this session before modifying ${relPath} ` +
            `(read it, check your entry is not already there, then retry).`,
        );
    }

    /** Load an existing target's lines, enforcing the read guard. */
    function readExistingLines(target: { absPath: string; relPath: string }, topic: string): string[] {
        requireRead(target.relPath, topic);
        let content: string;
        try {
            content = fs.readFileSync(target.absPath, "utf8");
        } catch (err) {
            throw new Error(`Could not read ${target.relPath}: ${(err as Error).message}`);
        }
        return content.split(/\r?\n/);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // codex_add_entry
    // ─────────────────────────────────────────────────────────────────────────

    interface AddEntryInput {
        kind: EntryKind;
        text: string;
        cause?: string;
        fix?: string;
    }

    pi.registerTool({
        name: "codex_add_entry",
        label: "Codex Add Entry",
        description:
            "Add one or more entries to an aftc-codex resource file (batched in one call). " +
            "The tool generates the 6-char [ID], validates the per-kind format (rule/gotcha = " +
            "one line; issue = symptom + cause + fix, date auto-appended), inserts under the " +
            "correct canonical section (## Rules / ## Gotchyas / ## Issues & Solutions), and " +
            "creates the topic file (three-heading skeleton) and category folder when missing " +
            "(regenerating the resource list internally). Entries must be GLOBAL and safe: " +
            "project-specific content (real paths, URLs, project names) and credentials are " +
            "rejected. The target topic must have been read with codex_load this session first " +
            "(stale-content guard).",
        promptSnippet: "Add entries to an aftc-codex resource (IDs, format validation, section placement and list sync handled for you)",
        promptGuidelines: [
            "Use codex_add_entry to record a new codex lesson (never hand-edit resource files): codex_load the topic first, then call codex_add_entry with kind rule/gotcha/issue.",
            "Use codex_add_entry with a batch of entries when several lessons go to the same topic — one call writes them all.",
            "Use codex_add_entry with topic \"category/name\" (or the category param) to create a new topic file; a new category folder is created when the lesson fits no existing category.",
            "codex_add_entry rejects project-specific content (real absolute paths, URLs, the current project's name) and anything that looks like a credential — write entries generically and never include secrets.",
        ],
        parameters: Type.Object({
            topic: Type.String({
                description: "Target topic: \"typescript\", \"tools/pi-extension\" or \"ui-ux/web/web-app\" (nested). New topics need the category here or in the category param.",
            }),
            category: Type.Optional(Type.String({
                description: "Category folder for a NEW topic (existing eg languages/tools/ui-ux, or a new one; \"category/sub\" for a nested topic under an existing category). Ignored when topic includes one.",
            })),
            entries: Type.Array(Type.Object({
                kind: StringEnum(["rule", "gotcha", "issue"] as const, {
                    description: "rule/gotcha = one line in text; issue = symptom in text plus cause and fix.",
                }),
                text: Type.String({
                    description: "The entry text WITHOUT the [ID] (the tool generates it). rule: the directive. gotcha: trap + countermeasure. issue: the one-line symptom/lead.",
                }),
                cause: Type.Optional(Type.String({ description: "issue only: why it happens (no \"Cause:\" prefix)." })),
                fix: Type.Optional(Type.String({ description: "issue only: what to do (no \"Fix:\" prefix, no date — the tool appends the current YYYY-MM)." })),
            }), { minItems: 1 }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ectx) {
            const target = resolveTarget(params.topic, params.category);
            if (target.exists) requireRead(target.relPath, params.topic);
            // Generality guard context: the current project's dir name (for the
            // project-name check) and the topic name (for the topic exception).
            const projectName = path.basename((ectx?.cwd ?? "").replace(/[\\\/]+$/, "")) || "";
            const topicName = target.relPath.split("/").pop()?.replace(/\.md$/, "") ?? "";

            return withFileMutationQueue(target.absPath, async () => {
                let lines: string[];
                if (target.exists) {
                    lines = readExistingLines(target, params.topic);
                } else {
                    lines = skeleton(target.relPath.split("/").pop()!.slice(0, -3)).split("\n");
                }

                const ids = collectIds(lines);
                const leads = collectLeads(lines);
                const written: Array<{ id: string; kind: EntryKind; text: string }> = [];

                // Validate ALL entries first — one bad entry fails the whole call
                // before anything is written (single write per call).
                const prepared: Array<{ kind: EntryKind; text: string; cause?: string; fix?: string }> = [];
                for (let i = 0; i < params.entries.length; i++) {
                    const raw = params.entries[i] as AddEntryInput;
                    const label = `entries[${i}]`;
                    const kind = raw.kind;
                    if (!SECTION_HEADINGS[kind]) throw new Error(`${label}: kind must be rule, gotcha or issue.`);
                    const text = cleanText(raw.text);
                    const cause = raw.cause !== undefined ? cleanText(raw.cause, { stripCauseFix: true }) : undefined;
                    const fix = raw.fix !== undefined ? cleanText(raw.fix, { stripCauseFix: true, stripDate: true }) : undefined;
                    validateEntryInput(label, kind, text, cause, fix);
                    guardGeneral(label, [text, cause, fix], projectName, topicName);
                    const norm = normalizeForDup(text);
                    const dup = leads.find((l) => l.norm === norm);
                    if (dup) {
                        throw new Error(
                            `${label}: duplicate — an identical entry already exists in ${target.relPath}` +
                            `${dup.id ? ` as [${dup.id}]` : ""}. Use codex_edit_entry to change it.`,
                        );
                    }
                    leads.push({ id: null, norm }); // catch duplicates within the batch too
                    prepared.push({ kind, text, cause, fix });
                }

                for (const p of prepared) {
                    const id = generateId(ids);
                    ids.add(id);
                    const entryLines = formatEntryLines(p.kind, id, p.text, p.cause, p.fix);
                    lines = insertIntoSection(lines, SECTION_HEADINGS[p.kind], entryLines);
                    written.push({ id, kind: p.kind, text: p.text });
                }

                try {
                    if (!target.exists) fs.mkdirSync(path.dirname(target.absPath), { recursive: true });
                    atomicWrite(target.absPath, lines.join("\n"));
                } catch (err) {
                    throw new Error(`Write failed for ${target.relPath}: ${(err as Error).message}`);
                }

                // New topic FILE -> the resource list (paths + first headings) must
                // regenerate. Entry-only writes never change the list.
                let synced = false;
                if (!target.exists) {
                    await store.runSyncScript();
                    synced = true;
                }

                const linesOut = written.map((w) => `- [${w.id}] (${w.kind}) ${w.text}`);
                const notes: string[] = [];
                if (!target.exists) notes.push(`created new topic file ${target.relPath} with the three-section skeleton`);
                if (target.newCategory) notes.push(`created NEW category folder "${target.relPath.split("/")[0]}" (previously unseen — if this was a typo, move the file)`);
                if (synced) notes.push("resource list regenerated");

                return {
                    content: [{
                        type: "text",
                        text: `Added ${written.length} entr${written.length === 1 ? "y" : "ies"} to ${target.relPath}:\n${linesOut.join("\n")}` +
                            (notes.length > 0 ? `\n(${notes.join("; ")})` : ""),
                    }],
                    details: { relPath: target.relPath, ids: written.map((w) => w.id), created: !target.exists, newCategory: target.newCategory },
                };
            });
        },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // codex_edit_entry
    // ─────────────────────────────────────────────────────────────────────────

    pi.registerTool({
        name: "codex_edit_entry",
        label: "Codex Edit Entry",
        description:
            "Edit one aftc-codex resource entry by its 6-char [ID]. Replaces the entry's " +
            "content in place (keeping the ID), re-validates the per-kind format, refreshes an " +
            "issue's date to current, and moves the entry to a different canonical section when " +
            "kind changes. Unsupplied fields keep their existing values. The topic must have " +
            "been read with codex_load this session first (stale-content guard).",
        promptSnippet: "Edit one aftc-codex resource entry by its [ID] (format re-validated, section move on kind change)",
        promptGuidelines: [
            "Use codex_edit_entry to correct or amend an existing codex entry by its [ID] (never hand-edit resource files); supply only the fields that change.",
            "Use codex_edit_entry with a different kind to reclassify an entry — the tool moves it to the matching section.",
        ],
        parameters: Type.Object({
            topic: Type.String({ description: "Target topic: \"typescript\" or \"tools/pi-extension\" (must exist)." }),
            id: Type.String({ description: "The entry's 6-char [ID] (with or without brackets)." }),
            kind: Type.Optional(StringEnum(["rule", "gotcha", "issue"] as const, {
                description: "New kind — moves the entry to that section. Omit to keep the current kind.",
            })),
            text: Type.Optional(Type.String({ description: "New lead text (without the [ID]). Omit to keep the current lead." })),
            cause: Type.Optional(Type.String({ description: "issue only: new Cause text. Omit to keep the current one." })),
            fix: Type.Optional(Type.String({ description: "issue only: new Fix text (no date — refreshed to current). Omit to keep the current one." })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ectx) {
            const target = resolveTarget(params.topic);
            if (!target.exists) {
                throw new Error(`Unknown codex topic "${params.topic}" — codex_edit_entry only edits existing files.`);
            }
            const projectName = path.basename((ectx?.cwd ?? "").replace(/[\\\/]+$/, "")) || "";
            const topicName = target.relPath.split("/").pop()?.replace(/\.md$/, "") ?? "";
            const id = (params.id ?? "").trim().replace(/^\[|\]$/g, "");
            if (!/^[a-zA-Z0-9]{6}$/.test(id)) {
                throw new Error(`Invalid id "${params.id}" — a 6-char alphanumeric token (as shown in the entry's [ID]).`);
            }

            return withFileMutationQueue(target.absPath, async () => {
                let lines = readExistingLines(target, params.topic);
                const existing = findEntry(lines, id);
                if (!existing) {
                    const known = [...collectIds(lines)].join(", ");
                    throw new Error(`No entry [${id}] in ${target.relPath}. IDs present: ${known || "none"}.`);
                }

                const currentKind = (Object.keys(SECTION_HEADINGS) as EntryKind[])
                    .find((k) => SECTION_HEADINGS[k] === existing.section);
                const kind: EntryKind = params.kind ?? currentKind ?? "issue";
                if (params.kind && !SECTION_HEADINGS[params.kind]) {
                    throw new Error(`kind must be rule, gotcha or issue.`);
                }

                const text = params.text !== undefined ? cleanText(params.text) : existing.lead;
                let cause = params.cause !== undefined ? cleanText(params.cause, { stripCauseFix: true }) : existing.cause;
                let fix = params.fix !== undefined ? cleanText(params.fix, { stripCauseFix: true, stripDate: true }) : existing.fix;
                if (kind !== "issue") { cause = undefined; fix = undefined; }
                validateEntryInput(`entry [${id}]`, kind, text, cause, fix);
                guardGeneral(`entry [${id}]`, [text, cause, fix], projectName, topicName);

                const entryLines = formatEntryLines(kind, id, text, cause, fix);
                const moving = SECTION_HEADINGS[kind] !== existing.section;

                // Remove the old lines, then insert (in place when the index still
                // points inside the same section, section-append when moving).
                lines = [...lines.slice(0, existing.start), ...lines.slice(existing.end)];
                if (moving) {
                    lines = insertIntoSection(lines, SECTION_HEADINGS[kind], entryLines);
                } else {
                    lines = [...lines.slice(0, existing.start), ...entryLines, ...lines.slice(existing.start)];
                }

                try {
                    atomicWrite(target.absPath, lines.join("\n"));
                } catch (err) {
                    throw new Error(`Write failed for ${target.relPath}: ${(err as Error).message}`);
                }

                return {
                    content: [{
                        type: "text",
                        text: `Updated entry [${id}] in ${target.relPath}` +
                            (moving ? ` (moved to ${SECTION_HEADINGS[kind]})` : "") +
                            `:\n${entryLines.join("\n")}`,
                    }],
                    details: { relPath: target.relPath, id, kind, moved: moving },
                };
            });
        },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // codex_remove_entry
    // ─────────────────────────────────────────────────────────────────────────

    pi.registerTool({
        name: "codex_remove_entry",
        label: "Codex Remove Entry",
        description:
            "Remove one aftc-codex resource entry by its 6-char [ID] (all of its lines, " +
            "including an issue's Cause:/Fix: lines). Use for stale or wrong entries. The " +
            "topic must have been read with codex_load this session first (stale-content guard).",
        promptSnippet: "Remove one aftc-codex resource entry by its [ID]",
        promptGuidelines: [
            "Use codex_remove_entry to delete a stale or wrong codex entry by its [ID], and state in your reply what was removed and why.",
        ],
        parameters: Type.Object({
            topic: Type.String({ description: "Target topic: \"typescript\" or \"tools/pi-extension\" (must exist)." }),
            id: Type.String({ description: "The entry's 6-char [ID] (with or without brackets)." }),
        }),
        async execute(_toolCallId, params) {
            const target = resolveTarget(params.topic);
            if (!target.exists) {
                throw new Error(`Unknown codex topic "${params.topic}" — codex_remove_entry only works on existing files.`);
            }
            const id = (params.id ?? "").trim().replace(/^\[|\]$/g, "");
            if (!/^[a-zA-Z0-9]{6}$/.test(id)) {
                throw new Error(`Invalid id "${params.id}" — a 6-char alphanumeric token (as shown in the entry's [ID]).`);
            }

            return withFileMutationQueue(target.absPath, async () => {
                let lines = readExistingLines(target, params.topic);
                const existing = findEntry(lines, id);
                if (!existing) {
                    const known = [...collectIds(lines)].join(", ");
                    throw new Error(`No entry [${id}] in ${target.relPath}. IDs present: ${known || "none"}.`);
                }

                const removedLines = lines.slice(existing.start, existing.end);
                lines = [...lines.slice(0, existing.start), ...lines.slice(existing.end)];

                try {
                    atomicWrite(target.absPath, lines.join("\n"));
                } catch (err) {
                    throw new Error(`Write failed for ${target.relPath}: ${(err as Error).message}`);
                }

                return {
                    content: [{
                        type: "text",
                        text: `Removed entry [${id}] from ${target.relPath} (${removedLines.length} line${removedLines.length === 1 ? "" : "s"}):\n${removedLines.join("\n")}`,
                    }],
                    details: { relPath: target.relPath, id, removedLines: removedLines.length },
                };
            });
        },
    });

    aftcConsole.log("codex-entries: loaded — codex entry tools (add/edit/remove)");
}

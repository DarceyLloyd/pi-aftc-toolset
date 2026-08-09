/**
 * pi-aftc-toolset / aftc-codex — structural resource-layout migration (spec D18).
 *
 * Moves the live resources tree from the LEGACY layout to the v1 layout
 * (plan.md section 4.1), PRESERVING learned entries:
 *
 *   design/design-common.md            -> ui-ux/ui-ux-common.md   (rename)
 *   design/web-app|web-page|web-backend.md      -> ui-ux/web/
 *   design/desktop-app|desktop-web-app.md       -> ui-ux/desktop/
 *   design/mobile-app.md               -> ui-ux/mobile/
 *   design/vst-plugin.md               -> ui-ux/plugin/
 *   design/documentation-generation.md + design/planning.md
 *                                      -> documentation-and-planning.md (root, merged)
 *   design/path-classification.md      -> languages/languages-common.md (merged)
 *   python.md entries [EHm7AF, D3eoMz, dx18VQ] -> languages/languages-common.md
 *   tools/mysql.md                     -> database/mysql.md
 *   tools/apache|nginx|vsftpd|docker.md -> servers-and-containers/
 *
 * Contract (LOCKED):
 *   - Runs from the codex startup path (first session_start), BEFORE any seed
 *     sync / removal-list application, NEVER in the factory.
 *   - IDEMPOTENT + RESUMABLE: every move/merge is a no-op when already done,
 *     so a crash mid-migration is completed by the next run. The version is
 *     stamped ONLY on full completion.
 *   - Merge semantics (append by [ID]): an incoming entry whose ID is absent
 *     from the target is appended at the end of its section; same ID + same
 *     text is skipped; same ID + different text keeps BOTH - the incoming
 *     entry is appended with a freshly generated ID (no user text is ever
 *     dropped, no duplicate IDs in one file).
 *   - Fail-soft per step: one failed move never aborts the rest; any failure
 *     means the version is NOT stamped (the next run retries).
 *
 * Pure data module (no pi imports). See `codex-migrate-readme.md`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { getPreference, setPreference } from "../config";
import type { CodexStore } from "./codex-store";
import * as aftcConsole from "../ui/aftc-console";

/** The current structural layout version. v1 = the plan.md section 4 tree. */
export const CODEX_RESOURCE_VERSION = 1;

/** The three cross-language entries that leave python.md for
 *  languages-common.md (kv9k6Y stays - it names a Python-specific method). */
const PYTHON_ENTRY_IDS_TO_MOVE = ["EHm7AF", "D3eoMz", "dx18VQ"];

/** Whole-file moves/merges: [fromRel, toRel][] (forward slashes, relative to
 *  resources/). */
const FILE_MOVES: Array<[string, string]> = [
    ["design/design-common.md", "ui-ux/ui-ux-common.md"],
    ["design/web-app.md", "ui-ux/web/web-app.md"],
    ["design/web-page.md", "ui-ux/web/web-page.md"],
    ["design/web-backend.md", "ui-ux/web/web-backend.md"],
    ["design/desktop-app.md", "ui-ux/desktop/desktop-app.md"],
    ["design/desktop-web-app.md", "ui-ux/desktop/desktop-web-app.md"],
    ["design/mobile-app.md", "ui-ux/mobile/mobile-app.md"],
    ["design/vst-plugin.md", "ui-ux/plugin/vst-plugin.md"],
    ["design/documentation-generation.md", "documentation-and-planning.md"],
    ["design/planning.md", "documentation-and-planning.md"],
    ["design/path-classification.md", "languages/languages-common.md"],
    ["tools/mysql.md", "database/mysql.md"],
    ["tools/apache.md", "servers-and-containers/apache.md"],
    ["tools/nginx.md", "servers-and-containers/nginx.md"],
    ["tools/vsftpd.md", "servers-and-containers/vsftpd.md"],
    ["tools/docker.md", "servers-and-containers/docker.md"],
];

export interface CodexMigrationResult {
    /** false when the live copy was already at the current version. */
    ran: boolean;
    /** Human-readable report lines (one per move/merge performed). */
    moves: string[];
    /** false when any step failed (version NOT stamped; next run retries). */
    ok: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry parsing (self-contained; mirrors the sync scripts' parse)
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedEntry {
    id: string | null;
    /** Section heading the entry sits under ("" when none seen). */
    heading: string;
    /** The entry's lines (lead + continuation, trailing blanks stripped). */
    block: string[];
}

const ENTRY_ID_RE = /^- `?\[([a-zA-Z0-9]{6})\]\s?/;
const ENTRY_START_RE = /^- \S/;
const SECTION_RE = /^## /;

function parseEntries(text: string): ParsedEntry[] {
    const entries: ParsedEntry[] = [];
    let heading = "";
    let current: ParsedEntry | null = null;
    for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
        if (SECTION_RE.test(line)) {
            heading = line.trim();
            current = null;
            continue;
        }
        if (ENTRY_START_RE.test(line)) {
            current = { id: ENTRY_ID_RE.exec(line)?.[1] ?? null, heading, block: [line.trimEnd()] };
            entries.push(current);
            continue;
        }
        if (current && (line.startsWith("  ") || line.trim() === "")) {
            current.block.push(line.trimEnd());
            continue;
        }
        current = null;
    }
    for (const e of entries) {
        while (e.block.length > 1 && e.block[e.block.length - 1]!.trim() === "") e.block.pop();
    }
    return entries;
}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateId(existing: Set<string>): string {
    let id = "";
    do {
        const bytes = randomBytes(6);
        id = "";
        for (let i = 0; i < 6; i++) id += ID_CHARS[bytes[i]! % ID_CHARS.length];
    } while (existing.has(id));
    return id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Append entry blocks at the END of their sections in a target text.
 *  Collision rule: same ID + same text -> skipped; same ID + different text ->
 *  appended with a fresh ID (both kept). A missing section heading is appended
 *  at EOF (legacy tolerance). Returns the new text + what happened. */
function mergeEntriesInto(targetText: string, incoming: ParsedEntry[]): { text: string; added: number; skipped: number } {
    const targetEntries = parseEntries(targetText);
    const byId = new Map<string, string>();
    for (const e of targetEntries) {
        if (e.id) byId.set(e.id, e.block.join("\n"));
    }
    const idsInUse = new Set(byId.keys());

    let lines = targetText.replace(/\r\n/g, "\n").split("\n");
    // Drop trailing blank lines for clean appends.
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();

    let added = 0;
    let skipped = 0;
    for (const entry of incoming) {
        const text = entry.block.join("\n");
        if (entry.id && byId.has(entry.id)) {
            if (byId.get(entry.id) === text) { skipped++; continue; }
            // Same ID, different text: keep both - the incoming entry gets a
            // fresh ID (never drop user text, never duplicate an ID).
            const newId = generateId(idsInUse);
            idsInUse.add(newId);
            entry.block[0] = entry.block[0]!.replace(ENTRY_ID_RE, `- [${newId}] `);
        }
        if (entry.id) idsInUse.add(entry.id);

        const heading = entry.heading || "## Rules";
        let h = lines.findIndex((l) => l.trim() === heading);
        if (h === -1) {
            lines.push("", heading);
            h = lines.length - 1;
        }
        // Section end = next heading or EOF.
        let e = lines.length;
        for (let i = h + 1; i < lines.length; i++) {
            if (SECTION_RE.test(lines[i]!)) { e = i; break; }
        }
        let insertAt = e;
        while (insertAt - 1 > h && lines[insertAt - 1]!.trim() === "") insertAt--;
        const block = [...entry.block];
        const before = lines.slice(0, insertAt);
        const after = lines.slice(insertAt);
        if (before.length > 0 && before[before.length - 1]!.trim() !== "") before.push("");
        lines = [...before, ...block, "", ...after];
        added++;
    }

    let text = lines.join("\n");
    // Collapse 3+ consecutive blank lines, keep a single trailing newline.
    text = text.replace(/\n{3,}/g, "\n\n");
    if (!text.endsWith("\n")) text += "\n";
    return { text, added, skipped };
}

/** All *.md files under a dir, RECURSIVE, as forward-slash paths relative to
 *  `base` (files directly in the dir first, then sub-folders sorted). */
function listMarkdownRecursive(dir: string, base: string): string[] {
    const out: string[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    const sorted = entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of sorted) {
        if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
            out.push(path.relative(base, path.join(dir, e.name)).replace(/\\/g, "/"));
        }
    }
    for (const e of sorted) {
        if (e.isDirectory()) out.push(...listMarkdownRecursive(path.join(dir, e.name), base));
    }
    return out;
}

/** A new topic skeleton (three canonical sections) for merge targets that do
 *  not exist yet. Title from the basename. */
function skeletonFor(relPath: string): string {
    const base = relPath.split("/").pop()!.replace(/\.md$/, "");
    const title = base.charAt(0).toUpperCase() + base.slice(1);
    return `# ${title}\n\n## Rules\n\n## Gotchyas\n\n## Issues & Solutions\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the legacy -> v1 structural migration on the LIVE copy. Idempotent and
 * fail-soft; stamps aftcCodexResourceVersion ONLY when every step succeeded.
 */
export function runCodexResourceMigration(store: CodexStore): CodexMigrationResult {
    const result: CodexMigrationResult = { ran: false, moves: [], ok: true };
    try {
        const current = getPreference("aftcCodexResourceVersion", 0) ?? 0;
        if (current >= CODEX_RESOURCE_VERSION) return result;
        if (!store.isSeeded()) return result; // nothing to migrate; a fresh seed IS v1

        result.ran = true;
        const resourcesDir = store.getResourcesDir();

        // ---- 1. whole-file moves/merges ----
        for (const [fromRel, toRel] of FILE_MOVES) {
            const fromAbs = path.join(resourcesDir, fromRel);
            const toAbs = path.join(resourcesDir, toRel);
            try {
                if (!fs.existsSync(fromAbs)) continue; // already moved / never existed
                if (!fs.existsSync(toAbs)) {
                    fs.mkdirSync(path.dirname(toAbs), { recursive: true });
                    fs.renameSync(fromAbs, toAbs);
                    result.moves.push(`moved ${fromRel} -> ${toRel}`);
                    continue;
                }
                // Both exist: merge entries by [ID], then remove the old file.
                const fromText = fs.readFileSync(fromAbs, "utf8");
                const toText = fs.readFileSync(toAbs, "utf8");
                const merged = mergeEntriesInto(toText, parseEntries(fromText));
                if (merged.added > 0) {
                    atomicWrite(toAbs, merged.text);
                    result.moves.push(`merged ${fromRel} into ${toRel} (+${merged.added} entries, ${merged.skipped} already there)`);
                }
                fs.unlinkSync(fromAbs);
                if (merged.added === 0) result.moves.push(`removed ${fromRel} (all entries already in ${toRel})`);
            } catch (err) {
                result.ok = false;
                aftcConsole.logError(`[aftc-toolset] codex migration: move ${fromRel} failed: ${(err as Error).message}`);
            }
        }

            // ---- 1b. legacy-only category sweep (design/ -> ui-ux/) ----
        // Live-only file evaluation: any topic file the move map did not know
        // about - a USER-CREATED topic (eg design/user-notes.md or
        // design/sub/thing.md) or a variant a published seed never matched -
        // would orphan in the legacy design/ folder, which does not exist in
        // the v1 layout. Relocate it into ui-ux/ (its v1 home) preserving the
        // relative path (flat -> ui-ux/<name>.md, nested -> ui-ux/<sub>/<name>.md;
        // a <sub> that IS a platform name lands in that platform folder).
        // Merge by [ID] when the target already exists; never delete user
        // content. Runs before the prune so design/ empties and is removed.
        try {
            const designDir = path.join(resourcesDir, "design");
            for (const rel of listMarkdownRecursive(designDir, designDir)) {
                const fromAbs = path.join(designDir, rel);
                const toRel = `ui-ux/${rel}`;
                const toAbs = path.join(resourcesDir, toRel);
                try {
                    if (!fs.existsSync(toAbs)) {
                        fs.mkdirSync(path.dirname(toAbs), { recursive: true });
                        fs.renameSync(fromAbs, toAbs);
                        result.moves.push(`relocated design/${rel} -> ${toRel} (live-only topic)`);
                        continue;
                    }
                    // Both exist: merge entries by [ID], then remove the old file.
                    const fromText = fs.readFileSync(fromAbs, "utf8");
                    const toText = fs.readFileSync(toAbs, "utf8");
                    const merged = mergeEntriesInto(toText, parseEntries(fromText));
                    if (merged.added > 0) {
                        atomicWrite(toAbs, merged.text);
                        result.moves.push(`merged design/${rel} into ${toRel} (+${merged.added} entries, ${merged.skipped} already there)`);
                    }
                    fs.unlinkSync(fromAbs);
                    if (merged.added === 0) result.moves.push(`removed design/${rel} (all entries already in ${toRel})`);
                } catch (err) {
                    result.ok = false;
                    aftcConsole.logError(`[aftc-toolset] codex migration: relocate design/${rel} failed: ${(err as Error).message}`);
                }
            }
        } catch { /* fail-soft: no design/ dir (already v1) */ }

        // ---- 2. entry-level moves (python.md -> languages-common.md) ----
        try {
            const pythonAbs = path.join(resourcesDir, "languages", "python.md");
            if (fs.existsSync(pythonAbs)) {
                const pythonText = fs.readFileSync(pythonAbs, "utf8");
                const entries = parseEntries(pythonText);
                const toMove = entries.filter((e) => e.id !== null && PYTHON_ENTRY_IDS_TO_MOVE.includes(e.id));
                if (toMove.length > 0) {
                    const commonAbs = path.join(resourcesDir, "languages", "languages-common.md");
                    const commonText = fs.existsSync(commonAbs)
                        ? fs.readFileSync(commonAbs, "utf8")
                        : skeletonFor("languages/languages-common.md");
                    const merged = mergeEntriesInto(commonText, toMove);
                    if (merged.added > 0) {
                        fs.mkdirSync(path.dirname(commonAbs), { recursive: true });
                        atomicWrite(commonAbs, merged.text);
                    }
                    // Remove the moved entries from python.md. Runs whenever
                    // they were FOUND (not only when appended): an entry that
                    // crashed mid-move on a previous run is already in the
                    // common file (merge skipped it), and removing it here is
                    // what makes the entry move idempotent.
                    const movedIds = new Set(toMove.map((e) => e.id));
                    const remaining: string[] = [];
                    let skipping = false;
                    for (const line of pythonText.replace(/\r\n/g, "\n").split("\n")) {
                        if (ENTRY_START_RE.test(line)) {
                            const id = ENTRY_ID_RE.exec(line)?.[1] ?? null;
                            skipping = id !== null && movedIds.has(id);
                        }
                        if (skipping) continue;
                        if (line.trim() === "" && remaining.length > 0 && remaining[remaining.length - 1]!.trim() === "") continue;
                        remaining.push(line);
                    }
                    atomicWrite(pythonAbs, remaining.join("\n").replace(/\n{3,}/g, "\n\n"));
                    result.moves.push(`moved ${toMove.length} entries from languages/python.md -> languages/languages-common.md`);
                }
            }
        } catch (err) {
            result.ok = false;
            aftcConsole.logError(`[aftc-toolset] codex migration: python.md entry move failed: ${(err as Error).message}`);
        }

        // ---- 3. retitle merged/renamed targets (the H1 travels with the
        // source file; the new home gets its own title) ----
        const RETITLES: Array<[string, string]> = [
            ["documentation-and-planning.md", "Documentation & Planning"],
            ["languages/languages-common.md", "Languages Common (All Languages)"],
            ["ui-ux/ui-ux-common.md", "UI-UX Common (All Domains)"],
        ];
        for (const [rel, title] of RETITLES) {
            try {
                const abs = path.join(resourcesDir, rel);
                if (!fs.existsSync(abs)) continue;
                const text = fs.readFileSync(abs, "utf8");
                const retitled = text.replace(/^# .*$/m, `# ${title}`);
                if (retitled !== text) {
                    atomicWrite(abs, retitled);
                    result.moves.push(`retitled ${rel} -> "${title}"`);
                }
            } catch (err) {
                result.ok = false;
                aftcConsole.logError(`[aftc-toolset] codex migration: retitle ${rel} failed: ${(err as Error).message}`);
            }
        }

        // ---- 4. prune the emptied legacy design/ folder ----
        try {
            pruneIfEmpty(path.join(resourcesDir, "design"));
        } catch { /* fail-soft */ }

        // ---- 5. stamp ONLY on full completion (resumable otherwise) ----
        if (result.ok) {
            setPreference("aftcCodexResourceVersion", CODEX_RESOURCE_VERSION);
        }
    } catch (err) {
        result.ok = false;
        aftcConsole.logError(`[aftc-toolset] codex migration error: ${(err as Error).message}`);
    }
    return result;
}

/** Atomic write: tmp file + rename (a crash must never leave a half-written file). */
function atomicWrite(absPath: string, content: string): void {
    const tmp = `${absPath}.tmp`;
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, absPath);
}

/** Remove a directory tree when it holds no files (empty sub-folders included). */
function pruneIfEmpty(dir: string): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        if (e.isDirectory()) pruneIfEmpty(path.join(dir, e.name));
        else return; // a file remains - not empty
    }
    try { fs.rmdirSync(dir); } catch { /* fail-soft */ }
}

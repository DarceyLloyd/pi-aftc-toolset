/**
 * pi-aftc-toolset / aftc-codex — seed -> live merge (/aftc-codex-sync).
 *
 * Pure data module (no pi imports, no store imports): given the shipped SEED
 * codex dir and the user's LIVE codex dir, bring the live copy up to date with
 * the seed WITHOUT ever destroying the user's own entries. The AI model is
 * never involved — this is deterministic TypeScript.
 *
 * Steps (in order):
 *   1. Live codex dir missing            -> copy the whole seed over, STOP.
 *   2. codex-rules.md missing            -> copy it.
 *   3. markdown-guidance.md missing      -> copy it.
 *   4. thought-and-action-guidance.md    -> copy it.
 *   5. resources/ missing                -> copy the whole seed resources, STOP.
 *   6. Merge pass over the seed resources tree:
 *        - seed .md missing on live side -> copy it (mkdir as needed).
 *        - file exists in both           -> append any seed entry whose [ID]
 *          is absent from the live file; IDs present in both keep the USER'S
 *          version untouched; ID-less legacy seed entries are skipped.
 *        - live-only files/folders       -> never touched.
 *
 * Production-safety: every I/O op is best-effort try/catch; the merge never
 * overwrites or deletes a live file; re-running is a no-op ("already up to
 * date"). See `codex-merge.readme.md` for the full contract.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Top-level guidance files that live at the codex ROOT (not in resources/). */
const TOP_LEVEL_FILES = [
    "codex-rules.md",
    "markdown-guidance.md",
    "thought-and-action-guidance.md",
] as const;

/** A single parsed seed entry: its 6-char ID plus the full raw block. */
interface CodexEntry {
    id: string;
    raw: string;
}

export interface CodexMergeReport {
    /** True when the whole live dir was missing and got a full seed copy (step 1). */
    createdLiveDir: boolean;
    /** True when resources/ was missing and got a full seed copy (step 5). */
    createdResourcesDir: boolean;
    /** Files copied wholesale, paths relative to the live codex dir (fwd slashes). */
    copiedFiles: string[];
    /** Files that gained entries: { file (rel, fwd slashes), ids appended }. */
    merged: Array<{ file: string; ids: string[] }>;
    /** Non-fatal problems encountered (the merge continues past them). */
    errors: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function safeRead(absPath: string): string | null {
    try {
        return fs.readFileSync(absPath, "utf8");
    } catch {
        return null;
    }
}

/** Recursively copy a directory tree (dirs created as needed). Returns the
 *  list of copied file paths relative to srcDir (forward slashes). */
function copyTree(srcDir: string, destDir: string, relPrefix: string, out: string[], errors: string[]): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(srcDir, { withFileTypes: true });
    } catch (err) {
        errors.push(`read ${relPrefix || "."}: ${(err as Error).message}`);
        return;
    }
    for (const entry of entries) {
        const src = path.join(srcDir, entry.name);
        const dest = path.join(destDir, entry.name);
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        try {
            if (entry.isDirectory()) {
                fs.mkdirSync(dest, { recursive: true });
                copyTree(src, dest, rel, out, errors);
            } else if (entry.isFile()) {
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.copyFileSync(src, dest);
                out.push(rel);
            }
        } catch (err) {
            errors.push(`copy ${rel}: ${(err as Error).message}`);
        }
    }
}

/**
 * Parse the [ID]'d entries out of a resource file. An entry starts at a
 * top-level bullet `- [xxxxxx]` and continues through following lines that are
 * blank or indented (the Cause:/Fix: continuation lines), stopping before the
 * first non-blank, non-indented line (the next entry, a heading, etc).
 * Legacy entries without an [ID] are not entries here and are skipped.
 */
function parseEntries(content: string): CodexEntry[] {
    const entries: CodexEntry[] = [];
    const lines = content.split(/\r?\n/);
    let current: { id: string; lines: string[] } | null = null;

    const flush = () => {
        if (!current) return;
        // Trim trailing blank lines off the block.
        while (current.lines.length > 0 && current.lines[current.lines.length - 1].trim() === "") {
            current.lines.pop();
        }
        if (current.lines.length > 0) entries.push({ id: current.id, raw: current.lines.join("\n") });
        current = null;
    };

    for (const line of lines) {
        const startMatch = line.match(/^- \[([A-Za-z0-9]{6})\]/);
        if (startMatch) {
            flush();
            current = { id: startMatch[1], lines: [line] };
            continue;
        }
        if (current && (line.trim() === "" || /^\s/.test(line))) {
            current.lines.push(line);
        } else {
            flush();
        }
    }
    flush();
    return entries;
}

/** Merge seed entries into a live file: append entries whose [ID] is absent.
 *  IDs present anywhere in the live content keep the user's version. Returns
 *  the appended IDs. Never throws. */
function mergeFile(seedFile: string, liveFile: string): { appended: string[]; error?: string } {
    const seedContent = safeRead(seedFile);
    const liveContent = safeRead(liveFile);
    if (seedContent === null) return { appended: [], error: `unreadable seed file ${seedFile}` };
    if (liveContent === null) return { appended: [], error: `unreadable live file ${liveFile}` };

    const missing = parseEntries(seedContent).filter((e) => !liveContent.includes(`[${e.id}]`));
    if (missing.length === 0) return { appended: [] };

    let out = liveContent;
    if (!out.endsWith("\n")) out += "\n";
    out += "\n" + missing.map((e) => e.raw).join("\n\n") + "\n";
    try {
        fs.writeFileSync(liveFile, out, "utf8");
        return { appended: missing.map((e) => e.id) };
    } catch (err) {
        return { appended: [], error: `write ${liveFile}: ${(err as Error).message}` };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Out-of-sync check (drives the fresh-session NOTICE line)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read-only: would mergeCodexSeedIntoLive() change anything? True when a
 * top-level file is missing, resources/ is missing, a seed resource file is
 * missing on the live side, or a seed entry [ID] is absent from the matching
 * live file. Fail-soft: any read problem answers false (never nag on error).
 */
export function codexNeedsSync(seedDir: string, liveDir: string): boolean {
    try {
        if (!fs.existsSync(liveDir)) return true;
        for (const name of TOP_LEVEL_FILES) {
            if (fs.existsSync(path.join(seedDir, name)) && !fs.existsSync(path.join(liveDir, name))) {
                return true;
            }
        }
        const seedResourcesDir = path.join(seedDir, "resources");
        const liveResourcesDir = path.join(liveDir, "resources");
        if (!fs.existsSync(liveResourcesDir)) return true;

        const walk = (srcDir: string, relPrefix: string): boolean => {
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(srcDir, { withFileTypes: true });
            } catch {
                return false; // fail-soft
            }
            for (const entry of entries) {
                const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
                const src = path.join(srcDir, entry.name);
                if (entry.isDirectory()) {
                    if (walk(src, rel)) return true;
                    continue;
                }
                if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
                const liveFile = path.join(liveResourcesDir, rel);
                if (!fs.existsSync(liveFile)) return true;
                const seedContent = safeRead(src);
                const liveContent = safeRead(liveFile);
                if (seedContent === null || liveContent === null) continue; // fail-soft
                for (const e of parseEntries(seedContent)) {
                    if (!liveContent.includes(`[${e.id}]`)) return true;
                }
            }
            return false;
        };
        return walk(seedResourcesDir, "");
    } catch {
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge (the /aftc-codex-sync routine)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bring the live codex dir up to date with the shipped seed. Both arguments
 * are the codex ROOTS (the dir containing codex-rules.md + resources/).
 * Never throws; re-running is a no-op.
 */
export function mergeCodexSeedIntoLive(seedDir: string, liveDir: string): CodexMergeReport {
    const report: CodexMergeReport = {
        createdLiveDir: false,
        createdResourcesDir: false,
        copiedFiles: [],
        merged: [],
        errors: [],
    };

    // Step 1 — live codex dir missing: copy the whole seed over and stop.
    if (!fs.existsSync(liveDir)) {
        try {
            fs.mkdirSync(liveDir, { recursive: true });
        } catch (err) {
            report.errors.push(`create ${liveDir}: ${(err as Error).message}`);
            return report;
        }
        copyTree(seedDir, liveDir, "", report.copiedFiles, report.errors);
        report.createdLiveDir = true;
        return report;
    }

    // Steps 2-4 — top-level guidance files (copy-only, no sync needed).
    for (const name of TOP_LEVEL_FILES) {
        const src = path.join(seedDir, name);
        const dest = path.join(liveDir, name);
        try {
            if (fs.existsSync(src) && !fs.existsSync(dest)) {
                fs.copyFileSync(src, dest);
                report.copiedFiles.push(name);
            }
        } catch (err) {
            report.errors.push(`copy ${name}: ${(err as Error).message}`);
        }
    }

    // Step 5 — resources/ missing: copy the whole seed resources and stop.
    const seedResourcesDir = path.join(seedDir, "resources");
    const liveResourcesDir = path.join(liveDir, "resources");
    if (!fs.existsSync(liveResourcesDir)) {
        try {
            fs.mkdirSync(liveResourcesDir, { recursive: true });
        } catch (err) {
            report.errors.push(`create ${liveResourcesDir}: ${(err as Error).message}`);
            return report;
        }
        const before = report.copiedFiles.length;
        const rels: string[] = [];
        copyTree(seedResourcesDir, liveResourcesDir, "", rels, report.errors);
        for (const rel of rels) report.copiedFiles.push(`resources/${rel}`);
        report.createdResourcesDir = report.copiedFiles.length >= before;
        return report;
    }

    // Step 6 — merge pass over the seed resources tree (all category folders,
    // discovered dynamically; any depth, though the layout is one level).
    const walk = (srcDir: string, relPrefix: string): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(srcDir, { withFileTypes: true });
        } catch (err) {
            report.errors.push(`read resources/${relPrefix || "."}: ${(err as Error).message}`);
            return;
        }
        for (const entry of entries) {
            const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
            const src = path.join(srcDir, entry.name);
            if (entry.isDirectory()) {
                walk(src, rel);
                continue;
            }
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
            const liveFile = path.join(liveResourcesDir, rel);
            const relOut = `resources/${rel}`;
            try {
                if (!fs.existsSync(liveFile)) {
                    // Seed-only file: copy it over (mkdir as needed).
                    fs.mkdirSync(path.dirname(liveFile), { recursive: true });
                    fs.copyFileSync(src, liveFile);
                    report.copiedFiles.push(relOut);
                } else {
                    const { appended, error } = mergeFile(src, liveFile);
                    if (error) report.errors.push(`${relOut}: ${error}`);
                    if (appended.length > 0) report.merged.push({ file: relOut, ids: appended });
                }
            } catch (err) {
                report.errors.push(`${relOut}: ${(err as Error).message}`);
            }
        }
    };
    walk(seedResourcesDir, "");

    return report;
}

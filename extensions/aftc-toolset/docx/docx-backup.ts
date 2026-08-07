/**
 * pi-aftc-toolset / docx — deterministic pre-generation backup.
 *
 * Runs BEFORE the /docx generation prompt is injected. Moves every
 * pre-existing documentation file into `<projectRoot>/docx/old_docs/`,
 * preserving each file's path relative to the project root, so the user
 * can restore by copying files back. The staging folder is zipped into
 * `docx/backups/` (timestamped name per command; folder removed) by
 * `scripts/zip-old.mjs` at the END of the run — the model needs the old
 * docs readable during recon (the guide's step 1), so zipping cannot
 * happen here.
 *
 * SCOPE IS A WHITELIST (never a blacklist). Only three places are
 * touched, so framework / sub-project documentation inside code folders
 * is unreachable by construction:
 *   1. Root-level *.md files (moved), except AI context files (copied).
 *   2. Known AI-tool context files (AGENTS.md, CLAUDE.md, GEMINI.md,
 *      .github/copilot-instructions.md, .cursor/rules/*.mdc) — COPIED
 *      into the backup, left in place (AGENTS.md is edited in place by
 *      the generation run, never regenerated from nothing).
 *   3. ./docs/** — *.md files moved; partner docs (a .md sharing its
 *      basename with a non-.md sibling) stay; excluded dir names are
 *      never walked; emptied subfolders are pruned; ./docs itself is
 *      removed only when fully empty, otherwise leftovers are reported.
 * Plus the previous run's output: everything in ./docx (except old_docs/
 * and backups/ — the accumulated backup zips stay put) is folded into the
 * new backup.
 *
 * Safety contract (from the guide): if the destination cannot be
 * created, THROW — the caller must not regenerate over existing docs.
 * Every move is verified (moved count == planned count); any mismatch
 * lands in `errors` and the caller aborts before injecting the prompt.
 *
 * Pure Node (fs/path only), no pi imports — unit-tested via jiti.
 * See `docx-backup-readme.md` for the full contract.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/** Root-level AI auto-inject files: copied into the backup, left in place. */
const ROOT_AI_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"];

/** AI-tool context files below the root: copied, left in place. */
const AI_SUBDIR_FILES = [".github/copilot-instructions.md"];

/** Glob-ish AI dirs whose *.mdc files are copied, left in place. */
const AI_SUBDIR_MDC_DIRS = [".cursor/rules"];

/** Directory names never walked inside ./docs (and never moved). */
const EXCLUDED_DIR_NAMES = new Set([
    "node_modules", "vendor", "dist", "build", "out", "target",
    ".next", ".nuxt", ".svelte-kit", ".turbo", ".gradle",
    "__pycache__", ".venv", "venv", "env", "coverage", ".cache",
    ".git", ".hg", ".svn", ".idea", ".vscode",
    "old", "old_docs", "old_docs_backup", "docx",
]);

/** Documentation extensions the mover collects. */
const DOC_EXTENSIONS = new Set([".md", ".markdown"]);

export interface DocxBackupResult {
    projectRoot: string;
    /** Absolute path of the backup staging dir (<root>/docx/old_docs). */
    oldDir: string;
    /** Files MOVED into old_docs/, as dest paths relative to old_docs/. */
    moved: string[];
    /** AI context files COPIED into old_docs/ (originals left in place). */
    copied: string[];
    /** Partner docs intentionally left in place (rel to project root). */
    partnerSkipped: string[];
    /** True when ./docs was fully emptied and removed. */
    docsDirRemoved: boolean;
    /** Top-level names left in ./docs (non-documentation files). */
    docsLeftovers: string[];
    /** Non-empty = a move/copy failed; caller must abort generation. */
    errors: string[];
    /** Non-fatal problems (eg .gitignore not updated). */
    warnings: string[];
    /** True when no pre-existing documentation was found at all. */
    firstRun: boolean;
}

interface PlannedOp {
    kind: "move" | "copy";
    /** Absolute source path. */
    src: string;
    /** Dest path relative to old_docs/ (preserves rel-from-root structure). */
    destRel: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isDocFile(name: string): boolean {
    return DOC_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/**
 * Partner-doc rule: a .md that shares its basename with a non-.md file in
 * the same directory belongs to that code and stays put
 * (eg `notes.md` next to `notes.txt` is not project documentation).
 */
function hasCodeSibling(dir: string, fileName: string): boolean {
    const base = fileName.slice(0, fileName.length - path.extname(fileName).length);
    let siblings: string[];
    try {
        siblings = fs.readdirSync(dir);
    } catch {
        return false;
    }
    return siblings.some((s) => {
        if (s === fileName) return false;
        const ext = path.extname(s).toLowerCase();
        if (DOC_EXTENSIONS.has(ext)) return false;
        return s.slice(0, s.length - ext.length) === base;
    });
}

/** Walk ./docs collecting in-scope doc files (relative to projectRoot). */
function collectDocsDir(docsDir: string, projectRoot: string, out: string[], partnerSkipped: string[]): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(docsDir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(docsDir, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
            collectDocsDir(full, projectRoot, out, partnerSkipped);
            continue;
        }
        if (!entry.isFile() || !isDocFile(entry.name)) continue;
        if (hasCodeSibling(docsDir, entry.name)) {
            partnerSkipped.push(path.relative(projectRoot, full));
            continue;
        }
        out.push(full);
    }
}

/** Remove empty directories bottom-up; returns true when dir ended empty. */
function pruneEmptyDirs(dir: string): boolean {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return false;
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
        pruneEmptyDirs(path.join(dir, entry.name));
    }
    try {
        if (fs.readdirSync(dir).length === 0) {
            fs.rmdirSync(dir);
            return true;
        }
    } catch {
        // Non-empty or locked — leave it.
    }
    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Move/copy every pre-existing documentation file into
 * `<projectRoot>/docx/old_docs/`, preserving rel-from-root structure.
 * Throws when the destination cannot be created (guide STOP rule).
 */
export function runDocxBackup(projectRoot: string): DocxBackupResult {
    const root = path.resolve(projectRoot);
    const docxDir = path.join(root, "docx");
    const oldDir = path.join(docxDir, "old_docs");

    const result: DocxBackupResult = {
        projectRoot: root,
        oldDir,
        moved: [],
        copied: [],
        partnerSkipped: [],
        docsDirRemoved: false,
        docsLeftovers: [],
        warnings: [],
        errors: [],
        firstRun: false,
    };

    // The destination MUST be creatable — otherwise stop before anything
    // is moved (guide: "do not regenerate over existing docs").
    try {
        fs.mkdirSync(oldDir, { recursive: true });
    } catch (err) {
        throw new Error(
            `docx backup: cannot create ${oldDir}: ${(err as Error).message}`,
        );
    }

    const ops: PlannedOp[] = [];
    const plan = (kind: "move" | "copy", src: string, destRel: string): void => {
        ops.push({ kind, src, destRel });
    };

    // 1. Previous run's generated output (everything in docx/ except
    //    old_docs/ and backups/ — the accumulated timestamped backup
    //    zips are permanent and never folded) folds in under old_docs/docx/.
    if (fs.existsSync(docxDir)) {
        for (const name of fs.readdirSync(docxDir)) {
            if (name === "old_docs" || name === "backups") continue;
            plan("move", path.join(docxDir, name), path.posix.join("docx", name));
        }
    }

    // 3. Root-level doc files (moved), except AI context files (copied).
    let rootEntries: fs.Dirent[] = [];
    try {
        rootEntries = fs.readdirSync(root, { withFileTypes: true });
    } catch (err) {
        result.errors.push(`cannot read project root: ${(err as Error).message}`);
        return result;
    }
    for (const entry of rootEntries) {
        if (!entry.isFile() || !isDocFile(entry.name)) continue;
        if (ROOT_AI_FILES.includes(entry.name)) {
            plan("copy", path.join(root, entry.name), entry.name);
            continue;
        }
        if (hasCodeSibling(root, entry.name)) {
            result.partnerSkipped.push(entry.name);
            continue;
        }
        plan("move", path.join(root, entry.name), entry.name);
    }

    // 4. AI-tool context files below the root (copied, left in place).
    for (const rel of AI_SUBDIR_FILES) {
        const src = path.join(root, rel);
        if (fs.existsSync(src)) plan("copy", src, rel.split("/").join(path.posix.sep));
    }
    for (const relDir of AI_SUBDIR_MDC_DIRS) {
        const dir = path.join(root, relDir);
        if (!fs.existsSync(dir)) continue;
        try {
            for (const name of fs.readdirSync(dir)) {
                if (!name.toLowerCase().endsWith(".mdc")) continue;
                plan("copy", path.join(dir, name), path.posix.join(relDir, name));
            }
        } catch {
            // Unreadable AI dir — not documentation, skip.
        }
    }

    // 5. ./docs/** doc files (moved).
    const docsDir = path.join(root, "docs");
    const docsFiles: string[] = [];
    if (fs.existsSync(docsDir)) {
        collectDocsDir(docsDir, root, docsFiles, result.partnerSkipped);
    }
    for (const src of docsFiles) {
        const rel = path.relative(root, src).split(path.sep).join(path.posix.sep);
        plan("move", src, rel);
    }

    // Execute the plan, verifying every operation.
    let plannedMoves = 0;
    let doneMoves = 0;
    for (const op of ops) {
        const dest = path.join(oldDir, op.destRel);
        try {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            if (op.kind === "move") {
                plannedMoves++;
                fs.renameSync(op.src, dest);
                doneMoves++;
                result.moved.push(op.destRel);
            } else {
                fs.copyFileSync(op.src, dest);
                result.copied.push(op.destRel);
            }
        } catch (err) {
            result.errors.push(
                `${op.kind} failed: ${op.src} -> ${dest}: ${(err as Error).message}`,
            );
        }
    }
    if (doneMoves !== plannedMoves) {
        result.errors.push(
            `move count mismatch: ${doneMoves}/${plannedMoves} completed`,
        );
    }

    // 6. Prune ./docs: remove emptied subfolders; remove ./docs only when
    //    fully empty; otherwise report the leftovers and keep it.
    if (fs.existsSync(docsDir)) {
        pruneEmptyDirs(docsDir);
        if (fs.existsSync(docsDir)) {
            try {
                result.docsLeftovers = fs.readdirSync(docsDir);
            } catch {
                result.docsLeftovers = ["<unreadable>"];
            }
        } else {
            result.docsDirRemoved = true;
        }
    }

    // 7. .gitignore: keep the backup artifacts out of version control.
    //    Appended as two plain lines (idempotent), never reordered/rewritten.
    try {
        const gitignore = path.join(root, ".gitignore");
        const existing = fs.existsSync(gitignore)
            ? fs.readFileSync(gitignore, "utf8")
            : "";
        const lines: string[] = [];
        if (!/^docx\/old_docs\/?$/m.test(existing)) lines.push("docx/old_docs/");
        if (!/^docx\/backups\/?$/m.test(existing)) lines.push("docx/backups/");
        if (lines.length > 0) {
            const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
            fs.writeFileSync(
                gitignore,
                `${existing}${prefix}# aftc docx backup artifacts\n${lines.join("\n")}\n`,
                "utf8",
            );
        }
    } catch (err) {
        // Non-fatal: the backup itself succeeded.
        result.warnings.push(`.gitignore update failed (non-fatal): ${(err as Error).message}`);
    }

    result.firstRun =
        result.moved.length === 0 &&
        result.copied.length === 0 &&
        result.errors.length === 0;
    return result;
}

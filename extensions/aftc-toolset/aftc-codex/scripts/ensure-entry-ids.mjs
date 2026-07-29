#!/usr/bin/env node
/**
 * ensure-entry-ids.mjs — ensure every entry in aftc-codex resource files has a
 * unique 6-character alphanumeric ID.
 *
 * Entry formats (the ID sits at the start of the entry bullet, any section):
 *   Rules / Gotchyas (single line):
 *   - `[xY3zA1] Never do X / LEAD — trap; countermeasure`
 *   Issues & Solutions (three lines):
 *   - `[xY3zA1] Symptom or lead token`
 *     Cause: ...
 *     Fix: ... (YYYY-MM)
 *
 * Rules:
 *   - IDs are 6 chars from [a-zA-Z0-9].
 *   - IDs must be unique WITHIN the same file (not globally).
 *   - Entries that already have an ID (`[xxxxxx]` pattern) are left untouched.
 *   - Only lines starting with "- `" (entry start) are processed.
 *   - The script is idempotent: running it twice changes nothing.
 *   - Never throws: exit 0 with a note on error.
 *
 * Callers:
 *   1. The extension spawns it during seeding / sync to ensure new entries get IDs.
 *   2. The maintainer runs it manually after editing resource files.
 *
 * Usage:
 *   node ensure-entry-ids.mjs [dir]
 *   If no dir is given, resolves the user's live codex resources dir.
 *   Pass a dir argument to process a specific folder (eg the shipped seed under
 *   extensions/aftc-toolset/data/aftc-codex).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import process from "node:process";

const PACKAGE_NAME = "pi-aftc-toolset";
const ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ID_LENGTH = 6;
// Matches an existing ID: [xxxxxx] followed by a space.
const EXISTING_ID_RE = /^\[([a-zA-Z0-9]{6})\]\s/;
// Matches the start of an entry line: "- " followed by content (not indented continuation).
const ENTRY_START_RE = /^- \S/;
// Matches entry start with a backtick: "- `"
const ENTRY_BACKTICK_RE = /^- `/;

// --- data-dir resolution (mirror paths.ts EXACTLY) --------------------------

function getPersistentRoot() {
    const override = process.env.AFTC_TOOLSET_DATA_ROOT;
    if (override && override.trim()) return path.resolve(override);
    const home = os.homedir();
    if (process.platform === "win32") {
        const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
        return path.join(appData, PACKAGE_NAME);
    }
    if (process.platform === "darwin") {
        return path.join(home, "Library", "Application Support", PACKAGE_NAME);
    }
    const dataHome = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
    return path.join(dataHome, PACKAGE_NAME);
}

function getDefaultResourcesDir() {
    return path.join(getPersistentRoot(), "data", "aftc-codex", "resources");
}

// --- ID generation -----------------------------------------------------------

function generateId(existingIds) {
    let id;
    do {
        id = "";
        for (let i = 0; i < ID_LENGTH; i++) {
            id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
        }
    } while (existingIds.has(id));
    return id;
}

// --- file processing ---------------------------------------------------------

/** Process a single .md file. Returns the number of IDs added. */
function processFile(absPath) {
    let content;
    try {
        content = fs.readFileSync(absPath, "utf8");
    } catch {
        return 0;
    }

    const lines = content.split(/\r?\n/);
    const existingIds = new Set();
    let added = 0;

    // First pass: collect existing IDs.
    for (const line of lines) {
        if (!ENTRY_START_RE.test(line)) continue;
        let text;
        if (ENTRY_BACKTICK_RE.test(line)) {
            text = line.slice(3); // after "- `"
        } else {
            text = line.slice(2); // after "- "
        }
        const m = EXISTING_ID_RE.exec(text);
        if (m) existingIds.add(m[1]);
    }

    // Second pass: add IDs where missing.
    const out = lines.map((line) => {
        if (!ENTRY_START_RE.test(line)) return line;
        if (ENTRY_BACKTICK_RE.test(line)) {
            // Backtick entry: "- `text`" -> "- `[ID] text`"
            const afterBacktick = line.slice(3);
            if (EXISTING_ID_RE.test(afterBacktick)) return line;
            const id = generateId(existingIds);
            existingIds.add(id);
            added++;
            return `- \`[${id}] ${afterBacktick}`;
        } else {
            // Plain entry: "- text" -> "- [ID] text"
            const afterDash = line.slice(2);
            if (EXISTING_ID_RE.test(afterDash)) return line;
            const id = generateId(existingIds);
            existingIds.add(id);
            added++;
            return `- [${id}] ${afterDash}`;
        }
    });

    if (added > 0) {
        try {
            fs.writeFileSync(absPath, out.join("\n"), "utf8");
        } catch (err) {
            console.log(`[aftc-toolset] ensure-entry-ids: write failed for ${absPath}: ${err.message}`);
            return 0;
        }
    }
    return added;
}

/** Recursively find all .md files in category subfolders. Category folders are
 *  discovered DYNAMICALLY (any subdirectory of the resources dir) so new
 *  categories (eg runtimes/) are picked up without a code change. */
function findResourceFiles(dir) {
    const files = [];
    let categories;
    try {
        categories = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return files;
    }
    for (const cat of categories) {
        if (!cat.isDirectory()) continue;
        const catDir = path.join(dir, cat.name);
        let entries;
        try {
            entries = fs.readdirSync(catDir);
        } catch {
            continue;
        }
        for (const name of entries) {
            if (!name.toLowerCase().endsWith(".md")) continue;
            const abs = path.join(catDir, name);
            try {
                if (fs.statSync(abs).isFile()) files.push(abs);
            } catch { /* skip */ }
        }
    }
    return files;
}

// --- main --------------------------------------------------------------------

function main() {
    const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : getDefaultResourcesDir();

    if (!fs.existsSync(targetDir)) {
        console.log(`[aftc-toolset] ensure-entry-ids: dir not found (${targetDir}) — nothing to do.`);
        return;
    }

    const files = findResourceFiles(targetDir);
    let totalAdded = 0;
    let filesModified = 0;

    for (const file of files) {
        const added = processFile(file);
        if (added > 0) {
            filesModified++;
            totalAdded += added;
        }
    }

    if (totalAdded === 0) {
        console.log(`[aftc-toolset] ensure-entry-ids: all entries already have IDs (${files.length} files checked).`);
    } else {
        console.log(`[aftc-toolset] ensure-entry-ids: added ${totalAdded} ID(s) across ${filesModified} file(s).`);
    }
}

try {
    main();
} catch (err) {
    console.log(`[aftc-toolset] ensure-entry-ids: error: ${err && err.message ? err.message : String(err)}`);
}

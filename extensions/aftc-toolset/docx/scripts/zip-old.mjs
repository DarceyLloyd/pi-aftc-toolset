#!/usr/bin/env node
/**
 * docx zip-old — finalise the /docx + /docx-update backup (LAST step of
 * the run).
 *
 * The model runs this as the final step of the run:
 *   node <extension>/docx/scripts/zip-old.mjs <projectRoot> <label>
 *
 * Labels:
 *   original  (/docx)        -> "Original Documentation Backup YYMMDD HHMM.zip"
 *   update    (/docx-update) -> "Documentation Backup YYMMDD HHMM.zip"
 *
 * Zips <projectRoot>/docx/old_docs/ into <projectRoot>/docx/backups/
 * under that timestamped name (the backups/ folder accumulates every
 * run's backup), verifies the zip entry count against the files on
 * disk, then deletes old_docs/ so future AI sessions never read
 * superseded documentation.
 *
 * Zipping happens HERE and not in the pre-generation backup because the
 * model must read the old docs during recon (guide step 1).
 *
 * Uses adm-zip (MIT, pure JS, zero native code — same result on
 * Windows/macOS/Linux). Self-terminating.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import AdmZip from "adm-zip";

const watchdog = setTimeout(() => {
    console.error("zip-old: exceeded 55s internal timeout");
    process.exit(2);
}, 55_000);
watchdog.unref();

const LABELS = {
    original: "Original Documentation Backup",
    update: "Documentation Backup",
};

const root = resolve(process.argv[2] || ".");
const label = (process.argv[3] || "original").toLowerCase();
if (!LABELS[label]) {
    console.error(`zip-old: unknown label "${process.argv[3]}" — expected "original" (/docx) or "update" (/docx-update).`);
    process.exit(1);
}

const oldDir = join(root, "docx", "old_docs");
const backupsDir = join(root, "docx", "backups");

if (!existsSync(oldDir)) {
    console.log("zip-old: no docx/old_docs folder — nothing to zip (first run or already zipped).");
    process.exit(0);
}

function countFiles(dir) {
    let count = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) count += countFiles(full);
        else if (entry.isFile()) count++;
    }
    return count;
}

const fileCount = countFiles(oldDir);
if (fileCount === 0) {
    console.log("zip-old: docx/old_docs is empty — removing it without creating a zip.");
    rmSync(oldDir, { recursive: true, force: true });
    process.exit(0);
}

// Timestamp: YYMMDD HHMM in LOCAL time (matches the user-facing naming).
function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
}

mkdirSync(backupsDir, { recursive: true });
const zipPath = join(backupsDir, `${LABELS[label]} ${stamp()}.zip`);

const zip = new AdmZip();
zip.addLocalFolder(oldDir);
zip.writeZip(zipPath);

// Verify: every file on disk landed in the zip before we delete anything.
const entryCount = zip.getEntries().filter((e) => !e.isDirectory).length;
if (entryCount !== fileCount) {
    console.error(
        `zip-old: entry count mismatch (${entryCount} zipped vs ${fileCount} on disk) — ` +
        `old_docs/ NOT deleted. Zip left at ${zipPath}; investigate before re-running.`,
    );
    process.exit(1);
}

rmSync(oldDir, { recursive: true, force: true });
if (existsSync(oldDir)) {
    console.error("zip-old: failed to delete docx/old_docs after zipping — delete it manually.");
    process.exit(1);
}

const sizeKb = Math.round(statSync(zipPath).size / 1024);
console.log(`zip-old: ${fileCount} files -> ${zipPath} (${sizeKb} KB). docx/old_docs removed.`);
process.exit(0);

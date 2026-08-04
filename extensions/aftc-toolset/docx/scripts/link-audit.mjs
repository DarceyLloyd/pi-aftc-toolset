#!/usr/bin/env node
/**
 * docx link-audit — mechanical verification for /docx generation (STEP 11).
 *
 * The model runs this AFTER generating the documentation set:
 *   node <extension>/docx/scripts/link-audit.mjs <projectRoot>
 *
 * Checks (all mechanical, no judgement):
 *   1. Every markdown link target ](...md) in every generated file resolves.
 *   2. Every ./docx/....md path mentioned in prose (Only-read instructions,
 *      index entries, backticked paths) exists.
 *   3. Every last-reviewed / last-verified stamp matches YYYY-MM-DD HH:MM.
 *   4. Every ID-prefixed file under docx/docs has an H1 starting with its ID.
 *   5. Every map ID in project_map.md has a matching doc file (1:1).
 *
 * Exit 0 = PASS, 1 = FAIL (failures listed). Pure Node stdlib, no shell,
 * self-terminating.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

const watchdog = setTimeout(() => {
    console.error("link-audit: exceeded 55s internal timeout");
    process.exit(2);
}, 55_000);
watchdog.unref();

const root = resolve(process.argv[2] || ".");
const docxDir = join(root, "docx");

if (!existsSync(docxDir)) {
    console.error(`link-audit: no docx folder at ${docxDir}`);
    process.exit(1);
}

const failures = [];
let checks = 0;

function fail(file, msg) {
    failures.push(`${file}: ${msg}`);
}

/** Recursively collect .md files under dir. */
function collectMd(dir, out) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "old" || entry.name.startsWith(".")) continue;
            collectMd(full, out);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
            out.push(full);
        }
    }
}

const files = [];
collectMd(docxDir, files);
// Root README + AI context file also carry doc references.
for (const rootFile of ["README.md", "AGENTS.md"]) {
    const full = join(root, rootFile);
    if (existsSync(full)) files.push(full);
}

const STAMP_RE = /last-(?:reviewed|verified)\s*:\s*([0-9][0-9: -]*[0-9])/g;
const STAMP_FMT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const LINK_RE = /\]\(([^)\s]+\.md(?:#[^)]*)?)\)/g;
const PROSE_RE = /`?(\.\/docx\/[\w./-]+\.md)`?/g;

for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = file.slice(root.length + 1);
    const dir = dirname(file);

    // 1+2. Link targets and prose path references resolve.
    for (const m of text.matchAll(LINK_RE)) {
        const target = m[1].split("#")[0];
        if (/^https?:/i.test(target)) continue;
        checks++;
        if (!existsSync(resolve(dir, target))) {
            fail(rel, `broken link -> ${m[1]}`);
        }
    }
    for (const m of text.matchAll(PROSE_RE)) {
        checks++;
        if (!existsSync(resolve(root, m[1]))) {
            fail(rel, `referenced path missing -> ${m[1]}`);
        }
    }

    // 3. Stamp format (only in files that carry a stamp). The capture
    //    stops at the first letter, so a structure-map header's
    //    "- regenerate: ..." suffix is excluded from the check.
    for (const m of text.matchAll(STAMP_RE)) {
        checks++;
        const stamp = m[1].replace(/[^0-9:]+$/, "").trim();
        if (!STAMP_FMT.test(stamp)) {
            fail(rel, `bad stamp format "${stamp}" (need YYYY-MM-DD HH:MM)`);
        }
    }

    // 4. ID-prefixed file -> H1 starts with the ID. And the reverse
    //    (guide: file name AND title carry the ID at every level): an H1
    //    that starts with an ID requires the filename to carry it too.
    const base = basename(file);
    const idMatch = base.match(/^(\d+(?:\.\d+)+)_[\w.-]+\.md$/);
    if (idMatch) {
        checks++;
        const h1 = text.match(/^# .+$/m);
        if (!h1 || !h1[0].startsWith(`# ${idMatch[1]} `)) {
            fail(rel, `H1 does not start with its ID (${idMatch[1]})`);
        }
    } else if (file.includes(`${sep}docs${sep}`)) {
        const h1Id = text.match(/^# (\d+(?:\.\d+)+) /m);
        if (h1Id) {
            checks++;
            fail(rel, `H1 has ID ${h1Id[1]} but the filename does not (rename to ${h1Id[1]}_${base})`);
        }
    }
}

// 6. Layout: docx/ may contain ONLY project_documentation.md,
//    project_map.md, docs/, generation-plan.md (transient), old_docs/
//    and old_docs.zip (tooling-owned). No invented folders/files.
const ALLOWED_DOCX_ROOT = new Set([
    "project_documentation.md", "project_map.md", "docs",
    "generation-plan.md", "old_docs", "old_docs.zip",
]);
for (const entry of readdirSync(docxDir, { withFileTypes: true })) {
    checks++;
    if (!ALLOWED_DOCX_ROOT.has(entry.name)) {
        fail("docx/", `unexpected artefact "${entry.name}" (only project_documentation.md, project_map.md, docs/ are generated)`);
    }
}
// Sub-maps are FILES in docx/docs/ named <id>_<area>_map.md - docs/ holds
// files only, no subfolders.
const docsDirEntries = existsSync(join(docxDir, "docs"))
    ? readdirSync(join(docxDir, "docs"), { withFileTypes: true })
    : [];
for (const entry of docsDirEntries) {
    if (entry.isDirectory()) {
        checks++;
        fail("docx/docs", `unexpected subfolder "${entry.name}" (docs/ holds files only)`);
    }
}

// 5. Every map ID has exactly one deep doc file, and vice versa.
//    Sub-map files (<id>_<area>_map.md) are NOT deep docs: an ID may have
//    one deep doc AND one sub-map. Count them separately (max one sub-map
//    per ID).
const mapFile = join(docxDir, "project_map.md");
if (existsSync(mapFile)) {
    const mapText = readFileSync(mapFile, "utf8");
    const mapIds = new Set();
    // Annotation lines carry the ID at line start: "- 1.2.3 — ..." or "1.2.3 "
    for (const m of mapText.matchAll(/^\s*(?:[-*]\s*)?(\d+(?:\.\d+)+)\s/mg)) {
        mapIds.add(m[1]);
    }
    const docIds = new Map();
    const subMapIds = new Map();
    for (const file of files) {
        const base = basename(file);
        const m = base.match(/^(\d+(?:\.\d+)+)_[\w.-]+\.md$/);
        if (!m) continue;
        if (base.endsWith("_map.md")) {
            subMapIds.set(m[1], (subMapIds.get(m[1]) || 0) + 1);
        } else {
            docIds.set(m[1], (docIds.get(m[1]) || 0) + 1);
        }
    }
    for (const id of mapIds) {
        checks++;
        if (!docIds.has(id)) fail("project_map.md", `map ID ${id} has no docx/docs doc file`);
    }
    for (const [id, count] of docIds) {
        checks++;
        if (count > 1) fail("docx/docs", `ID ${id} has ${count} doc files (must be exactly one)`);
        if (!mapIds.has(id)) fail("docx/docs", `doc file ID ${id} is not in project_map.md`);
    }
    for (const [id, count] of subMapIds) {
        checks++;
        if (count > 1) fail("docx/docs", `ID ${id} has ${count} sub-map files (must be at most one)`);
        if (!mapIds.has(id)) fail("docx/docs", `sub-map ID ${id} is not in project_map.md`);
    }
} else {
    fail("docx/project_map.md", "missing (the root structure map is mandatory)");
}

// (String.matchAll clones the regex, so the shared /g literal is safe
// across files — no lastIndex state leaks between iterations.)

console.log(`link-audit: ${checks} checks across ${files.length} files`);
if (failures.length > 0) {
    console.log(`\nFAIL (${failures.length}):`);
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
}
console.log("PASS");
process.exit(0);

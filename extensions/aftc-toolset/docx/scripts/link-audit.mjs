#!/usr/bin/env node
/**
 * docx link-audit — mechanical verification for /docx generation (STEP 11).
 *
 * The model runs this AFTER generating the documentation set:
 *   node <extension>/docx/scripts/link-audit.mjs <projectRoot>
 *
 * Checks (all mechanical, no judgement):
 *   1. Every markdown link target ](...md) in every generated file resolves
 *      (relative to its actual location in the nested tree).
 *   2. Every ./docx/....md path mentioned in prose (Only-read instructions,
 *      index entries, backticked paths) exists.
 *   3. Every last-reviewed / last-verified stamp matches YYYY-MM-DD HH:MM.
 *   4. Every ID-prefixed file under docx/ has an H1 starting with its ID.
 *   5. Every map ID in project_map.md has a matching doc file (1:1;
 *      _map/_layout/_sitemap/_design partner files are not deep docs).
 *   6. Layout: docx/ holds ONLY project_documentation.md, project_map.md,
 *      generation-plan.md (transient), old_docs/ + old_docs.zip
 *      (tooling-owned), cross-cutting .md files and the MIRRORED FOLDER
 *      TREE (ID-prefixed node folders + top-level ID leaf docs).
 *   7. Mirrored tree: every folder under docx/ carries a map ID and keeps
 *      the ancestry chain; every ID-prefixed doc lives under the folder
 *      chain of its ID ancestry; every node-with-children has its folder;
 *      cross-cutting docs live at the docx/ root only.
 *   8. Discovery completeness: every generated .md under docx/ is listed in
 *      the master's Documentation Index.
 *
 * Exit 0 = PASS, 1 = FAIL (failures listed). Pure Node stdlib, no shell,
 * self-terminating.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { collectUiHints } from "./ui-hints.mjs";

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

/** Recursively collect .md files under dir (old_docs/ + hidden skipped). */
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
            if (entry.name === "old" || entry.name === "old_docs" || entry.name.startsWith(".")) continue;
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
const ID_FILE_RE = /^(\d+(?:\.\d+)*)_[\w.-]+\.md$/;
const ID_FOLDER_RE = /^(\d+(?:\.\d+)*)_[\w.-]+$/;

// Root entries with a fixed, non-ID role. generation-plan.md is transient
// (deleted at step 12); old_docs.zip is tooling-owned.
const FIXED_DOCX_FILES = new Set([
    "project_documentation.md", "project_map.md", "generation-plan.md", "old_docs.zip",
]);

const relOf = (file) => file.slice(root.length + 1);

// Sitemap'd branches (a UI branch is an ID with a <id>_*_sitemap.md file).
const sitemapIds = new Set();
for (const file of files) {
    const m = basename(file).match(/^(\d+(?:\.\d+)*)_[\w.-]+_sitemap\.md$/);
    if (m) sitemapIds.add(m[1]);
}
const inSitemapBranch = (id) => [...sitemapIds].some((s) => id === s || id.startsWith(`${s}.`));
// Cached texts (the surface-coverage corpus below reuses them).
const docxTexts = new Map();

for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = relOf(file);
    const dir = dirname(file);
    if (file.startsWith(docxDir + sep)) docxTexts.set(file, text);

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
    //    that starts with an ID requires the filename to carry it too
    //    (checked for generated docs under docx/; the master, map and the
    //    transient plan are exempt by name, README/AGENTS by location).
    const base = basename(file);
    const idMatch = base.match(ID_FILE_RE);
    if (idMatch) {
        checks++;
        const h1 = text.match(/^# .+$/m);
        if (!h1 || !h1[0].startsWith(`# ${idMatch[1]} `)) {
            fail(rel, `H1 does not start with its ID (${idMatch[1]})`);
        }
    } else if (file.startsWith(docxDir + sep) && !FIXED_DOCX_FILES.has(base)) {
        const h1Id = text.match(/^# (\d+(?:\.\d+)*) /m);
        if (h1Id) {
            checks++;
            fail(rel, `H1 has ID ${h1Id[1]} but the filename does not (rename to ${h1Id[1]}_${base})`);
        }
    }

    // 4b. Content depth (docs under docx/ only; maps + _layout/_design
    //     partners are exempt, the master/map/plan by name).
    if (file.startsWith(docxDir + sep) && !FIXED_DOCX_FILES.has(base)) {
        if (base.endsWith("_sitemap.md")) {
            checks++;
            if (!/HIGH LEVEL/.test(text) || !/LOW LEVEL/.test(text)) {
                fail(rel, `sitemap "${base}" is missing its HIGH LEVEL or LOW LEVEL section`);
            }
        } else if (!base.endsWith("_map.md") && !base.endsWith("_layout.md") && !base.endsWith("_design.md")) {
            checks++;
            if (!/^## References/m.test(text)) {
                fail(rel, `doc "${base}" has no "## References" block`);
            }
            checks++;
            if (!/^## Related/m.test(text)) {
                fail(rel, `doc "${base}" has no "## Related" section`);
            }
            // Page leaves in a sitemap'd branch must carry the state matrix.
            const leafId = base.match(ID_FILE_RE)?.[1];
            if (leafId && !base.endsWith("_documentation.md") && inSitemapBranch(leafId)) {
                checks++;
                if (!/^#{1,6} .+states?\b/im.test(text)) {
                    fail(rel, `page leaf "${base}" has no States section (page docs are build-ready: fields, data, states, rules, related)`);
                }
            }
        }
    }
}

// ── map IDs (needed by the mirrored-tree + counting checks) ────────────────
// Collect map IDs from the root map AND every sub-map. IDs appear in two
// line shapes: annotation lines ("- 1.2.3 — ...") and ASCII-tree lines
// ("|-1.6.1 - Name", "| \-1.7.9 - Name", nested "| | |-1.4.2 ...").
// The prefix class strips tree art (spaces, pipes, backslashes, dashes).
const ID_LINE_RE = /^[|\s\\-]*(\d+(?:\.\d+)*)\s+\S/;
const mapIds = new Set();
const mapFile = join(docxDir, "project_map.md");
const mapExists = existsSync(mapFile);
if (mapExists) {
    const mapFiles = [mapFile, ...files.filter((f) => /_map\.md$/.test(basename(f)) && f !== mapFile && basename(f) !== "dependency_map.md")];
    for (const mf of mapFiles) {
        const text = readFileSync(mf, "utf8");
        for (const line of text.split("\n")) {
            const m = ID_LINE_RE.exec(line);
            if (m) mapIds.add(m[1]);
        }
    }
}
/** True when the map ID is a proper prefix of another map ID (has children). */
const hasChildren = (id) => [...mapIds].some((other) => other.startsWith(`${id}.`));
/** Proper prefixes of id that exist in the map, shallowest first. */
function ancestorIds(id) {
    const comps = id.split(".");
    const out = [];
    for (let i = 1; i < comps.length; i++) {
        const prefix = comps.slice(0, i).join(".");
        if (mapIds.has(prefix)) out.push(prefix);
    }
    return out;
}

// 5. Layout: docx/ may contain ONLY project_documentation.md,
//    project_map.md, generation-plan.md (transient), old_docs/ +
//    old_docs.zip (tooling-owned), cross-cutting .md files, top-level ID
//    leaf docs and ID-prefixed node folders. No invented folders/files.
for (const entry of readdirSync(docxDir, { withFileTypes: true })) {
    if (entry.name === "old_docs") continue; // tooling-owned staging folder
    checks++;
    if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        if (!ID_FOLDER_RE.test(entry.name)) {
            fail("docx/", `unexpected folder "${entry.name}" (docx/ node folders are named <id>_<name>/)`);
        }
    } else if (!FIXED_DOCX_FILES.has(entry.name) && !entry.name.toLowerCase().endsWith(".md")) {
        fail("docx/", `unexpected artefact "${entry.name}" (only .md files, ID-prefixed folders and the fixed root files are generated)`);
    }
}

// 6. Mirrored folder tree (skipped when the map is missing - that failure
//    is reported below and would poison these checks).
if (mapExists) {
    const folderIds = new Set();
    const walkTree = (dir, chain) => {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "old_docs" || entry.name.startsWith(".")) continue;
                const m = entry.name.match(ID_FOLDER_RE);
                if (!m) continue; // already reported by the layout check
                const folderId = m[1];
                folderIds.add(folderId);
                checks++;
                if (!mapIds.has(folderId)) {
                    fail(relOf(full), `folder "${entry.name}" (ID ${folderId}) is not in project_map.md`);
                }
                checks++;
                const parent = chain[chain.length - 1];
                const chainOk = chain.length === 0
                    ? !folderId.includes(".")
                    : folderId.startsWith(`${parent}.`) && folderId.split(".").length === chain.length + 1;
                if (!chainOk) {
                    fail(relOf(full), `folder "${entry.name}" (ID ${folderId}) breaks the ID-ancestry chain (expected it under ${parent ? `folder ${parent}_*` : "the docx/ root"})`);
                }
                walkTree(full, [...chain, folderId]);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
                const m = entry.name.match(ID_FILE_RE);
                if (!m) {
                    // Cross-cutting doc: docx/ root only, never inside a folder.
                    if (chain.length > 0 && !FIXED_DOCX_FILES.has(entry.name)) {
                        checks++;
                        fail(relOf(full), `doc "${entry.name}" has no ID prefix - cross-cutting docs belong at the docx/ root, not inside a node folder`);
                    }
                    continue;
                }
                const fileId = m[1];
                const expected = [...ancestorIds(fileId)];
                if (hasChildren(fileId)) expected.push(fileId);
                checks++;
                const chainOk = expected.length === chain.length && expected.every((v, i) => v === chain[i]);
                if (!chainOk) {
                    const want = expected.length > 0 ? `docx/${expected.join("_*/")}_*/` : "the docx/ root";
                    fail(relOf(full), `doc "${entry.name}" (ID ${fileId}) is not under its ID-ancestry folder chain (expected under ${want})`);
                }
            }
        }
    };
    walkTree(docxDir, []);

    // Every node-with-children has its folder (mirror completeness).
    for (const id of mapIds) {
        if (!hasChildren(id)) continue;
        checks++;
        if (!folderIds.has(id)) {
            fail("docx/", `map ID ${id} has children but no ${id}_<name>/ folder (every node-with-children gets a folder)`);
        }
    }
}

// 7. Discovery completeness: every generated .md under docx/ must be
//    linked from the master's Documentation Index (the index is the
//    on-demand discovery mechanism - an unlisted doc is unreachable).
const masterFile = join(docxDir, "project_documentation.md");
if (existsSync(masterFile)) {
    const masterText = readFileSync(masterFile, "utf8");
    for (const file of files) {
        if (!file.startsWith(docxDir + sep)) continue;
        const base = basename(file);
        if (FIXED_DOCX_FILES.has(base)) continue;
        checks++;
        if (!masterText.includes(base)) {
            fail("project_documentation.md", `Documentation Index does not list ${base}`);
        }
    }
}

// 8. Surface coverage: every UI-hint file in the project must be
//    referenced (by file basename) in at least one docx doc - a surface
//    the docs never mention is undocumented UI. The escape hatch is a
//    conscious mention (eg a partials note in the sitemap).
const hintCorpus = [...docxTexts.values()].join("\n");
const hints = collectUiHints(root);
for (const hint of [...hints.templates, ...hints.sources]) {
    checks++;
    if (!hintCorpus.includes(basename(hint))) {
        fail("docx/", `UI surface hint ${hint} is not referenced by any docx doc - document the surface (sitemap/leaf) or state why it is not one`);
    }
}

// 9. Every map ID has exactly one deep doc file, and vice versa.
//    Sub-map files (<id>_<area>_map.md) are NOT deep docs: an ID may have
//    one deep doc AND one sub-map. Count them separately (max one sub-map
//    per ID).
if (mapExists) {
    const docIds = new Map();
    const subMapIds = new Map();
    for (const file of files) {
        const base = basename(file);
        const m = base.match(ID_FILE_RE);
        if (!m) continue;
        if (base.endsWith("_map.md")) {
            subMapIds.set(m[1], (subMapIds.get(m[1]) || 0) + 1);
        } else if (base.endsWith("_layout.md") || base.endsWith("_sitemap.md") || base.endsWith("_design.md")) {
            // Partner docs (<id>_<artefact>_layout.md, <id>_<area>_sitemap.md,
            // <id>_<area>_design.md) are NOT deep docs: they accompany the
            // owning node's deep doc (H1/ID still checked above).
        } else {
            docIds.set(m[1], (docIds.get(m[1]) || 0) + 1);
        }
    }
    for (const id of mapIds) {
        checks++;
        if (!docIds.has(id)) fail("project_map.md", `map ID ${id} has no doc file in docx/`);
    }
    for (const [id, count] of docIds) {
        checks++;
        if (count > 1) fail("docx/", `ID ${id} has ${count} doc files (must be exactly one)`);
        if (!mapIds.has(id)) fail("docx/", `doc file ID ${id} is not in project_map.md`);
    }
    for (const [id, count] of subMapIds) {
        checks++;
        if (count > 1) fail("docx/", `ID ${id} has ${count} sub-map files (must be at most one)`);
        if (!mapIds.has(id)) fail("docx/", `sub-map ID ${id} is not in project_map.md`);
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

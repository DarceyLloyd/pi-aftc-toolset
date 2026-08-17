/**
 * live-to-seed-sync.mjs — MAINTAINER-ONLY release tool (never wired to any
 * command, menu, or extension code; run by hand from the dev repo).
 *
 * Ports live-only codex resource entries into the package seed — the reverse of
 * the normal seed -> live flow — so entries learned during real sessions ship
 * with the next release.
 *
 * Usage: node extensions/aftc-toolset/aftc-codex/scripts/live-to-seed-sync.mjs [--apply]
 *   default  = dry run (report only, no writes)
 *   --apply  = write merged seed files
 *
 * Rules:
 *   - Entries are keyed by their [ID]; a live entry whose ID is absent from the
 *     seed file is appended at the END of the matching section (Rules /
 *     Gotchyas / Issues & Solutions).
 *   - Seed-only entries are KEPT (never deleted).
 *   - Same-ID-different-text is AUTO-RESOLVED: the LIVE text wins and replaces
 *     the seed entry in place (the live codex is the maintainer's learning
 *     copy - porting it is the point of this tool). Each replacement is
 *     reported as UPDATED so the /codex-live-to-seed command can ask the AI
 *     to review the merged entries.
 *   - Same-ID-different-SECTION (a kind change in live) is ported too: the
 *     seed entry is removed from its old section and appended under the live
 *     entry's section (reported as MOVED). A section heading the seed file
 *     lacks is appended as a new section at the end of the file.
 *   - codex-resource-list.md is GENERATED — never copied to the seed.
 *   - Live-only topic files are copied whole (new topics).
 *   - Top-level fixed docs (codex-rules.md etc.) are diff-reported only.
 *
 * Paths resolve exactly like the extension: live = <AFTC_TOOLSET_DATA_ROOT or
 * OS data dir>/pi-aftc-toolset/data/aftc-codex; seed = the data/aftc-codex dir
 * relative to this script (run it from the dev repo, not an installed package).
 * --live/--seed overrides exist for tests.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

setTimeout(() => { console.error("timeout"); process.exit(2); }, 20_000).unref();

const APPLY = process.argv.includes("--apply");

function argValue(flag) {
    const i = process.argv.indexOf(flag);
    return i !== -1 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : null;
}

function persistentRoot() {
    const override = process.env.AFTC_TOOLSET_DATA_ROOT;
    if (override && override.trim()) return resolve(override);
    const home = homedir();
    if (process.platform === "win32") {
        return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "pi-aftc-toolset");
    }
    if (process.platform === "darwin") {
        return join(home, "Library", "Application Support", "pi-aftc-toolset");
    }
    return join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), "pi-aftc-toolset");
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const LIVE = argValue("--live") ?? join(persistentRoot(), "data", "aftc-codex");
const SEED = argValue("--seed") ?? join(scriptDir, "..", "..", "data", "aftc-codex");

function walk(dir, base = dir) {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p, base));
        else if (e.name.endsWith(".md")) out.push(relative(base, p).replaceAll("\\", "/"));
    }
    return out;
}

/** Parse a resource file into { sections: Map<heading, entries[]> }.
 *  Entry = { id|null, key, block:string[] } (block includes Cause:/Fix: lines,
 *  trailing blank lines stripped). */
function parse(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const sections = new Map();
    let current = null;
    let entry = null;
    for (const line of lines) {
        if (line.startsWith("## ")) {
            current = line.trim();
            entry = null;
            if (!sections.has(current)) sections.set(current, []);
            continue;
        }
        if (current === null) continue;
        if (line.startsWith("- ")) {
            entry = { id: (line.match(/^- \[([^\]]+)\]/) || [])[1] ?? null, block: [line] };
            entry.key = entry.id ?? line.replace(/\s+/g, " ").trim();
            sections.get(current).push(entry);
        } else if (entry && (line.startsWith("  ") || line.trim() === "")) {
            entry.block.push(line);
        } else {
            entry = null;
        }
    }
    for (const entries of sections.values()) {
        for (const e of entries) {
            while (e.block.length > 1 && e.block[e.block.length - 1].trim() === "") e.block.pop();
            e.text = e.block.map((x) => x.trimEnd()).join("\n");
        }
    }
    return { sections };
}

function keyedEntries(sections) {
    const m = new Map();
    for (const [h, entries] of sections) for (const e of entries) m.set(e.key, { heading: h, entry: e });
    return m;
}

const liveFiles = walk(join(LIVE, "resources"));
const planned = [];
let copied = 0, merged = 0, updated = 0, moved = 0;

for (const rel of liveFiles) {
    if (rel === "codex-resource-list.md") continue; // generated, never shipped
    const livePath = join(LIVE, "resources", rel);
    const seedPath = join(SEED, "resources", rel);
    const liveText = readFileSync(livePath, "utf8");

    if (!existsSync(seedPath)) {
        console.log(`NEW TOPIC  ${rel} (copied whole)`);
        planned.push({ seedPath, text: liveText.replace(/\r\n/g, "\n") });
        copied++;
        continue;
    }

    const live = parse(liveText);
    const seedText = readFileSync(seedPath, "utf8");
    const seed = parse(seedText);
    const liveMap = keyedEntries(live.sections);
    const seedMap = keyedEntries(seed.sections);

    const missing = [];
    for (const [h, entries] of live.sections) {
        for (const e of entries) if (!seedMap.has(e.key)) missing.push({ heading: h, entry: e });
    }
    // Same ID, different text: the live codex is the maintainer's learning
    // copy, so the LIVE text wins and replaces the seed entry in place.
    const replace = new Map(); // key -> live entry block
    for (const [key, s] of seedMap) {
        const l = liveMap.get(key);
        if (l && l.entry.text !== s.entry.text) {
            replace.set(key, l.entry);
            console.log(`UPDATED    ${rel} [${key}] — live version ported into seed (was different)`);
        }
    }
    // Same ID, different SECTION: a kind change in live is a deliberate
    // reclassification — the live placement wins. The seed entry is dropped
    // from its old section and appended under the live heading (the move
    // carries the live text, so it is excluded from the in-place replace).
    const moves = new Map(); // id -> { heading, entry } (live target)
    for (const [key, s] of seedMap) {
        const l = liveMap.get(key);
        if (l && s.entry.id && l.heading !== s.heading) {
            moves.set(s.entry.id, { heading: l.heading, entry: l.entry });
            replace.delete(key);
            console.log(`MOVED      ${rel} [${s.entry.id}] — ${s.heading} -> ${l.heading}`);
        }
    }
    if (missing.length === 0 && replace.size === 0 && moves.size === 0) continue;

    // Rebuild the seed text: missing live entries appended at the end of their
    // section, replaced entries swapped in place, moved entries dropped here
    // and re-appended under their live section heading.
    const out = [];
    let current = null;
    const seenHeadings = new Set();
    // Per-heading append list in LIVE file order (missing + moved entries).
    const appendFor = (heading) => (live.sections.get(heading) ?? []).filter((e) => {
        const isMissing = missing.some((m) => m.entry === e && !m.done);
        const isMoved = e.id !== null && moves.has(e.id) && !moves.get(e.id).done;
        return isMissing || isMoved;
    });
    const flushSection = (heading) => {
        const toAppend = appendFor(heading);
        if (toAppend.length === 0) return;
        for (const e of toAppend) {
            while (out.length && out[out.length - 1].trim() === "") out.pop();
            if (out.length) out.push("");
            out.push(...e.block.map((x) => x.trimEnd()));
            const m = missing.find((x) => x.entry === e);
            if (m) m.done = true;
            if (e.id !== null && moves.has(e.id)) moves.get(e.id).done = true;
        }
        // Keep the blank separator between appended entries and the next heading
        // (for the final section this collapses to the file's trailing newline).
        out.push("");
    };
    let skippingEntry = false;
    let pendingBlank = false;
    for (const line of seedText.replace(/\r\n/g, "\n").split("\n")) {
        if (skippingEntry) {
            // Continuation of a replaced entry: indented or blank lines.
            if (line.startsWith("  ")) continue;
            if (line.trim() === "") { pendingBlank = true; continue; }
            skippingEntry = false;
            if (pendingBlank && out.length && out[out.length - 1].trim() !== "") out.push("");
            pendingBlank = false;
            // fall through: handle this line normally
        }
        if (line.startsWith("## ")) {
            if (current !== null) flushSection(current);
            current = line.trim();
            seenHeadings.add(current);
            out.push(line);
            continue;
        }
        const id = (line.match(/^- \[([^\]]+)\]/) || [])[1];
        if (line.startsWith("- ") && id !== undefined && moves.has(id)) {
            // A moved entry: drop the seed copy entirely; flushSection re-appends
            // the live block under the live heading.
            skippingEntry = true;
            continue;
        }
        if (line.startsWith("- ") && id !== undefined && replace.has(id)) {
            out.push(...replace.get(id).block.map((x) => x.trimEnd()));
            skippingEntry = true;
            continue;
        }
        out.push(line);
    }
    if (skippingEntry && pendingBlank && out.length && out[out.length - 1].trim() !== "") out.push("");
    if (current !== null) flushSection(current);
    // A section heading the seed file lacks entirely (eg the entry tools moved
    // an entry to a section the seed never had): append it as a new section at
    // the end of the file, in live section order.
    for (const [heading] of live.sections) {
        if (seenHeadings.has(heading)) continue;
        if (appendFor(heading).length === 0) continue;
        while (out.length && out[out.length - 1].trim() === "") out.pop();
        if (out.length) out.push("");
        out.push(heading, "");
        flushSection(heading);
        console.log(`NEW SECTION ${rel} "${heading}" — not in the seed file, appended at the end`);
    }
    for (const m of missing) {
        if (!m.done) console.log(`WARN       ${rel} [${m.entry.key}] — heading "${m.heading}" not in seed file, skipped`);
    }
    for (const [, mv] of moves) {
        if (!mv.done) console.log(`WARN       ${rel} [${mv.entry.id}] — move target heading "${mv.heading}" not applied`);
    }

    const parts = [];
    if (missing.length) parts.push(`+${missing.length} entr${missing.length === 1 ? "y" : "ies"}: ${missing.map((m) => m.entry.id ?? "?").join(", ")}`);
    if (replace.size) parts.push(`${replace.size} updated`);
    if (moves.size) parts.push(`${moves.size} moved`);
    console.log(`MERGE      ${rel} ${parts.join(", ")}`);
    let text = out.join("\n");
    if (!text.endsWith("\n")) text += "\n"; // preserve the trailing-newline convention
    planned.push({ seedPath, text });
    merged += missing.length;
    updated += replace.size;
    moved += moves.size;
}

// Top-level fixed docs: report only (maintainer docs, curated by hand).
for (const doc of ["codex-rules.md", "thought-and-action-guidance.md", "markdown-guidance.md"]) {
    const l = readFileSync(join(LIVE, doc), "utf8").replace(/\r\n/g, "\n");
    const s = readFileSync(join(SEED, doc), "utf8").replace(/\r\n/g, "\n");
    console.log(`TOP-LEVEL  ${doc}: ${l === s ? "identical" : "DIFFERS (fixed maintainer doc — not synced, review manually)"}`);
}

console.log(`\n${copied} new topic file(s), ${merged} entr(ies) to merge, ${updated} entr(ies) updated (live text won), ${moved} entr(ies) moved section, 0 conflicts left.`);
if (APPLY) {
    for (const p of planned) {
        mkdirSync(dirname(p.seedPath), { recursive: true });
        writeFileSync(p.seedPath, p.text);
    }
    console.log(`APPLIED — wrote ${planned.length} seed file(s).`);
} else {
    console.log("DRY RUN — re-run with --apply to write.");
}
process.exit(0);

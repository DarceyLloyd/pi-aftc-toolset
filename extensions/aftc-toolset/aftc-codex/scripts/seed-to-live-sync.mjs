/**
 * seed-to-live-sync.mjs — NON-DESTRUCTIVE shipped-seed -> live codex update.
 *
 * The reverse of live-to-seed-sync.mjs, and the non-destructive alternative to
 * /codex-install (which wipes the live codex): merges what the shipped seed
 * gained into the user's live codex WITHOUT touching anything the user has.
 * Wired to the /codex-sync command (store.runSeedToLiveSync).
 *
 * Usage: node seed-to-live-sync.mjs [--live <dir>] [--seed <dir>]
 *   (the --live/--seed overrides exist for tests; the command uses neither)
 *
 * Rules (mirror live-to-seed, direction flipped):
 *   - Seed topic files missing from the live copy are copied WHOLE (new topics).
 *   - Seed entries missing from a live topic file (keyed by their [ID]) are
 *     appended at the END of the matching section (Rules / Gotchyas /
 *     Issues & Solutions).
 *   - Live-only entries are KEPT (never deleted — that is the point).
 *   - Same-ID-different-text is reported as a CONFLICT and the LIVE version is
 *     kept, never auto-overwritten.
 *   - codex-resource-list.md is GENERATED — never copied.
 *   - Top-level fixed docs (codex-rules.md etc. — maintainer-curated, never
 *     learned into) are updated to the seed version when they differ.
 *
 * Paths resolve exactly like the extension: live = <AFTC_TOOLSET_DATA_ROOT or
 * OS data dir>/pi-aftc-toolset/data/aftc-codex; seed = the data/aftc-codex dir
 * relative to this script.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

setTimeout(() => { console.error("timeout"); process.exit(2); }, 20_000).unref();

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

if (!existsSync(LIVE)) {
    console.log("Live codex not found — nothing to sync into. Run /codex-install first.");
    process.exit(0);
}
if (!existsSync(SEED)) {
    console.log("Shipped seed not found — cannot sync (broken install).");
    process.exit(0);
}

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
 *  trailing blank lines stripped). Identical to live-to-seed-sync.mjs. */
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

const seedFiles = walk(join(SEED, "resources"));
const planned = [];
let copied = 0, merged = 0, conflicts = 0;

for (const rel of seedFiles) {
    if (rel === "codex-resource-list.md") continue; // generated, never copied
    const seedPath = join(SEED, "resources", rel);
    const livePath = join(LIVE, "resources", rel);
    const seedText = readFileSync(seedPath, "utf8");

    if (!existsSync(livePath)) {
        console.log(`NEW TOPIC  ${rel} (copied whole)`);
        planned.push({ livePath, text: seedText.replace(/\r\n/g, "\n") });
        copied++;
        continue;
    }

    const seed = parse(seedText);
    const liveText = readFileSync(livePath, "utf8");
    const live = parse(liveText);
    const seedMap = keyedEntries(seed.sections);
    const liveMap = keyedEntries(live.sections);

    const missing = [];
    for (const [h, entries] of seed.sections) {
        for (const e of entries) if (!liveMap.has(e.key)) missing.push({ heading: h, entry: e });
    }
    for (const [key, s] of seedMap) {
        const l = liveMap.get(key);
        if (l && l.entry.text !== s.entry.text) {
            conflicts++;
            console.log(`CONFLICT   ${rel} [${key}] — same ID, different text (kept YOUR live version, review manually)`);
        }
    }
    if (missing.length === 0) continue;

    // Rebuild the live text with the missing seed entries appended at the end
    // of their section. Live-only entries stay exactly where they are.
    const out = [];
    let current = null;
    const flushSection = (heading) => {
        let appended = false;
        for (const m of missing.filter((x) => x.heading === heading)) {
            while (out.length && out[out.length - 1].trim() === "") out.pop();
            if (out.length) out.push("");
            out.push(...m.entry.block.map((x) => x.trimEnd()));
            m.done = true;
            appended = true;
        }
        // Keep the blank separator between appended entries and the next heading
        // (for the final section this collapses to the file's trailing newline).
        if (appended) out.push("");
    };
    for (const line of liveText.replace(/\r\n/g, "\n").split("\n")) {
        if (line.startsWith("## ")) {
            if (current !== null) flushSection(current);
            current = line.trim();
        }
        out.push(line);
    }
    if (current !== null) flushSection(current);
    for (const m of missing) {
        if (!m.done) console.log(`WARN       ${rel} [${m.entry.key}] — heading "${m.heading}" not in live file, skipped`);
    }

    console.log(`MERGE      ${rel} +${missing.length} entr${missing.length === 1 ? "y" : "ies"}: ${missing.map((m) => m.entry.id ?? "?").join(", ")}`);
    let text = out.join("\n");
    if (!text.endsWith("\n")) text += "\n"; // preserve the trailing-newline convention
    planned.push({ livePath, text });
    merged += missing.length;
}

// Top-level fixed docs (codex-rules.md, guidance): maintainer-curated, never
// learned into — the seed version IS the update, so bring the live copy up to
// date when they differ.
let topLevelUpdated = 0;
try {
    for (const name of readdirSync(SEED).filter((n) => n.toLowerCase().endsWith(".md"))) {
        const seedPath = join(SEED, name);
        const livePath = join(LIVE, name);
        const s = readFileSync(seedPath, "utf8").replace(/\r\n/g, "\n");
        const l = existsSync(livePath) ? readFileSync(livePath, "utf8").replace(/\r\n/g, "\n") : null;
        if (l === s) {
            console.log(`TOP-LEVEL  ${name}: identical`);
            continue;
        }
        planned.push({ livePath, text: s });
        topLevelUpdated++;
        console.log(`TOP-LEVEL  ${name}: ${l === null ? "missing — copied" : "updated to the shipped version"}`);
    }
} catch (err) {
    console.log(`TOP-LEVEL  skipped (error: ${err && err.message ? err.message : String(err)})`);
}

console.log(`\n${copied} new topic file(s), ${merged} entr(ies) merged, ${topLevelUpdated} top-level doc(s) updated, ${conflicts} conflict(s).`);
for (const p of planned) {
    mkdirSync(dirname(p.livePath), { recursive: true });
    writeFileSync(p.livePath, p.text);
}
console.log(`APPLIED — wrote ${planned.length} live file(s). Your learned entries were not touched.`);
process.exit(0);

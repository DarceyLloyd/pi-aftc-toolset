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
 *   - Same-ID-different-text: the live copy keeps a sync manifest
 *     (codex-live-manifest.json) recording which entries still matched the
 *     shipped text at the last sync. Entries the USER has not touched are
 *     UPDATED to the new shipped text (so shipped improvements reach users);
 *     entries the user HAS edited (or that predate the manifest) keep the
 *     user's version and are reported as a CONFLICT — user edits are sacred.
 *   - codex-resource-list.md is GENERATED — never copied.
 *   - Top-level fixed docs (codex-rules.md etc. — maintainer-curated, never
 *     learned into) are updated to the seed version when they differ.
 *
 * Paths resolve exactly like the extension: live = <AFTC_TOOLSET_DATA_ROOT or
 * OS data dir>/pi-aftc-toolset/data/aftc-codex; seed = the data/aftc-codex dir
 * relative to this script.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");

// Sync manifest: records, per shipped entry ("<rel>#<id>"), the hash of the
// live text at the last sync and whether the user owns a divergent version.
//   { h: <sha256>, u: true }  -> user-edited; NEVER auto-updated.
//   { h: <sha256>, u: false } -> matched shipped at last sync; safe to update
//                                while the live text still equals h.
const MANIFEST = join(LIVE, "codex-live-manifest.json");
let manifest = {};
try {
    const decoded = JSON.parse(readFileSync(MANIFEST, "utf8"));
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) manifest = decoded;
} catch { /* first sync after this feature ships: no manifest yet */ }

const seedFiles = walk(join(SEED, "resources"));
const planned = [];
let copied = 0, merged = 0, updated = 0, conflicts = 0;

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
    // Same ID, different text. The manifest tells us whether the user touched
    // the live entry since the last sync: untouched -> update to the shipped
    // text; touched (or untracked) -> keep the user's version.
    const replace = new Map(); // key -> seed entry block
    for (const [key, s] of seedMap) {
        const l = liveMap.get(key);
        if (!l || l.entry.text === s.entry.text) continue;
        const mkey = `${rel}#${key}`;
        const rec = manifest[mkey];
        if (rec && rec.u !== true && rec.h === sha(l.entry.text)) {
            replace.set(key, s.entry);
            updated++;
            console.log(`UPDATED    ${rel} [${key}] — updated to the shipped version (you had not edited it)`);
        } else {
            conflicts++;
            console.log(`CONFLICT   ${rel} [${key}] — same ID, different text (kept YOUR live version, review manually)`);
        }
    }
    if (missing.length === 0 && replace.size === 0) continue;

    // Rebuild the live text: missing seed entries appended at the end of their
    // section, updated entries swapped in place. Live-only entries stay put.
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
    let skippingEntry = false;
    let pendingBlank = false;
    for (const line of liveText.replace(/\r\n/g, "\n").split("\n")) {
        if (skippingEntry) {
            if (line.startsWith("  ")) continue;
            if (line.trim() === "") { pendingBlank = true; continue; }
            skippingEntry = false;
            if (pendingBlank && out.length && out[out.length - 1].trim() !== "") out.push("");
            pendingBlank = false;
        }
        if (line.startsWith("## ")) {
            if (current !== null) flushSection(current);
            current = line.trim();
            out.push(line);
            continue;
        }
        const id = (line.match(/^- \[([^\]]+)\]/) || [])[1];
        if (line.startsWith("- ") && id !== undefined && replace.has(id)) {
            out.push(...replace.get(id).block.map((x) => x.trimEnd()));
            skippingEntry = true;
            continue;
        }
        out.push(line);
    }
    if (skippingEntry && pendingBlank && out.length && out[out.length - 1].trim() !== "") out.push("");
    if (current !== null) flushSection(current);
    for (const m of missing) {
        if (!m.done) console.log(`WARN       ${rel} [${m.entry.key}] — heading "${m.heading}" not in live file, skipped`);
    }

    const parts = [];
    if (missing.length) parts.push(`+${missing.length} entr${missing.length === 1 ? "y" : "ies"}: ${missing.map((m) => m.entry.id ?? "?").join(", ")}`);
    if (replace.size) parts.push(`${replace.size} updated`);
    console.log(`MERGE      ${rel} ${parts.join(", ")}`);
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

console.log(`\n${copied} new topic file(s), ${merged} entr(ies) merged, ${updated} entr(ies) updated, ${topLevelUpdated} top-level doc(s) updated, ${conflicts} conflict(s).`);
for (const p of planned) {
    mkdirSync(dirname(p.livePath), { recursive: true });
    writeFileSync(p.livePath, p.text);
}

// Rebuild the sync manifest from the post-sync state: for every shipped
// entry, record what the live copy now holds. Entries that match the seed
// are future-update-eligible; divergent ones are marked user-owned so they
// are never auto-overwritten. Entries the seed no longer ships drop out.
const newManifest = {};
for (const rel of seedFiles) {
    if (rel === "codex-resource-list.md") continue;
    const seedPath = join(SEED, "resources", rel);
    const livePath = join(LIVE, "resources", rel);
    if (!existsSync(livePath)) continue; // newly copied whole on a later run
    const seedMap = keyedEntries(parse(readFileSync(seedPath, "utf8")).sections);
    const liveMap = keyedEntries(parse(readFileSync(livePath, "utf8")).sections);
    for (const [key, s] of seedMap) {
        const l = liveMap.get(key);
        if (!l) continue; // missing live entries are appended on the next sync
        const mkey = `${rel}#${key}`;
        if (l.entry.text === s.entry.text) {
            newManifest[mkey] = { h: sha(s.entry.text), u: false };
        } else {
            // Divergent (user edit kept, or first-run unknown): user-owned —
            // never auto-updated on a future sync.
            newManifest[mkey] = { h: sha(l.entry.text), u: true };
        }
    }
}
try {
    writeFileSync(MANIFEST, JSON.stringify(newManifest, null, 2) + "\n", "utf8");
} catch { /* manifest is an optimisation — never fail the sync over it */ }

console.log(`APPLIED — wrote ${planned.length} live file(s). Your learned entries were not touched.`);
process.exit(0);

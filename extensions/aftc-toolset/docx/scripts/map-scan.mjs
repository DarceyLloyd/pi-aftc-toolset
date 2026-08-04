#!/usr/bin/env node
/**
 * docx map-scan — deterministic reconnaissance for /docx generation.
 *
 * The model runs this at guide STEP 1 instead of walking the tree itself:
 *   node <extension>/docx/scripts/map-scan.mjs <projectRoot>
 *
 * Prints a recon skeleton to stdout:
 *   1. Directory tree (dirs + notable files), honouring the guide's
 *      exclusion list, depth- and entry-capped.
 *   2. Manifest inventory: every dependency manifest found, with exact
 *      dependency versions, script names, entry hints.
 *   3. Container inventory: Dockerfiles, compose files + service names.
 *   4. Test surfaces: test dirs, test scripts, CI files.
 *
 * The model assigns structure-map IDs and writes the docs; this script
 * only reads. Pure Node stdlib, no shell, self-terminating.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";

// Self-terminating guard (AGENTS.md: no script may hold a session open).
const watchdog = setTimeout(() => {
    console.error("map-scan: exceeded 55s internal timeout");
    process.exit(2);
}, 55_000);
watchdog.unref();

const EXCLUDED_DIRS = new Set([
    "node_modules", "vendor", "bower_components", "dist", "build", "out",
    "target", ".next", ".nuxt", ".svelte-kit", ".turbo", ".parcel-cache",
    ".gradle", "__pycache__", ".pytest_cache", ".venv", "venv", "env",
    "Pods", "DerivedData", ".idea", ".vscode", ".git", ".hg", ".svn",
    "coverage", ".cache", ".tmp", "tmp", "old_docs_backup", "old",
    ".bak", ".old",
]);

const MAX_DEPTH = 8;
const MAX_ENTRIES = 8000;
const MAX_MANIFESTS = 60;

const MANIFEST_NAMES = new Set([
    "package.json", "composer.json", "pyproject.toml", "cargo.toml",
    "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "gemfile",
    "mix.exs", "deno.json", "deno.jsonc", "project.godot",
]);

const root = resolve(process.argv[2] || ".");
if (!existsSync(root)) {
    console.error(`map-scan: project root not found: ${root}`);
    process.exit(1);
}

let visited = 0;
const treeLines = [];
const manifests = [];
const dockerfiles = [];
const composeFiles = [];
const testSurfaces = [];
const ciFiles = [];

function isTestDir(name) {
    return /^(tests?|e2e|spec|specs|__tests__|cypress|playwright)$/i.test(name);
}

function walk(dir, depth, prefix) {
    if (depth > MAX_DEPTH || visited >= MAX_ENTRIES) return;
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    const visible = entries.filter((e) => {
        if (e.name.startsWith(".") && e.isDirectory()) return false;
        if (e.isDirectory() && EXCLUDED_DIRS.has(e.name)) return false;
        return true;
    });

    for (let i = 0; i < visible.length; i++) {
        if (visited >= MAX_ENTRIES) return;
        const entry = visible[i];
        const last = i === visible.length - 1;
        const full = join(dir, entry.name);
        visited++;

        if (entry.isDirectory()) {
            treeLines.push(`${prefix}${last ? "\\-" : "|-"}${entry.name}/`);
            if (isTestDir(entry.name)) {
                testSurfaces.push(relative(root, full));
            }
            walk(full, depth + 1, `${prefix}${last ? "  " : "| "}`);
            continue;
        }

        const lower = entry.name.toLowerCase();
        const rel = relative(root, full);
        if (MANIFEST_NAMES.has(lower) || lower.endsWith(".csproj")) {
            manifests.push(rel);
            treeLines.push(`${prefix}${last ? "\\-" : "|-"}${entry.name}`);
        } else if (lower === "dockerfile" || lower.startsWith("dockerfile.")) {
            dockerfiles.push(rel);
            treeLines.push(`${prefix}${last ? "\\-" : "|-"}${entry.name}`);
        } else if (/^docker-compose.*\.ya?ml$/.test(lower) || lower === "compose.yml" || lower === "compose.yaml") {
            composeFiles.push(rel);
            treeLines.push(`${prefix}${last ? "\\-" : "|-"}${entry.name}`);
        } else if (/^\.(github|gitlab|azure|circleci)/.test(rel) && /\.(ya?ml|toml)$/.test(lower)) {
            ciFiles.push(rel);
        } else if (/\.(test|spec|e2e)\.[jt]sx?$/.test(lower)) {
            testSurfaces.push(rel);
        }
        // Ordinary files are omitted from the tree: the map documents
        // structure, not every file.
    }
}

function summarizePackageJson(file) {
    try {
        const pkg = JSON.parse(readFileSync(file, "utf8"));
        const lines = [];
        if (pkg.name) lines.push(`  name: ${pkg.name}${pkg.version ? `@${pkg.version}` : ""}`);
        if (pkg.main) lines.push(`  main: ${pkg.main}`);
        if (pkg.bin) lines.push(`  bin: ${JSON.stringify(pkg.bin)}`);
        for (const key of ["dependencies", "devDependencies"]) {
            const deps = pkg[key];
            if (!deps || typeof deps !== "object") continue;
            const names = Object.keys(deps);
            if (names.length === 0) continue;
            lines.push(`  ${key} (${names.length}):`);
            for (const n of names.slice(0, 40)) {
                lines.push(`    ${n}: ${deps[n]}`);
            }
            if (names.length > 40) lines.push(`    ... +${names.length - 40} more`);
        }
        if (pkg.scripts && typeof pkg.scripts === "object") {
            lines.push(`  scripts: ${Object.keys(pkg.scripts).join(", ")}`);
        }
        return lines.join("\n");
    } catch (err) {
        return `  <unparseable: ${err.message}>`;
    }
}

function summarizeTextManifest(file) {
    try {
        const text = readFileSync(file, "utf8");
        const lines = [];
        const name = text.match(/^\s*name\s*[=:]\s*["']?([^"'\s]+)/m);
        const version = text.match(/^\s*version\s*[=:]\s*["']?([^"'\s,]+)/m);
        if (name) lines.push(`  name: ${name[1]}`);
        if (version) lines.push(`  version: ${version[1]}`);
        // require / dependencies blocks (composer / cargo / pyproject)
        const depBlock = text.match(/^\s*\[?(require|dependencies|\[dependencies\])\]?/m);
        if (depBlock) lines.push("  (dependency block present — read the manifest for versions)");
        return lines.length > 0 ? lines.join("\n") : "  (no name/version found — read the manifest)";
    } catch (err) {
        return `  <unreadable: ${err.message}>`;
    }
}

function composeServices(file) {
    try {
        const text = readFileSync(file, "utf8");
        const servicesMatch = text.match(/^services:\s*$/m);
        if (!servicesMatch) return [];
        const after = text.slice(servicesMatch.index);
        const names = [];
        for (const line of after.split("\n").slice(1)) {
            const m = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
            if (m) names.push(m[1]);
            else if (line.trim() !== "" && !line.startsWith("  ")) break;
            else if (/^ {2}\S/.test(line) && !/:$/.test(line)) continue;
        }
        return names;
    } catch {
        return [];
    }
}

// ── run ──────────────────────────────────────────────────────────────────────

console.log(`# docx map-scan: ${root}`);
console.log("");

treeLines.push(`${basename(root)}/`);
walk(root, 0, "");
console.log("## Directory tree (dirs + notable files; exclusions honoured)");
console.log("");
console.log(treeLines.join("\n"));
if (visited >= MAX_ENTRIES) console.log(`\n[truncated at ${MAX_ENTRIES} entries]`);

console.log("\n## Manifest inventory");
if (manifests.length === 0) {
    console.log("(none found)");
}
for (const rel of manifests.slice(0, MAX_MANIFESTS)) {
    console.log(`\n### ${rel}`);
    const full = join(root, rel);
    console.log(
        extname(rel) === ".json"
            ? summarizePackageJson(full)
            : summarizeTextManifest(full),
    );
}

console.log("\n## Containers");
if (dockerfiles.length === 0 && composeFiles.length === 0) {
    console.log("(none found)");
}
for (const rel of dockerfiles) console.log(`Dockerfile: ${rel}`);
for (const rel of composeFiles) {
    const services = composeServices(join(root, rel));
    console.log(`Compose: ${rel} — services: ${services.length > 0 ? services.join(", ") : "(parse manually)"}`);
}

console.log("\n## Test surfaces");
console.log(testSurfaces.length > 0 ? testSurfaces.join("\n") : "(none found)");

console.log("\n## CI files");
console.log(ciFiles.length > 0 ? ciFiles.join("\n") : "(none found)");

console.log("\n# End of scan. Treat this as recon INPUT: verify claims against source before documenting them.");
process.exit(0);

// Bulk-read skill harness.
// Verifies that the bundled bulk-read Node.js script:
//   1. Extracts cleanly from skills/bulk-read/SKILL.md
//   2. Has valid JavaScript syntax
//   3. Walks the project and produces a manifest + file list + per-file sections
//   4. Skips noise directories and binary files
//   5. Uses FILE: <abs-path> headers and fenced code blocks
//   6. Respects --maxBytesKB argument
//   7. Runs cross-platform (pure stdlib, no native deps)
//
// Resolves paths from the script itself so it runs from any cwd.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

// ---- Resolve the bundled script source from the SKILL.md ----
const skillPath = join(ROOT, "skills", "bulk-read", "SKILL.md");
if (!existsSync(skillPath)) throw new Error("missing skill: " + skillPath);
const md = readFileSync(skillPath, "utf8");

const scriptStart = md.lastIndexOf("```javascript\n");
const scriptEnd = md.lastIndexOf("```");
if (scriptStart < 0 || scriptEnd <= scriptStart) {
    throw new Error("could not locate javascript fence in SKILL.md");
}
const script = md.slice(scriptStart + "```javascript\n".length, scriptEnd);

// ---- 1. Syntax check ----
// Strip shebang for syntax check (shebang is harmless when running via `node`).
const stripped = script.replace(/^#!.*\n/, "");
try {
    new Function(stripped);
    console.log("OK script syntax valid");
} catch (e) {
    throw new Error("script syntax error: " + e.message);
}

// ---- 2. Write script to a temp location and run it ----
const tmpDir = join(ROOT, ".pi-aftc-toolset", "data");
mkdirSync(tmpDir, { recursive: true });
const scriptPath = join(tmpDir, "_bulk-read-test.js");
const outFile = join(tmpDir, "_bulk-read-test-output.md");
writeFileSync(scriptPath, script, "utf8");

try {
    // Run on a known subdirectory (extensions/toolset) to keep the test fast.
    const subdir = "extensions/toolset";
    const maxKb = "2048";
    const stdout = execFileSync(process.execPath, [scriptPath, subdir, outFile, maxKb], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("Script stdout:", stdout.trim());

    if (!existsSync(outFile)) throw new Error("output file not created");
    const out = readFileSync(outFile, "utf8");

    // ---- 3. Verify manifest ----
    if (!/^# Bulk Read:/m.test(out)) throw new Error("manifest heading missing");
    if (!/Files included:/m.test(out)) throw new Error("manifest counts missing");
    if (!/Skipped \(binary\):/m.test(out)) throw new Error("manifest skipped counts missing");
    if (!/## File list/m.test(out)) throw new Error("file list section missing");

    const incMatch = out.match(/Files included:\s*(\d+)/);
    const inc = incMatch ? parseInt(incMatch[1], 10) : 0;
    if (inc < 5) throw new Error("expected at least 5 files in extensions/toolset, got " + inc);
    console.log("OK manifest present, " + inc + " files included");

    // ---- 4. Verify FILE: headers + fenced code blocks ----
    const fileHeaders = out.match(/^FILE: .+$/gm) || [];
    if (fileHeaders.length !== inc) {
        throw new Error(
            "FILE: header count (" + fileHeaders.length + ") does not match included count (" + inc + ")",
        );
    }
    console.log("OK " + fileHeaders.length + " FILE: headers match included count");

    // Spot check: at least one known file should be present with its real content.
    if (!out.includes("FILE: " + resolve(ROOT, "extensions/toolset/index.ts"))) {
        throw new Error("expected index.ts to be in output");
    }
    if (!out.includes("createCore")) {
        throw new Error("expected core.ts content (createCore) to be present in output");
    }
    console.log("OK known file content present");

    // ---- 5. Verify absolute paths (Windows or POSIX) ----
    const allPaths = fileHeaders.map((l) => l.replace(/^FILE: /, ""));
    const allAbsolute = allPaths.every((p) => /^([A-Z]:\\|\/)/i.test(p));
    if (!allAbsolute) {
        throw new Error("expected all FILE: paths to be absolute");
    }
    console.log("OK all paths absolute");

    // ---- 6. Verify fences are well-formed (open + close per file) ----
    // Each file produces at least one opening ```lang and one closing
    // ```. Files with embedded fences inside their content (e.g. .md
    // docs with code blocks, or .ts files with regex/string literals)
    // contribute extra inner fences, so the total is a lower bound
    // of 2 * fileCount, not a strict multiple of 3 (the +1 was for an
    // old scroll-info line). Verify the minimum: at least 2 per file.
    const fences = out.match(/^```/gm) || [];
    if (fences.length < 2 * fileHeaders.length) {
        throw new Error("fence count " + fences.length + " is less than 2 * " + fileHeaders.length + " (open + close minimum per file)");
    }
    console.log("OK fences balanced (open + close per file, " + fences.length + " total for " + fileHeaders.length + " files)");

    // ---- 7. Verify noise dirs are skipped ----
    const hasNodeModules = fileHeaders.some((l) => l.includes("node_modules"));
    if (hasNodeModules) throw new Error("node_modules should have been skipped");
    if (out.includes("FILE: " + resolve(ROOT, ".git"))) {
        throw new Error(".git should have been skipped");
    }
    console.log("OK noise dirs (node_modules, .git) skipped");

    // ---- 8. Verify default output path pattern includes bulk-read-<timestamp>.md ----
    if (!/bulk-read-'\s*\+\s*new Date\(\)\.toISOString/.test(script)) {
        throw new Error("default output filename should include a timestamp");
    }
    console.log("OK default output filename includes timestamp");

    // ---- 9. Verify cross-platform path handling (no shell-specific syntax) ----
    if (/\brm\s+-rf\b/.test(script)) throw new Error("script uses shell rm - avoid shell");
    if (/process\.platform\s*===\s*['"]win32['"]/.test(script)) {
        // OK if intentional; just flag.
    }
    if (!script.includes("path.resolve") || !script.includes("path.join")) {
        throw new Error("script should use path.resolve / path.join for cross-platform paths");
    }
    console.log("OK script uses path.resolve / path.join (cross-platform)");

    // ---- 10. Verify size cap argument is honored ----
    // Re-run with a 1 KB cap; should produce very few or no files (extensions files are all > 1 KB).
    const tinyOut = join(tmpDir, "_bulk-read-tiny.md");
    execFileSync(process.execPath, [scriptPath, subdir, tinyOut, "1"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    const tinyContent = readFileSync(tinyOut, "utf8");
    const tinyInc = (tinyContent.match(/^FILE: .+$/gm) || []).length;
    if (tinyInc > 5) {
        throw new Error("tiny cap (1 KB) should skip most files, got " + tinyInc);
    }
    console.log("OK size cap honored (1 KB cap gave " + tinyInc + " files)");

    console.log("\nALL BULK-READ CHECKS PASSED");
} finally {
    // Cleanup test artifacts
    try { rmSync(scriptPath); } catch {}
    try { rmSync(outFile); } catch {}
    try { rmSync(join(tmpDir, "_bulk-read-tiny.md")); } catch {}
}
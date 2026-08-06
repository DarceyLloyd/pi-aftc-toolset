/**
 * pi-aftc-toolset / docx — project documentation generator (`/docx`).
 *
 * One slash command that regenerates a project's full documentation set
 * (per the shipped `documentation_guide.md` in this folder) into
 * `./docx/`, with the previous documentation folded into
 * `./docx/old_docs.zip`.
 *
 * Flow:
 *   1. Context-window gates: ABOVE 25% used /docx flat-out refuses (even
 *      with --yes — compaction mid-generation could corrupt the docs);
 *      at 20%+ (and not --yes) an advisory modal recommends /new first.
 *   2. Confirm modal (skipped by --yes): warns that all previous
 *      documentation is moved into ./docx/old_docs/ (zipped to old_docs.zip
 *      at the end of the run) and advises making a backup first.
 *   3. Project-type selection: the injected prompt is CORE + ONE type
 *      pack (prompts/<key>.md) — never the old all-in-one. TUI: a picker
 *      modal (auto-detect pre-selected). Headless: --type <key>, else
 *      auto-detect, else refuse with the key list.
 *   4. Deterministic backup (docx-backup.ts): moves root .md files,
 *      ./docs/** and any previous ./docx/ output into ./docx/old_docs/
 *      (structure preserved, counts verified). AI context files
 *      (AGENTS.md etc.) are COPIED, not moved — AGENTS.md is edited in
 *      place by the generation run. Any backup error aborts BEFORE the
 *      model is engaged.
 *   5. The guide's core execution prompt (section 18 of the shipped
 *      guide) + the chosen type pack are injected as a user message with
 *      [PROJECT_PATH] / script paths substituted. The model does the
 *      generation; as its final action it runs scripts/zip-old.mjs to
 *      pack docx/old_docs into old_docs.zip.
 *
 * Self-contained feature module: no cross-module imports beyond the
 * shared ui/ + help-registry utilities, wired by index.ts via
 * `createDocx(pi)`.
 *
 * See `docx-readme.md` for the full contract.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
    ExtensionAPI,
    ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import * as aftcConsole from "../ui/aftc-console";
import { showConfirm, showMenu } from "../ui/aftc-ui";
import { registerHelpEntry } from "../help-registry";
import { runDocxBackup, type DocxBackupResult } from "./docx-backup";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/** Advise a fresh session when this much of the context window is already used. */
const CONTEXT_WARN_PERCENT = 20;
/** Flat-out refuse to run when this much is used (compaction-corruption risk). */
const CONTEXT_REFUSE_PERCENT = 25;

interface DocxType {
    /** Pack file stem: prompts/<key>.md and the --type value. */
    key: string;
    label: string;
}

/**
 * The project-type options offered by the picker. Exactly ONE pack is
 * injected (appended to the guide's core prompt) — never the old
 * all-in-one. `generic` is the closest-match fallback for oddballs.
 * Detection order below mirrors detectProjectType().
 */
const DOCX_TYPES: DocxType[] = [
    { key: "web-app", label: "Web application" },
    { key: "basic-website", label: "Basic website" },
    { key: "webgpu-webgl", label: "WebGPU / WebGL app" },
    { key: "desktop-app", label: "Desktop application" },
    { key: "juce-vst", label: "C++ JUCE VST / audio plugin" },
    { key: "mobile-app", label: "Mobile application" },
    { key: "python-app", label: "Python application" },
    { key: "cli-tool", label: "CLI tool / TUI application" },
    { key: "shell-scripts", label: "Shell script collection" },
    { key: "generic", label: "Generic / other" },
];

const DOCX_TYPE_KEYS = DOCX_TYPES.map((t) => t.key);

// ─────────────────────────────────────────────────────────────────────────────
// Project-type detection (heuristic pre-select — the user confirms in the
// picker; headless without --type it is the decider)
// ─────────────────────────────────────────────────────────────────────────────

function detectProjectType(root: string): DocxType | null {
    const has = (rel: string): boolean => {
        try { return fs.existsSync(path.join(root, rel)); } catch { return false; }
    };
    const readText = (rel: string): string => {
        try { return fs.readFileSync(path.join(root, rel), "utf8"); } catch { return ""; }
    };
    const rootNames = (): string[] => {
        try { return fs.readdirSync(root); } catch { return []; }
    };
    const pkgJson = (): Record<string, unknown> | null => {
        try {
            const pkg = JSON.parse(readText("package.json"));
            return pkg && typeof pkg === "object" ? pkg : null;
        } catch { return null; }
    };
    const pkg = has("package.json") ? pkgJson() : null;
    const deps = pkg
        ? Object.keys({
            ...((pkg.dependencies as Record<string, string>) ?? {}),
            ...((pkg.devDependencies as Record<string, string>) ?? {}),
        }).map((d) => d.toLowerCase())
        : [];
    const byKey = (key: string): DocxType => DOCX_TYPES.find((t) => t.key === key) as DocxType;

    // Electron first — its package.json commonly also lists web frameworks.
    if (deps.includes("electron")) return byKey("desktop-app");
    // JUCE: CMake referencing JUCE, or a Projucer project file.
    if (has("CMakeLists.txt") && /juce/i.test(readText("CMakeLists.txt"))) return byKey("juce-vst");
    if (rootNames().some((n) => n.toLowerCase().endsWith(".jucer"))) return byKey("juce-vst");
    // Mobile: Flutter, React Native, or the classic android/+ios/ pair.
    if (has("pubspec.yaml") || deps.includes("react-native") || (has("android") && has("ios"))) return byKey("mobile-app");
    // WebGPU/WebGL engines.
    if (deps.some((d) => d === "three" || d === "babylonjs" || d.startsWith("@babylonjs/"))) return byKey("webgpu-webgl");
    // Web frameworks / PHP backends.
    if (has("composer.json")) return byKey("web-app");
    if (deps.some((d) => ["react", "next", "vue", "nuxt", "svelte", "@angular/core", "express", "fastify", "koa", "@nestjs/core"].includes(d))) return byKey("web-app");
    const compose = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].find(has);
    if (compose && /php|mysql|mariadb|apache/i.test(readText(compose))) return byKey("web-app");
    // Python.
    if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) return byKey("python-app");
    // Native desktop: .NET, JVM, plain C++.
    if (rootNames().some((n) => n.endsWith(".sln") || n.endsWith(".csproj"))) return byKey("desktop-app");
    if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts") || has("CMakeLists.txt")) return byKey("desktop-app");
    // CLI tool: package.json exposing a bin.
    if (pkg && pkg.bin) return byKey("cli-tool");
    // Shell script collections.
    if (rootNames().some((n) => /\.(sh|bash|ps1|bat|cmd)$/i.test(n))) return byKey("shell-scripts");
    // Static site: html at the root, no JS dependency manifest.
    if (rootNames().some((n) => n.toLowerCase().endsWith(".html")) && deps.length === 0) return byKey("basic-website");
    return null;
}

/** Parse --type from the command args ("--type web-app" or "--type=web-app"). */
function parseTypeArg(args: string): string | null {
    const tokens = args.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] === "--type") return tokens[i + 1] ?? null;
        if (tokens[i].startsWith("--type=")) return tokens[i].slice("--type=".length);
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt assembly
// ─────────────────────────────────────────────────────────────────────────────

/** Forward-slash absolute path (safe to quote inside a bash command). */
function slashPath(p: string): string {
    return p.split(path.sep).join("/");
}

/**
 * Extract the section-18 CORE execution prompt (the ```text fenced block)
 * from the shipped guide. The guide is the single source of truth for the
 * core prompt — never duplicate the steps here.
 */
function extractExecutionPrompt(guide: string): string | null {
    const sectionIdx = guide.indexOf("## 18. AI Execution Prompt");
    if (sectionIdx < 0) return null;
    const fenceStart = guide.indexOf("```text", sectionIdx);
    if (fenceStart < 0) return null;
    const bodyStart = guide.indexOf("\n", fenceStart) + 1;
    const fenceEnd = guide.indexOf("```", bodyStart);
    if (fenceEnd < 0) return null;
    return guide.slice(bodyStart, fenceEnd).trim();
}

function buildDocxPrompt(projectRoot: string, backup: DocxBackupResult, type: DocxType): string | null {
    const featureDir = __dirname;
    const guidePath = path.join(featureDir, "documentation_guide.md");
    let guide: string;
    try {
        guide = fs.readFileSync(guidePath, "utf8");
    } catch {
        return null;
    }
    const core = extractExecutionPrompt(guide);
    if (!core) return null;

    // The chosen type pack (read fresh from disk on every run, like the
    // guide). CORE + ONE pack — never the old all-in-one.
    let pack: string;
    try {
        pack = fs.readFileSync(path.join(featureDir, "prompts", `${type.key}.md`), "utf8").trim();
    } catch {
        return null;
    }

    const root = slashPath(path.resolve(projectRoot));
    const script = (name: string): string =>
        slashPath(path.join(featureDir, "scripts", name));

    const prompt = `${core}\n\n---\n\n${pack}`
        .split("[PROJECT_PATH]").join(root)
        .split("[GUIDE_PATH]").join("the guide appended below this prompt")
        .split("[MAP_SCAN_PATH]").join(script("map-scan.mjs"))
        .split("[LINK_AUDIT_PATH]").join(script("link-audit.mjs"))
        .split("[ZIP_OLD_PATH]").join(script("zip-old.mjs"));

    const backupSummary = backup.firstRun
        ? "No pre-existing documentation was found - this is a first-time generation. docx/old_docs/ is empty; skip any step that references it."
        : [
            `Backup completed by the tooling: ${backup.moved.length} file(s) moved into docx/old_docs/ (rel-from-root paths preserved).`,
            backup.copied.length > 0
                ? `${backup.copied.length} AI context file(s) (AGENTS.md etc.) were COPIED into docx/old_docs/ and left in place.`
                : "",
            backup.partnerSkipped.length > 0
                ? `Partner docs left in place (belong to code): ${backup.partnerSkipped.join(", ")}.`
                : "",
            backup.docsLeftovers.length > 0
                ? `./docs/ was kept because non-documentation files remain: ${backup.docsLeftovers.join(", ")}.`
                : "",
            backup.docsDirRemoved ? "./docs/ was fully emptied and removed." : "",
        ].filter(Boolean).join("\n");

    return [
        "You are running /docx (pi-aftc-toolset documentation generator).",
        "",
        `PROJECT TYPE (chosen by the user): ${type.label} [${type.key}] - the matching project-type pack is appended after the core execution prompt below; follow it wherever it sharpens the core.`,
        "",
        "BACKUP STATE (already performed - never move/zip docs yourself):",
        backupSummary,
        "",
        prompt,
        "",
        "---",
        "",
        guide,
    ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Command handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleDocx(
    pi: ExtensionAPI,
    args: string,
    ctx: ExtensionCommandContext,
): Promise<void> {
    const skipConfirm = args.trim().split(/\s+/).includes("--yes");
    const projectRoot = ctx.cwd;

    // 0. Hard gate (applies even with --yes): at 25% or above, a compaction
    //    mid-generation could corrupt the docs — flat-out refuse with a
    //    full-screen info modal (TUI) / a warning line (headless).
    const usage = ctx.getContextUsage();
    if (usage && usage.percent >= CONTEXT_REFUSE_PERCENT) {
        if (ctx.hasUI && ctx.mode === "tui") {
            await showMenu(ctx, {
                title: "/docx — context window too full",
                body: [
                    `Your context window is ${Math.round(usage.percent)}% used.`,
                    "",
                    "/docx will not run when your context window is 25% or above —",
                    "part-way through, pi would compact the conversation, and that",
                    "can corrupt the documentation.",
                    "",
                    "What to do:",
                    "  1. Run /new   (start a fresh session)",
                    "  2. Run /docx again",
                    "",
                    "Press Enter or Esc to close.",
                ],
                items: [{ value: "ok", label: "OK" }],
            });
        } else {
            aftcConsole.warn(
                ctx,
                `/docx refused: your context window is ${Math.round(usage.percent)}% used. ` +
                "/docx will not run at 25% or above — a compaction mid-generation could corrupt the docs. " +
                "Run /new, then /docx.",
            );
        }
        return;
    }

    if (!skipConfirm) {
        if (!ctx.hasUI) {
            aftcConsole.warn(
                ctx,
                "/docx needs interactive confirmation - re-run as /docx --yes to skip the confirmations (headless).",
            );
            return;
        }

        // 1. Context-window advisory. Context USE is modest (measured:
        //    ~5-8% of a 1M window, even large projects stay under 20%) but
        //    the RUN is long — recommend /new first: no compaction risk and
        //    no prior conversation steering the generated docs.
        if (usage.percent >= CONTEXT_WARN_PERCENT) {
            const windowTokens = ctx.model?.contextWindow;
            const windowText = windowTokens
                ? ` of ${windowTokens.toLocaleString()}`
                : "";
            const proceed = await showConfirm(ctx, {
                title: "Context window note",
                body:
                    `Your context window is ${Math.round(usage.percent)}% used${windowText} ` +
                    `(${Math.round(usage.tokens).toLocaleString()} tokens).\n\n` +
                    "/docx uses little context — typically well under 20% even on large\n" +
                    "projects — but it takes a LONG time: the bigger and more complex\n" +
                    "the project, the longer the wait.\n\n" +
                    "Highly advised: /new, then /docx. A fresh session means no\n" +
                    "compaction risk mid-generation and no prior conversation\n" +
                    "steering the docs.",
                yesLabel: "Proceed anyway",
                noLabel: "Exit",
            });
            if (!proceed) return;
        }

        // 2. Main confirmation.
        const confirmed = await showConfirm(ctx, {
            title: "Generate project documentation?",
            body:
                "All existing documentation (root .md files and ./docs/) will be moved to " +
                "./docx/old_docs/ and zipped to ./docx/old_docs.zip when generation completes. " +
                "Make your own backup before proceeding.\n\n" +
                "Expect a LONG wait once it starts — the bigger and more complex the project, " +
                "the longer it takes. Generate fresh documentation for this project?",
            yesLabel: "Yes, proceed",
            noLabel: "No, exit",
        });
        if (!confirmed) {
            aftcConsole.emphasis(ctx, "/docx cancelled - nothing was changed.");
            return;
        }
    }

    // 3. Project type — the injected prompt is CORE + ONE type pack.
    //    Explicit --type wins; TUI shows the picker (auto-detect
    //    pre-selected); headless falls back to auto-detect, then refuses.
    const typeArg = parseTypeArg(args);
    let type: DocxType | null = null;
    if (typeArg !== null) {
        type = DOCX_TYPES.find((t) => t.key === typeArg.toLowerCase()) ?? null;
        if (!type) {
            aftcConsole.warn(
                ctx,
                `/docx: unknown --type "${typeArg}". Valid types: ${DOCX_TYPE_KEYS.join(", ")}.`,
            );
            return;
        }
    } else {
        const detected = detectProjectType(projectRoot);
        if (ctx.hasUI) {
            const initialIndex = detected ? DOCX_TYPES.indexOf(detected) : 0;
            const picked = await showMenu(ctx, {
                title: "/docx — project type",
                body: [
                    "The injected prompt is tailored to the project type (a focused",
                    "type pack is appended to the core prompt - never a giant all-in-one).",
                    "",
                    "Pick the closest match to this project's stack:",
                    ...(detected ? ["", `Auto-detected: ${detected.label} (pre-selected - change if wrong).`] : []),
                ],
                items: DOCX_TYPES.map((t) => ({ value: t.key, label: t.label })),
                initialIndex,
            });
            if (picked === null) {
                aftcConsole.emphasis(ctx, "/docx cancelled - nothing was changed.");
                return;
            }
            type = DOCX_TYPES.find((t) => t.key === picked) ?? null;
        } else {
            if (!detected) {
                aftcConsole.warn(
                    ctx,
                    `/docx: could not auto-detect the project type - re-run with --type <key> (${DOCX_TYPE_KEYS.join(", ")}).`,
                );
                return;
            }
            type = detected;
            aftcConsole.info(ctx, `/docx: project type auto-detected as "${type.label}" - re-run with --type <key> to override.`);
        }
    }
    if (!type) {
        aftcConsole.error(ctx, "/docx: internal error resolving the project type.");
        return;
    }

    // 4. Deterministic backup. Any error aborts BEFORE the model runs.
    let backup: DocxBackupResult;
    try {
        backup = runDocxBackup(projectRoot);
    } catch (err) {
        aftcConsole.error(
            ctx,
            `/docx backup failed: ${(err as Error).message} - generation aborted, nothing was moved.`,
        );
        return;
    }
    if (backup.errors.length > 0) {
        aftcConsole.error(
            ctx,
            `/docx backup incomplete - generation aborted:\n${backup.errors.join("\n")}`,
        );
        return;
    }
    for (const warning of backup.warnings) {
        aftcConsole.warn(ctx, warning);
    }
    if (backup.firstRun) {
        aftcConsole.emphasis(ctx, "/docx: no existing documentation found - first-time generation.");
    } else {
        aftcConsole.emphasis(
            ctx,
            `/docx: ${backup.moved.length} file(s) backed up to docx/old_docs/` +
            (backup.copied.length > 0 ? ` (${backup.copied.length} AI context file(s) copied)` : "") +
            " - zipped to docx/old_docs.zip when generation completes.",
        );
    }

    // 5. Inject the execution prompt (core + chosen type pack).
    const prompt = buildDocxPrompt(projectRoot, backup, type);
    if (!prompt) {
        aftcConsole.error(
            ctx,
            "/docx: documentation_guide.md or the type pack is missing/malformed in the extension package - cannot generate.",
        );
        return;
    }
    try {
        if (ctx.isIdle()) {
            pi.sendUserMessage(prompt);
            if (!ctx.hasUI) {
                // Print/headless mode: pi's sendUserMessage is fire-and-forget
                // and the process exits as soon as this command returns,
                // which would kill the generation turn before it starts.
                // Hold the command open: wait for the turn to start (it is
                // queued asynchronously), then for the agent to settle.
                const startDeadline = Date.now() + 10_000;
                while (ctx.isIdle() && Date.now() < startDeadline) {
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
                await ctx.waitForIdle();
            }
        } else {
            pi.sendUserMessage(prompt, { deliverAs: "followUp" });
        }
        aftcConsole.emphasis(ctx, "/docx: generation started — follow the progress in the transcript. Expect a long wait (the bigger the project, the longer).");
    } catch (err) {
        aftcConsole.error(ctx, `/docx: failed to start generation: ${(err as Error).message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public factory — wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function createDocx(pi: ExtensionAPI): void {
    registerHelpEntry({
        command: "docx",
        args: "[--yes] [--type <key>]",
        description: "Regenerate project docs into ./docx/ (old docs zipped to docx/old_docs.zip)",
        category: "General",
    });

    pi.registerCommand("docx", {
        description:
            "Regenerate the project's full documentation set into ./docx/ per the shipped documentation guide. " +
            "The prompt is tailored by project type (picker, or --type <key>: " + DOCX_TYPE_KEYS.join(", ") + "). " +
            "Existing docs are backed up to docx/old_docs.zip. --yes skips the confirmations (headless).",
        getArgumentCompletions: (prefix: string) => {
            const items = [
                { value: "--yes", label: "--yes", description: "Skip confirmations (headless)" },
                { value: "--type", label: "--type <key>", description: `Project type: ${DOCX_TYPE_KEYS.join(", ")}` },
            ];
            const filtered = items.filter((i) => i.value.startsWith(prefix));
            return filtered.length > 0 ? filtered : null;
        },
        handler: async (args, ctx) => {
            await handleDocx(pi, args, ctx);
        },
    });

    aftcConsole.log("loaded — /docx (project documentation generator)");
}

#!/usr/bin/env node
/**
 * docx ui-hints — shared UI-surface-hint collection for map-scan (recon
 * output) and link-audit (surface-coverage check). One source of truth so
 * the two scripts never drift.
 *
 * A "hint" is a file LIKELY to define a user-facing surface: a template /
 * declarative surface file, or a source file whose name suggests a route /
 * window / screen / dialog / modal / page / controller. Hints are never
 * proof of a surface - the model verifies against source.
 *
 * Pure Node stdlib, no shell.
 */

import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Directory names never walked (guide exclusion list + backup folders). */
export const EXCLUDED_DIRS = new Set([
    "node_modules", "vendor", "bower_components", "dist", "build", "out",
    "target", ".next", ".nuxt", ".svelte-kit", ".turbo", ".parcel-cache",
    ".gradle", "__pycache__", ".pytest_cache", ".venv", "venv", "env",
    "Pods", "DerivedData", ".idea", ".vscode", ".git", ".hg", ".svn",
    "coverage", ".cache", ".tmp", "tmp", "old_docs_backup", "old",
    "old_docs", ".bak", ".old",
]);

export const SURFACE_TEMPLATE_RE = /\.(html?|xaml|axaml|ui|qml|storyboard|blade\.php|twig|phtml|hbs|ejs|njk|mustache|vue|svelte|tscn|scn|fxml)$/i;
export const SURFACE_SOURCE_NAME_RE = /(route|router|screen|window|dialog|modal|wizard|page|editor|designer|controller|view)/i;
export const SURFACE_SOURCE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cs|java|kt|cpp|cc|cxx|h|hpp|py|php|gd|swift|dart|rb|go|rs)$/i;
const TEST_FILE_RE = /\.(test|spec|e2e)\.[jt]sx?$/i;

const MAX_DEPTH = 8;
const MAX_ENTRIES = 8000;

/**
 * Collect UI surface hints under root. Returns forward-slash relative
 * paths in two families, capped at maxHints in total.
 *   { templates: string[], sources: string[], truncated: boolean }
 */
export function collectUiHints(root, maxHints = 400) {
    const templates = [];
    const sources = [];
    let visited = 0;

    const walk = (dir, depth) => {
        if (depth > MAX_DEPTH || visited >= MAX_ENTRIES) return;
        if (templates.length + sources.length >= maxHints) return;
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (visited >= MAX_ENTRIES) return;
            if (templates.length + sources.length >= maxHints) return;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name.startsWith(".") || EXCLUDED_DIRS.has(entry.name)) continue;
                visited++;
                walk(full, depth + 1);
                continue;
            }
            if (!entry.isFile()) continue;
            visited++;
            const lower = entry.name.toLowerCase();
            if (TEST_FILE_RE.test(lower)) continue;
            const rel = relative(root, full).split(sep).join("/");
            if (SURFACE_TEMPLATE_RE.test(lower)) {
                templates.push(rel);
            } else if (SURFACE_SOURCE_EXT_RE.test(lower) && SURFACE_SOURCE_NAME_RE.test(entry.name)) {
                sources.push(rel);
            }
        }
    };

    walk(root, 0);
    return { templates, sources, truncated: templates.length + sources.length >= maxHints };
}

/**
 * pi-aftc-toolset — package/runtime path helpers.
 *
 * Extension-owned runtime files must be anchored to the package root, not to
 * pi's current working directory. pi can be opened from any project folder;
 * using process.cwd() or ctx.cwd for this extension's SQLite/report data would
 * create per-project data folders and break global usage tracking.
 *
 * See `paths.readme.md` for the full path map.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const PACKAGE_NAME = "pi-aftc-toolset";
const MAX_PARENT_WALK = 8;

let packageRootCache: string | null = null;

function hasPackageRootShape(dir: string): boolean {
    const pkgPath = path.join(dir, "package.json");
    if (!fs.existsSync(pkgPath)) return false;
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: unknown };
        if (pkg.name === PACKAGE_NAME) return true;
    } catch {
        // Fall through to structural check below.
    }
    return fs.existsSync(path.join(dir, "extensions", "toolset", "index.ts"));
}

/** Return the pi-aftc-toolset package root that owns this extension. */
export function getPackageRoot(): string {
    if (packageRootCache) return packageRootCache;

    let dir = __dirname;
    for (let i = 0; i < MAX_PARENT_WALK; i++) {
        if (hasPackageRootShape(dir)) {
            packageRootCache = dir;
            return packageRootCache;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    // Normal source/package layout is extensions/toolset/<file>.ts.
    // Fall back to that deterministic package-relative path, never cwd.
    packageRootCache = path.resolve(__dirname, "..", "..");
    return packageRootCache;
}

/** Hidden extension-owned runtime root under the package directory. */
export function getRuntimeRoot(): string {
    return path.join(getPackageRoot(), ".pi-aftc-toolset");
}

/** Directory containing turns.db and report.html. */
export function getDataDir(): string {
    return path.join(getRuntimeRoot(), "data");
}

export function getDbFile(): string {
    return path.join(getDataDir(), "turns.db");
}

export function getReportFile(): string {
    return path.join(getDataDir(), "report.html");
}

export function getGuiDir(): string {
    return path.join(getPackageRoot(), "internal-python-gui");
}

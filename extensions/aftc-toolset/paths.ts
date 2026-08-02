/**
 * pi-aftc-toolset — package/runtime path helpers.
 *
 * Extension-owned runtime files must be anchored to a stable location, not to
 * pi's current working directory. pi can be opened from any project folder;
 * using process.cwd() or ctx.cwd for this extension's SQLite/report data would
 * create per-project data folders and break global usage tracking.
 *
 * Data location (PERMANENT decision — see AGENTS.md "Data directory" section):
 *   The runtime data dir (turns.db, config.json, ssh.json,
 *   report.html) lives in a per-user OS-standard persistent directory OUTSIDE
 *   the installed package, so it survives `pi update --extensions` (which
 *   replaces the whole package dir). Location per platform:
 *     - Windows: %APPDATA%\pi-aftc-toolset\data
 *     - macOS:   ~/Library/Application Support/pi-aftc-toolset/data
 *     - Linux:   $XDG_DATA_HOME/pi-aftc-toolset/data (fallback ~/.local/share/...)
 *   Override with AFTC_TOOLSET_DATA_ROOT (used by tests and power users).
 *
 *   Legacy note: older releases kept this data under
 *   <package-root>/.pi-aftc-toolset/data, which pi wipes on update. On startup
 *   migrateLegacyData() copies any legacy files forward (copy-only, then
 *   best-effort delete) so an in-place upgrade keeps user data whenever the old
 *   dir is still reachable.
 *
 * See `paths-readme.md` for the full path map.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PACKAGE_NAME = "pi-aftc-toolset";

/**
 * Maximum number of parent directories to walk when looking for
 * the package root (or any other ancestor-relative lookup). Exported
 * so other modules (e.g. `install.ts`) reuse the same number instead
 * of duplicating the constant.
 */
export const MAX_PARENT_WALK = 8;

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
    return fs.existsSync(path.join(dir, "extensions", "aftc-toolset", "index.ts"));
}

/** Return the pi-aftc-toolset package root that owns this extension. */
export function getPackageRoot(): string {
    if (packageRootCache) return packageRootCache;

    // First pass: walk up MAX_PARENT_WALK levels (typical source/install
    // layout — the package root is up to 8 levels above the extension
    // file: e.g. node_modules/@scope/pi-aftc-toolset/extensions/aftc-toolset
    // /ssh/carrier/foo.ts is 5 levels above the package root).
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

    // Second pass: walk further up looking for the shape. Some
    // installations (deeply nested pnpm/yarn pnp linker, system-wide
    // extensions) live many levels above the package root. The first
    // pass should catch normal layouts; this is the safety net.
    dir = __dirname;
    for (let i = 0; i < 32; i++) {
        if (hasPackageRootShape(dir)) {
            packageRootCache = dir;
            return packageRootCache;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    // No match found. Throwing is preferable to the previous fallback
    // (`__dirname/../..`), which silently resolved to a wrong directory
    // (e.g. `node_modules` as a package root) and led to misleading
    // errors when the extension tried to read its own files.
    throw new Error(
        `getPackageRoot: could not find the pi-aftc-toolset package root ` +
        `by walking up from ${__dirname}. The package.json or ` +
        `extensions/aftc-toolset/index.ts shape was not found at any parent.`,
    );
}

/** Hidden extension-owned runtime root under the package directory (LEGACY). */
export function getRuntimeRoot(): string {
    return path.join(getPackageRoot(), ".pi-aftc-toolset");
}

/**
 * Per-user persistent root OUTSIDE the installed package. Survives
 * `pi update --extensions`. Honours AFTC_TOOLSET_DATA_ROOT for tests/power users.
 */
export function getPersistentRoot(): string {
    const override = process.env.AFTC_TOOLSET_DATA_ROOT;
    if (override && override.trim()) return path.resolve(override);

    const home = os.homedir();
    if (process.platform === "win32") {
        const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
        return path.join(appData, PACKAGE_NAME);
    }
    if (process.platform === "darwin") {
        return path.join(home, "Library", "Application Support", PACKAGE_NAME);
    }
    const dataHome = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
    return path.join(dataHome, PACKAGE_NAME);
}

/** Directory holding turns.db, config.json, ssh.json, report.html. */
export function getDataDir(): string {
    return path.join(getPersistentRoot(), "data");
}

/** LEGACY data dir inside the package (pre-persistent releases). Migration source. */
export function getLegacyDataDir(): string {
    return path.join(getRuntimeRoot(), "data");
}

export function getDbFile(): string {
    return path.join(getDataDir(), "turns.db");
}

/**
 * Path to config.json — cross-session extension configuration.
 * See `config.ts` for the contract.
 */
export function getConfigJson(): string {
    return path.join(getDataDir(), "config.json");
}

/** Path to local SSH connection credentials. Never add this file to git or npm. */
export function getSshJson(): string {
    return path.join(getDataDir(), "ssh.json");
}


export function getReportFile(): string {
    return path.join(getDataDir(), "report.html");
}

/**
 * Migrate legacy package-local data files into the persistent data dir.
 *
 * Two-phase and lock-safe:
 *   1. Copy forward — any legacy file with no persistent counterpart is copied.
 *      Copying only reads the source, so it succeeds even if a source file is
 *      locked (eg the SQLite DB held open on Windows). A failed copy leaves the
 *      legacy file in place as a fallback and is retried on the next run.
 *   2. Best-effort cleanup — legacy files that now have a persistent copy are
 *      deleted. If a delete fails (file still locked) it is silently retried on
 *      the next pi run, by which point the previous session's handles are
 *      released.
 *
 * Idempotent: safe to call on every startup. Does nothing when the legacy dir
 * is absent. Params are injectable so tests can point at temp dirs (they
 * default to the real legacy/persistent locations).
 */
export function migrateLegacyData(
    legacyDir: string = getLegacyDataDir(),
    newDir: string = getDataDir(),
): void {
    try {
        if (!fs.existsSync(legacyDir)) return;
        const names = fs.readdirSync(legacyDir).filter((name) => {
            try { return fs.statSync(path.join(legacyDir, name)).isFile(); } catch { return false; }
        });
        if (names.length === 0) return;

        fs.mkdirSync(newDir, { recursive: true });

        // Phase 1: copy forward (never overwrites an existing persistent file).
        for (const name of names) {
            const src = path.join(legacyDir, name);
            const dest = path.join(newDir, name);
            if (fs.existsSync(dest)) continue;
            try {
                fs.copyFileSync(src, dest);
            } catch (err) {
                console.log(`[aftc-toolset] migrate: copy ${name} failed: ${(err as Error).message}`);
            }
        }

        // Phase 2: best-effort delete of legacy files that are now persisted.
        for (const name of names) {
            const src = path.join(legacyDir, name);
            const dest = path.join(newDir, name);
            if (fs.existsSync(dest) && fs.existsSync(src)) {
                try { fs.unlinkSync(src); } catch { /* locked — retried next run */ }
            }
        }

        // Tidy the legacy dir (and its now-empty parent) best-effort.
        try {
            if (fs.readdirSync(legacyDir).length === 0) {
                fs.rmdirSync(legacyDir);
                // Remove the empty `.pi-aftc-toolset` parent too, if it is empty.
                const parent = path.dirname(legacyDir);
                if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
                    fs.rmdirSync(parent);
                }
            }
        } catch { /* ignore */ }
    } catch (err) {
        console.log(`[aftc-toolset] migrate: error: ${(err as Error).message}`);
    }
}


/**
 * pi-aftc-toolset — directory navigation feature module.
 *
 * Registers the `/cd` slash command which switches the current Pi
 * session to a different directory.
 *
 * With an argument → one-shot switch (resolves `~`, absolute, relative;
 * creates missing directories after a confirm dialog).
 *
 * With no argument → single-step interactive flow:
 *   Directory-picker overlay opens immediately.
 *     - Header shows the current browsing directory in cyan.
 *     - `..` at top of the listing navigates up one level. At the
 *       drive root, `..` switches to drive listing instead.
 *     - Depth-2 flattening: each entry shows direct children plus
 *       grandchildren, with depth-2 entries labelled "parent/leaf"
 *       to keep collisions readable.
 *     - Left/Right arrows: ← up a level, → drill into a folder
 *       (refresh listing).
 *     - Up/Down arrows: change selection.
 *     - Enter: select the highlighted entry. On `..`, this navigates
 *       up. When the only entry is `..` (target is an empty folder
 *       reached via →), Enter on `..` selects the current folder
 *       (dual-semantics `..` rule — no separate "Select this dir"
 *       entry needed).
 *     - Tab: autocompletes the highlighted entry into the input.
 *     - Esc: cancel without switching.
 *   After the picker: a fresh session is created in the picked
 *   directory via `SessionManager.create`, then `ctx.switchSession`.
 *
 * ---------------------------------------------------------------------------
 * SESSION CLEANUP
 * ---------------------------------------------------------------------------
 * On `session_shutdown` (except `reason === "reload"`), delete the
 * just-left session file if it contains no real user/assistant messages.
 * This makes `/cd` a quiet operation: switching into a fresh directory
 * and walking away without typing → empty session is auto-cleaned.
 *
 * ---------------------------------------------------------------------------
 * CROSS-PLATFORM
 * ---------------------------------------------------------------------------
 * Drive listing uses `fs.readdirSync` to probe A→Z on Windows; POSIX
 * systems return `["/"]` (the single root). Path parsing uses Node's
 * `path` module so separators + drive letters are handled per-OS.
 *
 * Per .dev/dev_guide.md section 1.5, this is a self-contained feature module: no
 * shared state with other feature modules, wired in by `index.ts`.
 *
 * See `cd.readme.md` for the full contract (events, commands,
 * factory signature, failure modes).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	type Focusable,
	fuzzyFilter,
	matchesKey,
	sliceByColumn,
	visibleWidth,
} from "@earendil-works/pi-tui";
import {
	AftcUi,
	defaultAftcPalette,
	showConfirm,
	showMenu,
	terminalRows,
	type AftcPalette,
	type AftcSpan,
} from "./ui/aftcUi";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/** Default depth of descendants shown in the listing (children + N levels).
 * Mutable at runtime via `/cd-set-max-depth`. */
const DEFAULT_MAX_DEPTH = 3;
/** Cache TTL for directory reads (.dev/dev_guide.md section 4.3 intentional persistence). */
const CACHE_TTL_MS = 500;
/** Lower bound exposed by `/cd-set-max-depth`. */
const MIN_DEPTH = 2;
/** Upper bound exposed by `/cd-set-max-depth`. */
const MAX_DEPTH = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — directory resolution + listing + drive detection
// ─────────────────────────────────────────────────────────────────────────────

interface DirEntry {
	value: string;
	label: string;
	description?: string;
	/** Discriminator so confirm/tab can tell `..`, real dirs, and drives apart. */
	kind?: "parent" | "drive" | "dir";
}

// Two-level cache so repeated keystrokes never touch the filesystem.
// Module-scoped and intentionally persistent across sessions — directory
// contents don't need per-session freshness, and the TTL prevents staleness.
const direntCache = new Map<string, { time: number; entries: fs.Dirent[] }>();
const subdirCache = new Map<string, { time: number; entries: DirEntry[] }>();

function readDirCached(dir: string): fs.Dirent[] {
	const now = Date.now();
	const cached = direntCache.get(dir);
	if (cached && now - cached.time < CACHE_TTL_MS) return cached.entries;
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		direntCache.set(dir, { time: now, entries });
		return entries;
	} catch {
		return [];
	}
}

/** Read + sort the immediate subdirectory entries of `dir`. */
function readSubdirsCached(dir: string): DirEntry[] {
	const now = Date.now();
	const cached = subdirCache.get(dir);
	if (cached && now - cached.time < CACHE_TTL_MS) return cached.entries;

	const subdirs: DirEntry[] = [];
	for (const dirent of readDirCached(dir)) {
		if (dirent.name === "." || dirent.name === "..") continue;
		const entry = direntToEntry(dir, dirent);
		if (entry) subdirs.push(entry);
	}
	sortEntries(subdirs);
	subdirCache.set(dir, { time: now, entries: subdirs });
	return subdirs;
}

export function prefetchDirectory(dir: string): void {
	readDirCached(dir);
}

/** Convert a dirent into a DirEntry if it is a (real) directory. */
function direntToEntry(baseDir: string, dirent: fs.Dirent): DirEntry | null {
	let isDir: boolean;
	try {
		// isDirectory() on a Dirent uses the stat info already fetched by
		// readdir, so this is cheap. Symlinks need a follow-up stat.
		if (dirent.isSymbolicLink()) {
			isDir = fs.statSync(path.join(baseDir, dirent.name)).isDirectory();
		} else {
			isDir = dirent.isDirectory();
		}
	} catch {
		return null;
	}
	if (!isDir) return null;
	const full = path.join(baseDir, dirent.name);
	return {
		value: full,
		label: dirent.name + "/",
		description: shortenPath(full),
	};
}

/** Alphabetical, with dotfiles sorted after regular entries. */
function sortEntries(entries: DirEntry[]): void {
	entries.sort((a, b) => {
		const aHidden = a.label.startsWith(".");
		const bHidden = b.label.startsWith(".");
		if (aHidden !== bHidden) return aHidden ? 1 : -1;
		return a.label.localeCompare(b.label);
	});
}

/** Collapse $HOME to `~`. */
function shortenPath(full: string): string {
	const home = os.homedir();
	if (!home) return full;
	if (full === home) return "~";
	if (full.startsWith(home + path.sep)) return "~" + full.slice(home.length);
	return full;
}

function resolveDirectory(input: string, cwd: string): string | null {
	let resolved = input;
	if (input.startsWith("~/") || input === "~") {
		resolved = path.join(os.homedir(), input.slice(1));
	} else if (!path.isAbsolute(input)) {
		resolved = path.resolve(cwd, input);
	}
	resolved = path.normalize(resolved);
	try {
		return fs.statSync(resolved).isDirectory() ? resolved : null;
	} catch {
		return null;
	}
}

/** True if `p` is the root of its drive (Windows) or `/` (POSIX). */
function isRootDrive(p: string): boolean {
	try {
		return path.parse(p).root === p;
	} catch {
		return false;
	}
}

/** Probe A→Z on Windows; return `["/"]` on POSIX. */
function listDrives(): string[] {
	if (process.platform !== "win32") return [path.normalize(path.sep)];
	const drives: string[] = [];
	for (let c = 65; c <= 90; c++) {
		const letter = String.fromCharCode(c);
		const drive = `${letter}:${path.sep}`;
		try {
			fs.readdirSync(drive);
			drives.push(drive);
		} catch {
			// Drive not present / not accessible — skip.
		}
	}
	return drives;
}

/**
 * Depth-limited recursive listing. Walks all descendants of `baseDir`
 * up to `maxDepth` and returns them as a flat array. **No cap on the
 * number of entries returned** — the viewport in `CdOverlay.render`
 * handles scrolling. Capping the listing would prevent the user from
 * navigating back to a deep folder when walking up the tree through
 * a parent directory that has many descendants (e.g. `node_modules/`).
 *
 * The cache (`subdirCache` + `direntCache`, 500ms TTL) ensures the
 * walker only reads the disk once per (dir, 500ms) pair, so the cost
 * of unbounded listings is paid at most twice per second.
 *
 * Labels:
 *   - depth-1: leaf name + "/"  e.g. "src/"
 *   - depth-N: parent/.../leaf + "/" e.g. "src/core/"  (collision-safe)
 *
 * Hidden directories are NOT filtered — we always include them so
 * users can reach dotfolders.
 */
function findDirectoriesAtDepth(
	baseDir: string,
	prefix: string,
	maxDepth: number,
): DirEntry[] {
	// If the user typed a path that resolves to an existing directory,
	// drill into that instead of showing siblings.
	let effectiveBase = baseDir;
	if (prefix.trim().length > 0) {
		const resolved = resolveDirectory(prefix, baseDir);
		if (resolved) effectiveBase = resolved;
	}

	const results: DirEntry[] = [];
	walkDirs(effectiveBase, maxDepth, results);

	// If the typed prefix is NOT itself an existing dir, fuzzy-filter
	// the flat listing against the leaf — useful when the user types
	// part of a deeply-nested folder name. No cap on the result count.
	if (prefix.trim().length > 0 && !resolveDirectory(prefix, baseDir)) {
		const q = prefix.trim();
		return fuzzyFilter(results, q, (e) => e.label.replace(/\/$/, ""));
	}

	return results;
}

/**
 * Breadth-first recursive listing of `baseDir` up to `maxDepth`.
 *
 * BFS (not DFS) so the depth-1 children of `baseDir` are listed
 * BEFORE their grandchildren — otherwise a wide subtree like
 * `node_modules/` or `.git/` dominates the top of the listing and
 * hides the user's actual target directory.
 *
 * Each entry's label is its full relative path from `baseDir`,
 * joined with "/". This makes "src/core/" visually distinct
 * from "tests/core/" regardless of listing depth.
 *
 * No entry-count cap — the viewport in `CdOverlay.render` handles
 * scrolling. The cache (`subdirCache` + `direntCache`, 500ms TTL)
 * ensures the walker only reads the disk once per (dir, 500ms)
 * pair, so the cost of unbounded listings is paid at most twice
 * per second.
 */
function walkDirs(baseDir: string, maxDepth: number, out: DirEntry[]): void {
	// Queue of {absoluteDir, relativePathFromBase, depth}. Start at baseDir.
	const queue: Array<{ dir: string; relPath: string; depth: number }> = [
		{ dir: baseDir, relPath: "", depth: 0 },
	];
	while (queue.length > 0) {
		const item = queue.shift();
		if (!item || item.depth > maxDepth) continue;
		const subdirs = readSubdirsCached(item.dir);
		for (const sub of subdirs) {
			const leaf = path.basename(sub.value);
			const newRelPath =
				item.relPath === "" ? leaf : `${item.relPath}/${leaf}`;
			out.push({
				value: sub.value,
				label: newRelPath + "/",
				kind: "dir",
			});
			if (item.depth < maxDepth) {
				queue.push({
					dir: sub.value,
					relPath: newRelPath,
					depth: item.depth + 1,
				});
			}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// CdOverlay — modal directory picker
// ─────────────────────────────────────────────────────────────────────────────

type PickerResult =
	| { kind: "picked"; directory: string }
	| { kind: "typed"; text: string } // input has text but no matching result; resolve/create as if it were a CLI arg
	| { kind: "cancelled" };

/** Panel + footer lines that always exist around the listing; the list
 * viewport is capped to `terminalRows - CD_CHROME_LINES` so the panel
 * never overflows short terminals. */
const CD_CHROME_LINES = 14;

class CdOverlay implements Focusable {
	readonly width = 110;
	readonly minWidth = 72;
	readonly maxWidth = 160;
	readonly maxResults = 18;
	private readonly title = "📂 Move to directory";

	focused = false;

	// ---- state ----
	private input = "";
	private cursor = 0;
	private inputScrollOffset = 0;
	private selectedIndex = 0;
	/** Index of the first visible row. Adjusted to keep `selectedIndex`
	 * in view as the user navigates. */
	private scrollOffset = 0;
	/** Number of list rows actually painted on the last render. Used by
	 * PageUp/PageDown so each page step matches the visible viewport.
	 * Initialised to 10 as a sane fallback before the first render. */
	private viewportRowCount = 10;

	/** The directory currently being browsed. */
	private currentDir: string;
	/** True when displaying the drives list. */
	private isShowingDrives = false;
	/** Visible entries — drives when `isShowingDrives`, otherwise dirs. */
	private entries: DirEntry[] = [];
	/** Cached render — invalidated on state changes. */
	private cachedWidth?: number;
	private cachedHeight?: number;
	private cachedLines?: string[];
	/** Mutable max descendant depth for the listing (set by `/cd-set-max-depth`). */
	private maxDepth: number;
	/** AFTC UI toolkit facade (fixed GRUB-style palette). */
	private readonly ui: AftcUi;

	constructor(
		cwd: string,
		maxDepth: number,
		private done: (result: PickerResult) => void,
		palette: AftcPalette = defaultAftcPalette(),
	) {
		this.ui = new AftcUi(palette);
		// Resolve to an absolute path so the header never renders `.` / `..`.
		this.currentDir = path.resolve(cwd);
		this.maxDepth = maxDepth;
		this.refreshEntries();
	}

	// ---- input handling ----

	handleInput(data: string): void {
		this.invalidateCache();

		if (matchesKey(data, "escape")) {
			this.done({ kind: "cancelled" });
			return;
		}

		if (matchesKey(data, "tab") && this.entries.length > 0) {
			this.acceptCompletion();
			return;
		}

		// Navigation: arrows first, then enter, then text editing.
		if (matchesKey(data, "up")) {
			this.moveSelection(-1);
			return;
		}
		if (matchesKey(data, "down")) {
			this.moveSelection(1);
			return;
		}

		// PageUp / PageDown: jump by the visible viewport size. The actual
		// step is set by the most recent render() call. No wrap-around —
		// clamping at row 0 / last is the conventional page-nav behaviour.
		if (matchesKey(data, "pageup")) {
			this.moveByPage(-this.viewportRowCount);
			return;
		}
		if (matchesKey(data, "pagedown")) {
			this.moveByPage(this.viewportRowCount);
			return;
		}
		// Ctrl+PgUp / Ctrl+PgDn: jump to first / last entry.
		if (matchesKey(data, "ctrl+pageup")) {
			this.jumpToEdge("top");
			return;
		}
		if (matchesKey(data, "ctrl+pagedown")) {
			this.jumpToEdge("bottom");
			return;
		}

		// Left / Right arrows traverse the tree.
		if (matchesKey(data, "left")) {
			this.navigateUp();
			return;
		}
		if (matchesKey(data, "right")) {
			this.drillIntoSelected();
			return;
		}

		// Enter confirms the selection.
		if (matchesKey(data, "return") || matchesKey(data, "enter")) {
			this.confirmSelection();
			return;
		}

		// Cursor + editing keys (within the input box).
		if (matchesKey(data, "backspace")) {
			this.deleteBackward();
			return;
		}
		if (matchesKey(data, "delete") || matchesKey(data, "ctrl+d")) {
			this.deleteForward();
			return;
		}
		if (matchesKey(data, "ctrl+u")) {
			this.input = this.input.slice(this.cursor);
			this.cursor = 0;
			this.refreshEntries();
			return;
		}
		if (matchesKey(data, "ctrl+k")) {
			this.input = this.input.slice(0, this.cursor);
			this.refreshEntries();
			return;
		}
		if (matchesKey(data, "ctrl+w") || matchesKey(data, "alt+backspace")) {
			this.deleteWordBackward();
			return;
		}
		if (matchesKey(data, "home") || matchesKey(data, "ctrl+a")) {
			this.cursor = 0;
			return;
		}
		if (matchesKey(data, "end") || matchesKey(data, "ctrl+e")) {
			this.cursor = this.input.length;
			return;
		}

		// Plain character → insert.
		if (data.length === 1 && data.charCodeAt(0) >= 32) {
			this.input =
				this.input.slice(0, this.cursor) + data + this.input.slice(this.cursor);
			this.cursor++;
			this.refreshEntries();
		}
	}

	// ---- entry-list operations ----

	/** Refresh `entries` to reflect the current state of `currentDir` / `isShowingDrives` / `input`.
	 * Always resets `selectedIndex` to 0 (top of the listing). The current
	 * folder is prepended as a synthetic "./" entry so the user can pick
	 * it directly with Enter without navigating up a level. */
	private refreshEntries(): void {
		if (this.isShowingDrives) {
			// Drive list. Each entry tagged with `kind: "drive"` so confirm
			// can route correctly.
			const drives = listDrives();
			this.entries = drives.map((d) => ({
				value: d,
				label: d,
				kind: "drive" as const,
			}));
			this.selectedIndex = 0;
			this.scrollOffset = 0;
			return;
		}

		// Dir mode. The current folder is prepended as entry[0] ("./")
		// so the user can select it with Enter without navigating up.
		// Left-arrow remains the only way to go to the parent.
		const found = findDirectoriesAtDepth(this.currentDir, this.input, this.maxDepth);
		const foundDirs = found.map((e) => ({ ...e, kind: "dir" as const }));
		const currentEntry: DirEntry = {
			value: this.currentDir,
			label: "./",
			kind: "dir",
		};
		this.entries = [currentEntry, ...foundDirs];
		this.selectedIndex = 0;
		this.scrollOffset = 0;
		this.clampScroll();
	}

	/**
	 * Keep `selectedIndex` within the visible viewport. Called from
	 * `refreshEntries` (when the entries list changes) and from
	 * `moveSelection` (when the user arrows up/down).
	 */
	private clampScroll(): void {
		if (this.entries.length === 0) {
			this.scrollOffset = 0;
			return;
		}
		// Selection must fit inside the [scrollOffset, scrollOffset + maxResults) window.
		if (this.selectedIndex < this.scrollOffset) {
			this.scrollOffset = this.selectedIndex;
		} else if (this.selectedIndex >= this.scrollOffset + this.maxResults) {
			this.scrollOffset = this.selectedIndex - this.maxResults + 1;
		}
		// Cap scrollOffset so we don't leave empty rows at the bottom.
		const maxStart = Math.max(0, this.entries.length - this.maxResults);
		if (this.scrollOffset > maxStart) this.scrollOffset = maxStart;
		if (this.scrollOffset < 0) this.scrollOffset = 0;
	}

	/** Up-arrow: move within entries. Wraps around at the edges. */
	private moveSelection(delta: number): void {
		const total = this.totalSelectable;
		if (total === 0) return;
		this.selectedIndex = (this.selectedIndex + delta + total) % total;
		this.clampScroll();
	}

	/**
	 * PageUp / PageDown: jump by `delta` rows, clamped to [0, entries.length - 1].
	 * The delta is set to the most recent viewport row count so each page step
	 * matches what the user can actually see. PageUp from row 0 clamps to 0
	 * (no wrap-around — wrapping would be surprising for page navigation).
	 */
	private moveByPage(delta: number): void {
		const total = this.entries.length;
		if (total === 0) return;
		let target = this.selectedIndex + delta;
		if (target < 0) target = 0;
		if (target >= total) target = total - 1;
		this.selectedIndex = target;
		this.clampScroll();
	}

	/** Ctrl+PgUp / Ctrl+PgDn: jump to the first or last entry. */
	private jumpToEdge(edge: "top" | "bottom"): void {
		const total = this.entries.length;
		if (total === 0) return;
		this.selectedIndex = edge === "top" ? 0 : total - 1;
		this.clampScroll();
	}

	/**
	 * Up-arrow / Left-arrow equivalent: navigate up one level.
	 * At the drive root, switch to drives-listing mode (no parent).
	 */
	private navigateUp(): void {
		if (this.isShowingDrives) return; // nowhere to go up from drives
		if (isRootDrive(this.currentDir)) {
			this.showDrives();
			return;
		}
		const parent = path.dirname(this.currentDir);
		this.currentDir = parent;
		this.input = "";
		this.cursor = 0;
		this.refreshEntries();
	}

	/** Right-arrow / drill: open the highlighted entry as a directory.
	 *  If the highlighted folder has no subdirectories, this is a no-op.
	 *  Drilling into the synthetic "./" entry is a no-op (you're already
	 *  in this folder). */
	private drillIntoSelected(): void {
		const entry = this.entries[this.selectedIndex];
		if (!entry) return;
		// Drives mode → drill straight in (drives are always non-empty).
		if (this.isShowingDrives) {
			this.currentDir = entry.value;
			this.isShowingDrives = false;
			this.input = "";
			this.cursor = 0;
			this.refreshEntries();
			return;
		}
		// Don't drill into the synthetic "./" — it would be a no-op since
		// currentDir would not change.
		if (entry.value === this.currentDir) return;
		// Dir mode → only drill if the folder has children. Cheap peek via
		// the two-level cache; treats empty folders as a no-op so the
		// user can never enter a leaf folder via → (per spec).
		const children = readSubdirsCached(entry.value);
		if (children.length === 0) return;
		this.currentDir = entry.value;
		this.input = "";
		this.cursor = 0;
		this.refreshEntries();
	}

	private showDrives(): void {
		this.isShowingDrives = true;
		this.input = "";
		this.cursor = 0;
		this.refreshEntries();
	}

	/** Tab: complete the highlighted entry into the input field. */
	private acceptCompletion(): void {
		const selected = this.entries[this.selectedIndex];
		if (!selected) return;
		// Drives-mode Tab completes to the drive path (e.g. "C:\"). The user
		// can then edit / Enter to use it as a literal path.
		this.input = selected.value;
		this.cursor = this.input.length;
		this.inputScrollOffset = 0;
		this.refreshEntries();
	}

	/** Enter: confirm the highlighted entry (or fall back to typed input). */
	private confirmSelection(): void {
		const entry = this.entries[this.selectedIndex];

		// Drives-listing mode: Enter selects the drive as target (right-arrow
		// still drills in). Keeps Enter="select current" consistent.
		if (this.isShowingDrives) {
			if (entry) this.done({ kind: "picked", directory: entry.value });
			return;
		}

		// Dir mode. The synthetic "./" entry at index 0 represents the
		// current folder. If the user typed something AND the only entry is
		// "./" (i.e. no children matched the filter), fall through to the
		// typed-resolution flow so the typed text isn't silently dropped.
		const isCurrentEntry =
			entry?.kind === "dir" && entry.value === this.currentDir;
		if (
			isCurrentEntry &&
			this.input.trim().length > 0 &&
			this.entries.length === 1
		) {
			this.done({ kind: "typed", text: this.input.trim() });
			return;
		}

		if (entry?.kind === "dir") {
			this.done({ kind: "picked", directory: entry.value });
			return;
		}
		// Defensive no-op (shouldn't reach here — refreshEntries always
		// produces at least the "./" entry in dir mode).
	}

	// ---- input editing (textbox cursor within `this.input`) ----

	private deleteBackward(): void {
		if (this.cursor <= 0) return;
		this.input =
			this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor);
		this.cursor--;
		this.refreshEntries();
	}

	private deleteForward(): void {
		if (this.cursor >= this.input.length) return;
		this.input =
			this.input.slice(0, this.cursor) + this.input.slice(this.cursor + 1);
		this.refreshEntries();
	}

	private deleteWordBackward(): void {
		if (this.cursor <= 0) return;
		let i = this.cursor;
		while (i > 0 && /[\\/\s]/.test(this.input[i - 1] ?? "")) i--;
		while (i > 0 && !/[\\/\s]/.test(this.input[i - 1] ?? "")) i--;
		this.input = this.input.slice(0, i) + this.input.slice(this.cursor);
		this.cursor = i;
		this.refreshEntries();
	}

	// ---- rendering ----

	private get totalSelectable(): number {
		return this.entries.length;
	}

	render(termWidth: number): string[] {
		const termH = terminalRows();
		if (
			this.cachedLines &&
			this.cachedWidth === termWidth &&
			this.cachedHeight === termH
		) {
			return this.cachedLines;
		}

		const ui = this.ui;
		const palette = ui.palette;
		// GRUB-style takeover: centred panel on a solid background. The
		// panel keeps the picker's old 72–110 column comfort zone.
		const panelW = ui.panelWidth(termWidth, this.width);
		const innerW = Math.max(1, panelW - 2);
		// Height-aware viewport: never let the panel overflow the screen.
		const maxVisible = ui.listViewport(termH, CD_CHROME_LINES, this.maxResults);
		const panel: string[] = [];

		panel.push(ui.panelTop(this.title, innerW));
		panel.push(ui.panelBlank(innerW));
		panel.push(this.renderInputRow(innerW));
		panel.push(ui.panelBlank(innerW));

		// Current-dir / drives header line (non-selectable).
		if (this.isShowingDrives) {
			panel.push(ui.panelRow([ui.span(" Drives", { fg: palette.muted })], innerW));
		} else {
			panel.push(
				ui.panelRow(
					[
						ui.span(" Current Path: ", { fg: palette.muted }),
						ui.span(shortenPath(this.currentDir), { fg: palette.accent }),
					],
					innerW,
				),
			);
		}
		panel.push(ui.panelBlank(innerW));

		// Render the entries list. The viewport slides through `entries`
		// based on `scrollOffset` so the user can navigate past the
		// visible rows without losing track of the selection.
		const isEmpty = this.entries.length === 0;
		const viewportStart = this.scrollOffset;
		const viewportEnd = Math.min(this.entries.length, viewportStart + maxVisible);
		// Track how many rows we actually painted for PageUp/PageDown
		// step size. Defaults to the constructor's initial 10 if this is
		// the first render and entries are still empty.
		if (viewportEnd > viewportStart) {
			this.viewportRowCount = viewportEnd - viewportStart;
		}

		if (isEmpty && this.isShowingDrives) {
			panel.push(
				ui.panelRow([ui.span(" No drives detected", { fg: palette.muted })], innerW),
			);
		} else if (isEmpty) {
			panel.push(
				ui.panelRow([ui.span(" No subdirectories", { fg: palette.muted })], innerW),
			);
		} else {
			for (let i = viewportStart; i < viewportEnd; i++) {
				const item = this.entries[i];
				if (!item) continue;
				const isParentRow = item.kind === "drive";
				panel.push(
					ui.menuRow(item.label, undefined, {
						selected: i === this.selectedIndex,
						muted: isParentRow,
					}, innerW),
				);
			}
			if (this.entries.length > maxVisible) {
				panel.push(ui.panelBlank(innerW));
				panel.push(
					ui.panelRow(
						[
							ui.span(
								` ↓ rows ${viewportStart + 1}\u2013${viewportEnd} of ${this.entries.length} (keep typing to narrow)`,
								{ fg: palette.muted },
							),
						],
						innerW,
					),
				);
			}
		}

		panel.push(ui.panelBlank(innerW));
		panel.push(ui.panelBottom(innerW));

		const lines = ui.takeover({
			termWidth,
			termHeight: termH,
			panelWidth: panelW,
			panel,
			footer: this.renderHelp().map((text) => [ui.span(text, { fg: palette.muted })]),
		});

		this.cachedWidth = termWidth;
		this.cachedHeight = termH;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.invalidateCache();
	}

	dispose(): void {
		this.invalidateCache();
	}

	private invalidateCache(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	/** The single always-live input: accent-bordered box on the selection
	 * bar, "Path:" prompt, horizontal scroll, and the only typing cursor
	 * on screen (the hardware cursor marker keeps IME positioning correct). */
	private renderInputRow(innerW: number): string {
		const ui = this.ui;
		const palette = ui.palette;
		const bar = palette.selectionBg;
		const prompt = "Path: ";
		const promptW = visibleWidth(prompt);
		// Layout inside innerW: space + border + prompt + field + pad + border + space.
		const availW = Math.max(1, innerW - 4 - promptW);

		// Horizontal scroll so the cursor never drifts off-screen.
		let offset = this.inputScrollOffset;
		if (offset > this.cursor) offset = this.cursor;
		if (this.cursor >= offset + availW) offset = this.cursor - availW + 1;
		offset = Math.max(0, offset);
		this.inputScrollOffset = offset;

		const marker = this.focused ? CURSOR_MARKER : "";
		const cursorChar =
			this.cursor < this.input.length ? (this.input[this.cursor] ?? " ") : " ";

		const fieldSpans: AftcSpan[] = [];
		let fieldW = 0;
		if (this.input.length === 0) {
			const placeholder = "Type a path or use ↑↓ navigate";
			fieldSpans.push({
				text: `${marker}\x1b[7m${cursorChar}\x1b[27m${placeholder}`,
				fg: palette.muted,
				bg: bar,
			});
			fieldW = 1 + visibleWidth(placeholder);
		} else {
			const before = this.input.slice(0, this.cursor);
			const after = this.input.slice(this.cursor + 1);
			const core = `${before}${marker}\x1b[7m${cursorChar}\x1b[27m${after}`;
			const field = sliceByColumn(core, offset, availW);
			fieldSpans.push({ text: field, fg: palette.text, bg: bar });
			fieldW = visibleWidth(field);
		}

		const pad = Math.max(0, availW - fieldW);
		const border = (ch: string): AftcSpan => ({ text: ch, fg: palette.accent, bg: bar });
		return ui.panelRow(
			[
				{ text: " ", bg: palette.background },
				border("│"),
				{ text: prompt, fg: palette.accent, bg: bar, bold: true },
				...fieldSpans,
				{ text: " ".repeat(pad), bg: bar },
				border("│"),
				{ text: " ", bg: palette.background },
			],
			innerW,
		);
	}

	/** Footer hint lines (unstyled — the takeover colours them muted). */
	private renderHelp(): string[] {
		let controlsLine: string;
		let extraLine: string | null = null;
		if (this.isShowingDrives) {
			// Drives mode — no ← up (already at the top), no Tab. Page
			// keys still apply since drives list can have many entries.
			controlsLine =
				"↑↓ = navigate | → = Enter | Enter = Select | Esc = cancel";
			extraLine = `PgUp/PgDn = up/down ${this.viewportRowCount} | Ctrl+PgUp = top | Ctrl+PgDn = bottom`;
		} else {
			// Dir mode — "./" at the top is the current folder; press
			// Enter on it to switch to a fresh session right here, or use
			// ← to go up a level. Tab autocompletes the highlighted entry
			// into the input.
			controlsLine =
				"↑↓ = navigate | ← = Up level | → = Enter | Enter = Select | Tab = Auto complete | Esc = cancel";
			extraLine = `PgUp/PgDn = up/down ${this.viewportRowCount} | Ctrl+PgUp = top | Ctrl+PgDn = bottom | ./ = current folder`;
		}
		return extraLine ? [controlsLine, extraLine] : [controlsLine];
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Command handler — picker overlay + session switch
// ─────────────────────────────────────────────────────────────────────────────

async function handleCdCommand(
	args: string,
	maxDepth: number,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const trimmedArg = args.trim();

	if (trimmedArg.length > 0) {
		// One-shot path: resolve + confirm + switch. Always fresh.
		const target = await resolveOrCreateDirectory(trimmedArg, ctx);
		if (target !== null) await switchToNewSession(target, ctx);
		return;
	}

	if (!ctx.hasUI || ctx.mode !== "tui") {
		ctx.ui.notify(
			"/cd requires interactive TUI mode (run with a path argument instead, e.g. /cd ~/projects)",
			"error",
		);
		return;
	}

	// Directory-picker overlay (AFTC UI full-screen takeover).
	const result = await ctx.ui.custom<PickerResult>(
		(_tui, _theme, _keybindings, done) =>
			new CdOverlay(ctx.cwd, maxDepth, done),
		{ overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" } },
	);
	if (!result || result.kind === "cancelled") return;

	// Switch session in the picked directory. Always fresh — `/cd` no
	// longer offers the option to resume a previous session in the
	// target dir.
	if (result.kind === "typed") {
		// User typed a non-matching path in the overlay — run it through
		// the same resolve/create flow as a CLI arg.
		const target = await resolveOrCreateDirectory(result.text, ctx);
		if (target !== null) await switchToNewSession(target, ctx);
		return;
	}
	await switchToNewSession(result.directory, ctx);
}

async function resolveOrCreateDirectory(
	input: string,
	ctx: ExtensionCommandContext,
): Promise<string | null> {
	const resolved = resolveDirectory(input, ctx.cwd);
	if (resolved !== null) return resolved;

	let targetPath: string;
	if (input.startsWith("~/")) {
		targetPath = path.join(os.homedir(), input.slice(2));
	} else if (path.isAbsolute(input)) {
		targetPath = path.normalize(input);
	} else {
		targetPath = path.resolve(ctx.cwd, input);
	}

	const parentDir = path.dirname(targetPath);
	if (!fs.existsSync(parentDir)) {
		ctx.ui.notify(
			`Cannot create "${path.basename(targetPath)}": parent directory does not exist`,
			"error",
		);
		return null;
	}

	const basename = path.basename(targetPath);
	const confirmed = await showConfirm(ctx, {
		title: "Create directory?",
		body: `"${basename}" does not exist. Create it?`,
	});
	if (!confirmed) return null;

	try {
		fs.mkdirSync(targetPath, { recursive: true });
		return targetPath;
	} catch (err) {
		ctx.ui.notify(
			`Failed to create directory: ${err instanceof Error ? err.message : String(err)}`,
			"error",
		);
		return null;
	}
}

async function switchToNewSession(
	targetDir: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	ctx.ui.notify(`Moving to ${targetDir}...`, "info");

	try {
		let newSession: SessionManager;
		try {
			newSession = SessionManager.create(targetDir);
		} catch (err) {
			ctx.ui.notify(
				`Failed to create session in ${targetDir}: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
			return;
		}

		const sessionFile = newSession.getSessionFile();
		if (!sessionFile) {
			ctx.ui.notify(
				"Failed to create new session (no session file path)",
				"error",
			);
			return;
		}

		// Always write a fresh session header for the new directory — `/cd`
		// now always starts a fresh session. `fs.writeFileSync` overwrites
		// any existing file at this path; the `session_shutdown` handler
		// cleans up empty sessions later.
		const header = {
			type: "session",
			version: 3,
			id: newSession.getSessionId(),
			timestamp: new Date().toISOString(),
			cwd: targetDir,
		};
		const sessionDir = newSession.getSessionDir();
		if (!fs.existsSync(sessionDir)) {
			fs.mkdirSync(sessionDir, { recursive: true });
		}
		fs.writeFileSync(sessionFile, JSON.stringify(header) + "\n", "utf-8");

		await ctx.switchSession(sessionFile);
	} catch (err) {
		ctx.ui.notify(
			`Failed to move: ${err instanceof Error ? err.message : String(err)}`,
			"error",
		);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Public factory — wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function createCd(pi: ExtensionAPI): void {
	// Closure-scoped max descendant depth for the directory listing.
	// Mutable at runtime via `/cd-set-max-depth`. Per-session state — the
	// user sets their preferred depth for the session and it's reset on
	// next session start.
	let maxDepth = DEFAULT_MAX_DEPTH;

	// Clean up empty sessions when leaving them.
	// Uses in-memory entries (always current — appended before persist)
	// and only deletes sessions with no real user/assistant messages.
	pi.on("session_shutdown", (event, ctx) => {
		if (event.reason === "reload") return;
		const entries = ctx.sessionManager.getEntries();
		const hasRealMessages = entries.some(
			(e: { type: string; message?: { role?: string } }) =>
				e.type === "message" &&
				(e.message?.role === "user" || e.message?.role === "assistant"),
		);
		if (hasRealMessages) return;

		const sessionFile = ctx.sessionManager.getSessionFile();
		if (!sessionFile) return;
		try {
			fs.unlinkSync(sessionFile);
		} catch {
			/* file gone */
		}
	});

	pi.registerCommand("cd", {
		description:
			"Switch to a different directory. No args → interactive picker (always fresh session). With a path → direct switch (always fresh).",
		getArgumentCompletions: (): null => null,
		handler: async (args, ctx) => {
			await handleCdCommand(args, maxDepth, ctx);
		},
	});

	// `/cd-set-max-depth [n]` — set the descendant-depth cap for the
	// directory picker listing. Accepts values 2..10 (the upper bound is
	// wide enough for deep monorepos without flooding the listing).
	// Without args → opens a picker over 2..10 with the current value marked.
	pi.registerCommand("cd-set-max-depth", {
		description: `Set the /cd picker listing depth (${MIN_DEPTH}-${MAX_DEPTH}, default ${DEFAULT_MAX_DEPTH})`,
		getArgumentCompletions: (): null => null,
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			// Argument form: just parse the number.
			if (trimmed.length > 0) {
				const n = parseInt(trimmed, 10);
				if (Number.isFinite(n) && n >= MIN_DEPTH && n <= MAX_DEPTH) {
					maxDepth = n;
					ctx.ui.notify?.(
						`/cd picker depth set to ${n}`,
						"info",
					);
				} else {
					ctx.ui.notify?.(
						`Invalid depth "${trimmed}". Must be ${MIN_DEPTH}-${MAX_DEPTH}.`,
						"error",
					);
				}
				return;
			}
			// No arg → picker over 2..10 with current value marked.
			if (!ctx.hasUI || ctx.mode !== "tui") {
				ctx.ui.notify?.(
					`/cd-set-max-depth: current depth = ${maxDepth}. Pass a number ${MIN_DEPTH}-${MAX_DEPTH} to set.`,
					"info",
				);
				return;
			}
			const items: { value: string; label: string }[] = [];
			for (let i = MIN_DEPTH; i <= MAX_DEPTH; i++) {
				items.push({
					value: String(i),
					label: i === maxDepth ? `${i} (current)` : String(i),
				});
			}
			const choice = await showMenu(ctx, {
				title: "Set /cd picker listing depth",
				items,
				initialIndex: Math.max(0, Math.min(MAX_DEPTH, maxDepth) - MIN_DEPTH),
			});
			if (choice === null) return;
			const n = parseInt(choice, 10);
			if (Number.isFinite(n) && n >= MIN_DEPTH && n <= MAX_DEPTH) {
				maxDepth = n;
				ctx.ui.notify?.(
					`/cd picker depth set to ${n}`,
					"info",
				);
			}
		},
	});

	console.log("[aftc-toolset] loaded — /cd, /cd-set-max-depth");
}

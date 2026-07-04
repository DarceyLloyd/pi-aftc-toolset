/**
 * pi-aftc-toolset — theme-selector shortcut feature module.
 *
 * Registers the `/theme` slash command which opens a custom theme
 * picker built on pi-tui's `SelectList`, with extended keyboard
 * navigation AND live theme preview:
 *
 *   - ↑ / ↓              move selection by 1 (applies as preview)
 *   - PageUp / PageDown  move by one viewport (applies as preview)
 *   - Ctrl+PageUp        jump to first theme (applies as preview)
 *   - Ctrl+PageDown      jump to last theme (applies as preview)
 *   - Enter              commit the previewed theme
 *   - Esc / Ctrl+C       revert to the theme that was active when
 *                        the picker opened, then close
 *
 * The picker pre-selects the currently active theme on open so the
 * user sees exactly where they are, and every navigation key
 * applies the highlighted theme as a temporary preview. Esc
 * restores the original; Enter makes the preview permanent.
 *
 * Why a custom overlay instead of `ctx.ui.select`:
 *
 *   - `ctx.ui.select` does not bind PageUp/PageDown/Ctrl+PageUp/
 *     Ctrl+PageDown, and there is no documented hook to add them.
 *   - We want a visible "current theme" hint at the top so the
 *     user knows where they are and where they started.
 *   - `ctx.ui.select` is fire-and-forget; we need a selection
 *     callback so each navigation can apply the highlighted theme
 *     as a preview via `ctx.ui.setTheme`.
 *   - `SelectList` itself only handles up/down/enter/escape - we
 *     wrap it, intercept the page-nav keys, and forward selection
 *     changes to the preview callback.
 *
 * Architecture:
 *
 *   - `ThemePicker` wraps a `SelectList`, tracks its own selected
 *     index, intercepts the four page-nav keys, and notifies the
 *     caller via an `onSelectionChange` callback on every move.
 *   - `ThemePickerOverlay` is a `Container` with title, current
 *     hint, the picker, and a key-binding hint footer.
 *   - `createTheme` captures the original theme name at open time
 *     and the live-preview callback reverts on Esc.
 *
 * Self-contained feature module (rules.md §1.5):
 *   - No closure state outside the picker instance.
 *   - No event subscriptions.
 *   - No cross-module imports.
 *
 * Wired in by the orchestrator (`index.ts`) via `createTheme(pi)`.
 *
 * See `theme.readme.md` for the full contract (commands, keys,
 * failure modes).
 */

import type {
    ExtensionAPI,
    ExtensionCommandContext,
    Theme,
} from "@earendil-works/pi-coding-agent";
import {
    Box,
    Container,
    type Component,
    matchesKey,
    type SelectItem,
    SelectList,
    type SelectListTheme,
    Spacer,
    Text,
    type TUI,
    type KeybindingsManager,
} from "@earendil-works/pi-tui";

// ─────────────────────────────────────────────────────────────────────────────
// ThemePicker - SelectList wrapper with PageUp/PageDown/Ctrl+Page{Up,Down}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * View list component that wraps a `SelectList` and adds:
 *   - PageUp / PageDown: move by `maxVisible` rows
 *   - Ctrl+PageUp / Ctrl+PageDown: jump to first / last item
 *   - Tracking of its own `selectedIndex` so we can step without
 *     poking at the SelectList's private state.
 *   - `onSelectionChange(value)` callback fired on EVERY selection
 *     move (up/down/pageUp/pageDown/ctrl+pageUp/ctrl+pageDown).
 *     `createTheme` uses this for live theme preview.
 */
class ThemePicker implements Component {
    private readonly items: SelectItem[];
    private readonly maxVisible: number;
    private readonly selectList: SelectList;
    private readonly onSelectionChange: (value: string) => void;
    private selectedIndex: number;

    constructor(
        items: SelectItem[],
        currentIndex: number,
        maxVisible: number,
        selectListTheme: SelectListTheme,
        onSelect: (value: string) => void,
        onCancel: () => void,
        onSelectionChange: (value: string) => void,
    ) {
        this.items = items;
        this.maxVisible = maxVisible;
        this.selectedIndex = Math.max(
            0,
            Math.min(currentIndex, items.length - 1),
        );
        this.onSelectionChange = onSelectionChange;

        this.selectList = new SelectList(
            items,
            maxVisible,
            selectListTheme,
        );
        this.selectList.setSelectedIndex(this.selectedIndex);
        this.selectList.onSelect = (item) => onSelect(item.value);
        this.selectList.onCancel = onCancel;
        // SelectList fires onSelectionChange for up/down; page-nav
        // is handled in our wrapper below and we fire it ourselves.
        this.selectList.onSelectionChange = (item) =>
            onSelectionChange(item.value);
    }

    /** Get the currently-selected item's value (used by tests). */
    getSelectedValue(): string {
        const item = this.selectList.getSelectedItem();
        return item ? item.value : "";
    }

    /**
     * Programmatically set the selected index (clamped). Fires
     * `onSelectionChange` only when the index actually changes -
     * this keeps the preview callback from running for no-op moves.
     */
    setSelectedIndex(i: number): void {
        const clamped = Math.max(0, Math.min(this.items.length - 1, i));
        if (clamped === this.selectedIndex) return;
        this.selectedIndex = clamped;
        this.selectList.setSelectedIndex(clamped);
        this.onSelectionChange(this.getSelectedValue());
    }

    handleInput(data: string): void {
        // Custom page-nav keys first. These are NOT bound by the
        // underlying SelectList, so we must intercept before passing
        // through. Wrap-around is OFF (clamp to [0, n-1]) - this is
        // the conventional page-nav behaviour and matches pi's
        // cd.ts picker. onSelectionChange fires via setSelectedIndex.
        if (matchesKey(data, "pageUp")) {
            this.moveBy(-this.maxVisible);
            return;
        }
        if (matchesKey(data, "pageDown")) {
            this.moveBy(this.maxVisible);
            return;
        }
        if (matchesKey(data, "ctrl+pageUp")) {
            this.setSelectedIndex(0);
            return;
        }
        if (matchesKey(data, "ctrl+pageDown")) {
            this.setSelectedIndex(this.items.length - 1);
            return;
        }
        // Pass-through: up / down / enter / escape / ctrl+c.
        // SelectList fires onSelectionChange internally for up/down.
        this.selectList.handleInput(data);
    }

    private moveBy(delta: number): void {
        this.setSelectedIndex(this.selectedIndex + delta);
    }

    invalidate(): void {
        this.selectList.invalidate();
    }

    render(width: number): string[] {
        return this.selectList.render(width);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ThemePickerOverlay - Container with title, hint, picker, footer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Modal container. Title + current-theme hint + picker + key-hint
 * footer. The "current" hint is shown only when pi can resolve a
 * real theme name (not the literal "<in-memory>" sentinel).
 *
 * The `onSelectionChange` callback is forwarded to the inner
 * `ThemePicker`; `createTheme` uses it to apply the highlighted
 * theme as a live preview via `ctx.ui.setTheme`.
 */
class ThemePickerOverlay extends Container {
    private readonly picker: ThemePicker;

    constructor(
        items: SelectItem[],
        currentIndex: number,
        maxVisible: number,
        currentName: string | undefined,
        theme: Theme,
        onSelect: (value: string) => void,
        onCancel: () => void,
        onSelectionChange: (value: string) => void,
    ) {
        super();

        const selectListTheme: SelectListTheme = {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("muted", t),
        };

        // Wrap all content in a Box so the modal has visual
        // breathing room against the underlying chat output.
        // paddingX=2 = 2 columns of horizontal space on each side;
        // paddingY=1 = 1 blank line above and below. No background
        // — the padding stays transparent so the chat behind the
        // modal is visible but offset, which is exactly the
        // separation we want.
        const frame = new Box(2, 1);
        frame.addChild(new Text(theme.bold(theme.fg("accent", "Select theme")), 0, 0));
        frame.addChild(new Spacer(1));
        if (currentName) {
            frame.addChild(
                new Text(theme.fg("muted", `Current: ${currentName}`), 0, 0),
            );
        } else {
            frame.addChild(
                new Text(theme.fg("muted", "Pick a theme to switch to"), 0, 0),
            );
        }
        frame.addChild(new Spacer(1));

        this.picker = new ThemePicker(
            items,
            currentIndex,
            maxVisible,
            selectListTheme,
            onSelect,
            onCancel,
            onSelectionChange,
        );
        frame.addChild(this.picker);

        frame.addChild(new Spacer(1));
        // Hint reflects live-preview behaviour: every navigation
        // key applies the highlighted theme; Enter commits, Esc
        // reverts. PgUp/PgDn/Ctrl+PgUp/PgDn still jump, but the
        // effect (preview / commit / revert) is the same.
        frame.addChild(
            new Text(
                theme.fg(
                    "dim",
                    "  ↑/↓ = preview  ·  PgUp/PgDn = page  ·  Ctrl+PgUp/PgDn = top/bottom  ·  Enter = commit  ·  Esc = revert",
                ),
                0,
                0,
            ),
        );
        this.addChild(frame);
    }

    /** Used by tests to inspect the picker's state. */
    getPicker(): ThemePicker {
        return this.picker;
    }

    override handleInput(data: string): void {
        this.picker.handleInput(data);
    }

    override invalidate(): void {
        super.invalidate();
        this.picker.invalidate();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Best-effort read of the active theme's name. Returns undefined if:
 *   - pi's theme proxy hasn't been initialised (older pi / weird state)
 *   - the theme is an in-memory instance (the literal "<in-memory>" sentinel)
 *   - the theme has no name field
 */
function readCurrentThemeName(ui: { theme?: Theme }): string | undefined {
    const t = ui.theme as (Theme & { name?: string }) | undefined;
    const name = t?.name;
    if (!name || name === "<in-memory>") return undefined;
    return name;
}

/**
 * Cap the visible viewport for the picker. 15 fits most terminals
 * with a comfortable amount of breathing room around the modal;
 * clamped to the actual number of themes so the list does not
 * render empty rows.
 */
function computeMaxVisible(itemCount: number): number {
    return Math.max(1, Math.min(15, itemCount));
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC FACTORY - wired by the orchestrator (index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function createTheme(pi: ExtensionAPI): void {
    pi.registerCommand("theme", {
        description: "Open a theme picker and switch to the selected theme",
        handler: async (_args: string, ctx: ExtensionCommandContext) => {
            // ---- 1. Headless / RPC fallback ----
            if (!ctx.hasUI) {
                const themes = ctx.ui.getAllThemes?.() ?? [];
                const names = themes.map((t: { name: string }) => t.name);
                console.log(
                    `[aftc-toolset] available themes: ${
                        names.length ? names.join(", ") : "(none discovered)"
                    }`,
                );
                return;
            }

            // ---- 2. Discover themes ----
            const themes = ctx.ui.getAllThemes?.() ?? [];
            if (themes.length === 0) {
                ctx.ui.notify?.("No themes discovered", "warning");
                return;
            }

            const items: SelectItem[] = themes.map((t: { name: string }) => ({
                value: t.name,
                label: t.name,
            }));

            // ---- 3. Find current theme so we can pre-select it ----
            const currentName = readCurrentThemeName(ctx.ui);
            const currentIndex = currentName
                ? items.findIndex((i) => i.value === currentName)
                : -1;
            const startIndex = currentIndex >= 0 ? currentIndex : 0;
            const maxVisible = computeMaxVisible(items.length);

            // ---- 4. Open the overlay ----
            const chosen = await ctx.ui.custom<string | null>(
                (
                    _tui: TUI,
                    theme: Theme,
                    _keybindings: KeybindingsManager,
                    done: (result: string | null) => void,
                ) => {
                    // Capture the theme that was active when the
                    // picker opened so we can revert on cancel.
                    // Skip the "<in-memory>" sentinel — that means
                    // the theme was loaded via setThemeInstance(),
                    // so we don't have a real name to revert to.
                    const originalName =
                        currentName && currentName !== "<in-memory>"
                            ? currentName
                            : undefined;

                    // True once at least one preview successfully
                    // changed the theme. Tracked per-picker so each
                    // /theme invocation starts clean. Read only by
                    // the cancel handler — the commit path doesn't
                    // need it (the previewed theme is what we keep).
                    let hasChangedTheme = false;

                    // Apply theme as a live preview during
                    // navigation. On failure we notify but keep the
                    // picker open so the user can press Esc to
                    // revert or Enter to commit elsewhere.
                    const previewTheme = (name: string) => {
                        const result = ctx.ui.setTheme(name);
                        if (result && !result.success) {
                            ctx.ui.notify?.(
                                `Failed to preview theme '${name}': ${result?.error ?? "unknown error"}`,
                                "warning",
                            );
                            return;
                        }
                        hasChangedTheme = true;
                    };

                    return new ThemePickerOverlay(
                        items,
                        startIndex,
                        maxVisible,
                        currentName,
                        theme,
                        (value) => done(value), // commit: keep preview
                        () => {
                            // Revert on cancel only if we actually
                            // changed the theme AND we know what to
                            // revert to. OriginalName is undefined
                            // when the picker opened with no
                            // resolvable name (e.g. <in-memory>
                            // sentinel) — in that case there's
                            // nothing to restore, so just close.
                            if (hasChangedTheme && originalName) {
                                ctx.ui.setTheme(originalName);
                            }
                            done(null);
                        },
                        previewTheme, // live-preview callback
                    );
                },
                { overlay: true },
            );

            // ---- 5. Apply / bail ----
            if (chosen === null || chosen === undefined) {
                return; // cancelled, theme already reverted
            }
            // Commit path: re-set the chosen theme so the result
            // is definitive. This is idempotent if preview already
            // applied it, and retries cleanly if a preview failed
            // mid-navigation. We do NOT notify on a redundant
            // re-apply — the user has already seen the theme change
            // during navigation.
            const result = ctx.ui.setTheme(chosen);
            if (result && result.success) {
                ctx.ui.notify(`Switched to theme: ${chosen}`, "info");
            } else {
                ctx.ui.notify?.(
                    `Failed to switch theme: ${result?.error ?? "unknown error"}`,
                    "error",
                );
            }
        },
    });

    console.log("[aftc-toolset] loaded — /theme (open pi's theme picker)");
}
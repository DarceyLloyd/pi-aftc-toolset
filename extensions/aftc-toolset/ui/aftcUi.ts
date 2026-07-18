// AFTC UI toolkit — shared overlay-screen primitives for the toolset.
//
// A fixed, high-contrast palette (black background, white text, #fca02f
// accents, #555555 borders, dark-orange selection bars) plus a GRUB-style
// full-screen takeover composer: screens paint every terminal cell with
// the background colour, centre a bordered panel, and show hints below it,
// so underlying pi content never bleeds through and the active element is
// always obvious.
//
// Focus / active-element contract (user-facing readability rules):
//   - Exactly ONE element looks active at any time.
//   - Active menu rows / actions: full-width selection bar (selectionBg)
//     with a bold accent ❯ marker.
//   - Active input fields: accent ❯ label, boxed input row whose borders
//     turn accent, full-width selectionBg bar behind the value, and the
//     ONLY live typing cursor on screen. Inactive inputs render their
//     value as plain accent text inside #555555 borders with no cursor.
//
// This module is a leaf utility: it imports only from @earendil-works/pi-tui
// and nothing from other aftc-toolset modules, so feature modules may import
// it freely without violating the "features must not import each other" rule.
//
// Rendering rules that keep pi's TUI safe:
//   - Every returned line is exactly `width` visible columns (never more —
//     over-wide lines crash the TUI).
//   - Every span is independently styled and terminated with an SGR reset;
//     spans are never nested, so colours cannot bleed across segments.

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Focusable } from "@earendil-works/pi-tui";

// ─── palette ────────────────────────────────────────────────────────────────

export interface AftcPalette {
    /** Screen / panel background. */
    background: string;
    /** Primary text. */
    text: string;
    /** Titles, values, active markers. */
    accent: string;
    /** Inactive box / panel borders. */
    border: string;
    /** Selection bar behind the active row / input. */
    selectionBg: string;
    /** Secondary hints and help text. */
    muted: string;
    /** Inline validation errors. */
    error: string;
}

/** Parse "#rrggbb" into channels. Throws on anything else. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!match || !match[1]) throw new Error(`aftcUi: invalid 6-digit hex colour "${hex}"`);
    const n = Number.parseInt(match[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** Scale a colour towards black by `factor` (0..1). Used for selection bars. */
export function darken(hex: string, factor: number): string {
    const { r, g, b } = hexToRgb(hex);
    const f = Math.min(1, Math.max(0, factor));
    const chan = (v: number) => Math.round(v * f).toString(16).padStart(2, "0");
    return `#${chan(r)}${chan(g)}${chan(b)}`;
}

/** The default AFTC palette. Frozen — copy with defaultAftcPalette(). */
export const AFTC_UI_DEFAULTS: AftcPalette = Object.freeze({
    background: "#000000",
    text: "#ffffff",
    accent: "#fca02f",
    border: "#555555",
    selectionBg: darken("#fca02f", 0.18), // #2d1d08 — much darker accent
    muted: "#999999",
    error: "#ff5555",
});

export function defaultAftcPalette(): AftcPalette {
    return { ...AFTC_UI_DEFAULTS };
}

// ─── spans ──────────────────────────────────────────────────────────────────

/** A self-contained styled text segment. Never nest rendered spans. */
export interface AftcSpan {
    text: string;
    fg?: string;
    bg?: string;
    bold?: boolean;
}

/** Render one span as ANSI truecolour, always terminated with SGR reset. */
export function renderSpan(span: AftcSpan): string {
    let codes = "";
    if (span.bg) {
        const { r, g, b } = hexToRgb(span.bg);
        codes += `\x1b[48;2;${r};${g};${b}m`;
    }
    if (span.fg) {
        const { r, g, b } = hexToRgb(span.fg);
        codes += `\x1b[38;2;${r};${g};${b}m`;
    }
    if (span.bold) codes += "\x1b[1m";
    if (!codes) return span.text;
    return `${codes}${span.text}\x1b[0m`;
}

export function spansWidth(spans: AftcSpan[]): number {
    return spans.reduce((n, s) => n + visibleWidth(s.text), 0);
}

/** Trim spans (left to right) so their combined visible width fits `width`. */
export function fitSpans(spans: AftcSpan[], width: number): AftcSpan[] {
    const out: AftcSpan[] = [];
    let remaining = Math.max(0, width);
    for (const s of spans) {
        if (remaining <= 0) break;
        const w = visibleWidth(s.text);
        if (w <= remaining) {
            out.push(s);
            remaining -= w;
        } else {
            out.push({ ...s, text: truncateToWidth(s.text, remaining, "", false) });
            remaining = 0;
        }
    }
    return out;
}

/**
 * Render spans padded to exactly `width` visible columns. Overflow is
 * truncated; shortfall is filled with background-painted spaces.
 */
export function renderSpans(spans: AftcSpan[], width: number, palette: AftcPalette): string {
    const fitted = fitSpans(spans, width);
    const used = spansWidth(fitted);
    const pad = Math.max(0, width - used);
    const all = pad > 0 ? [...fitted, { text: " ".repeat(pad), bg: palette.background }] : fitted;
    return all.map(renderSpan).join("");
}

/** A run of blank cells painted with the palette background. */
export function blankRun(count: number, palette: AftcPalette): string {
    if (count <= 0) return "";
    return renderSpan({ text: " ".repeat(count), bg: palette.background });
}

// ─── panel chrome ───────────────────────────────────────────────────────────

/** Top border with an accent title: ╭─ Title ───────╮ (width = innerW + 2). */
export function panelTopBorder(title: string, innerW: number, palette: AftcPalette): string {
    const maxLabel = Math.max(1, innerW - 3);
    const label = truncateToWidth(` ${title} `, maxLabel, "", false);
    const tail = Math.max(1, innerW - 1 - visibleWidth(label));
    const border = (t: string): AftcSpan => ({ text: t, fg: palette.border, bg: palette.background });
    return renderSpans([
        border("╭"),
        border("─"),
        { text: label, fg: palette.accent, bg: palette.background, bold: true },
        border("─".repeat(tail)),
        border("╮"),
    ], innerW + 2, palette);
}

export function panelBottomBorder(innerW: number, palette: AftcPalette): string {
    const border = (t: string): AftcSpan => ({ text: t, fg: palette.border, bg: palette.background });
    return renderSpans([border("╰"), border("─".repeat(innerW)), border("╯")], innerW + 2, palette);
}

/**
 * A bordered panel row. `spans` are fitted to innerW; the remaining space
 * is filled with `fillBg` (defaults to the panel background) — pass
 * palette.selectionBg to extend a selection bar across the full row.
 */
export function panelRow(spans: AftcSpan[], innerW: number, palette: AftcPalette, fillBg?: string): string {
    const body = fitSpans(spans, innerW);
    const used = spansWidth(body);
    const filler = used < innerW ? [{ text: " ".repeat(innerW - used), bg: fillBg ?? palette.background }] : [];
    const border = (t: string): AftcSpan => ({ text: t, fg: palette.border, bg: palette.background });
    return renderSpans([border("│"), ...body, ...filler, border("│")], innerW + 2, palette);
}

export function panelSeparator(innerW: number, palette: AftcPalette): string {
    return panelRow([{ text: "─".repeat(innerW), fg: palette.border, bg: palette.background }], innerW, palette);
}

export function panelBlank(innerW: number, palette: AftcPalette): string {
    return panelRow([], innerW, palette);
}

// ─── full-screen takeover composer ──────────────────────────────────────────

export interface AftcTakeoverOptions {
    termWidth: number;
    termHeight: number;
    /** Visible width of every line in `panel` (panel border included). */
    panelWidth: number;
    /** Panel lines, top border first, bottom border last. */
    panel: string[];
    /** Optional hint lines rendered one blank row below the panel. */
    footer?: AftcSpan[][];
    palette: AftcPalette;
}

/**
 * GRUB-style takeover: returns exactly `termHeight` lines, each exactly
 * `termWidth` visible columns, every cell painted with the background so
 * nothing underneath shows through. The panel is centred horizontally and
 * the panel + footer block is centred vertically.
 */
export function composeTakeover(opts: AftcTakeoverOptions): string[] {
    const { palette } = opts;
    const W = Math.max(1, opts.termWidth);
    const H = Math.max(1, opts.termHeight);
    const panelW = Math.max(1, Math.min(opts.panelWidth, W));
    const leftPad = Math.max(0, Math.floor((W - panelW) / 2));
    const rightPad = Math.max(0, W - leftPad - panelW);

    const band = opts.panel.map(
        (line) => blankRun(leftPad, palette) + truncateToWidth(line, panelW, "", false) + blankRun(rightPad, palette),
    );
    const footerLines = (opts.footer ?? []).map(
        (spans) => blankRun(leftPad, palette) + renderSpans(spans, panelW, palette) + blankRun(rightPad, palette),
    );
    const block = [...band, ...(footerLines.length > 0 ? [blankRun(W, palette), ...footerLines] : [])];

    const topPad = Math.max(0, Math.floor((H - block.length) / 2));
    const lines: string[] = [];
    for (let i = 0; i < topPad && lines.length < H; i++) lines.push(blankRun(W, palette));
    for (const line of block) {
        if (lines.length >= H) break;
        lines.push(line);
    }
    while (lines.length < H) lines.push(blankRun(W, palette));
    return lines;
}

/** Terminal row count with a safe fallback for non-TTY (tests, CI). */
export function terminalRows(fallback = 24): number {
    const rows = typeof process !== "undefined" ? process.stdout?.rows : undefined;
    return typeof rows === "number" && Number.isInteger(rows) && rows > 0 ? rows : fallback;
}

// ─── convenience class ──────────────────────────────────────────────────────

export interface AftcMenuRowOptions {
    /** Draw the full-width selection bar with an accent ❯ marker. */
    selected: boolean;
    /** Pad the label to this width so descriptions align vertically. */
    labelWidth?: number;
    /** Render the label in muted grey instead of accent (parent/drive rows). */
    muted?: boolean;
}

/**
 * Palette-bound facade over the toolkit functions. Screens keep one
 * instance and build whole panels from it:
 *
 *   const ui = new AftcUi();
 *   panel.push(ui.panelTop("My screen", innerW));
 *   panel.push(ui.menuRow("item one", "desc", { selected: true }, innerW));
 *   return ui.takeover({ termWidth: width, termHeight, panelWidth, panel });
 */
export class AftcUi {
    constructor(readonly palette: AftcPalette = defaultAftcPalette()) {}

    /** A span with palette defaults (white on background). */
    span(text: string, opts: { fg?: string; bg?: string; bold?: boolean } = {}): AftcSpan {
        return { text, fg: opts.fg ?? this.palette.text, bg: opts.bg ?? this.palette.background, ...(opts.bold ? { bold: true } : {}) };
    }

    panelTop(title: string, innerW: number): string {
        return panelTopBorder(title, innerW, this.palette);
    }

    panelBottom(innerW: number): string {
        return panelBottomBorder(innerW, this.palette);
    }

    panelSeparator(innerW: number): string {
        return panelSeparator(innerW, this.palette);
    }

    panelBlank(innerW: number): string {
        return panelBlank(innerW, this.palette);
    }

    panelRow(spans: AftcSpan[], innerW: number, fillBg?: string): string {
        return panelRow(spans, innerW, this.palette, fillBg);
    }

    /**
     * A selectable list row. Selected: bold accent text on a full-width
     * selection bar with a ❯ marker. Unselected: accent label + white
     * description on the plain background.
     */
    menuRow(label: string, description: string | undefined, opts: AftcMenuRowOptions, innerW: number): string {
        const p = this.palette;
        const prefix = opts.selected ? "❯ " : "  ";
        const lw = opts.labelWidth ?? 0;
        const labelPadded = lw > 0 ? label.padEnd(lw) : label;
        if (opts.selected) {
            const text = `${prefix}${labelPadded}${description ?? ""}`;
            return this.panelRow([this.span(text, { fg: p.accent, bg: p.selectionBg, bold: true })], innerW, p.selectionBg);
        }
        const spans: AftcSpan[] = [
            this.span(prefix),
            this.span(labelPadded, { fg: opts.muted ? p.muted : p.accent }),
            ...(description ? [this.span(description)] : []),
        ];
        return this.panelRow(spans, innerW);
    }

    /**
     * A field label row. Active: accent ❯ marker + bold. Inactive: muted,
     * indented to line up with the active marker.
     */
    fieldLabel(label: string, active: boolean, innerW: number): string {
        const p = this.palette;
        return this.panelRow([
            active
                ? this.span(` ❯ ${label}`, { fg: p.accent, bold: true })
                : this.span(`   ${label}`, { fg: p.muted }),
        ], innerW);
    }

    /**
     * A boxed input row: ` │ content │ ` inside the panel. Active: the box
     * borders turn accent and the whole content area carries the selection
     * bar — pass the LIVE Input component's rendered line as `content` so
     * this field owns the only typing cursor on screen. Inactive: #555555
     * borders, accent value, no cursor (pass the plain value string).
     */
    inputRow(content: string, active: boolean, innerW: number): string {
        const p = this.palette;
        // Layout inside innerW: space + border + content + border + space.
        const contentW = Math.max(1, innerW - 4);
        const fitted = truncateToWidth(content, contentW, "", false);
        const pad = Math.max(0, contentW - visibleWidth(fitted));
        const bg = active ? p.selectionBg : p.background;
        const borderFg = active ? p.accent : p.border;
        return this.panelRow([
            this.span(" "),
            { text: "│", fg: borderFg, bg },
            { text: fitted, fg: p.accent, bg, bold: active },
            { text: " ".repeat(pad), bg },
            { text: "│", fg: borderFg, bg },
            this.span(" "),
        ], innerW);
    }

    /** GRUB-style full-screen takeover; see composeTakeover(). */
    takeover(opts: Omit<AftcTakeoverOptions, "palette">): string[] {
        return composeTakeover({ ...opts, palette: this.palette });
    }

    /**
     * Panel width for a screen at `termWidth` columns: `preferred`
     * (default 78) capped by the terminal, floor of 20. The ONE place
     * screen widths are decided — custom screens must call this too.
     */
    panelWidth(termWidth: number, preferred: number = SCREEN_PANEL_WIDTH): number {
        return Math.max(20, Math.min(preferred, termWidth));
    }

    /**
     * Rows a scrolling list may paint: `maxRows` capped so the panel plus
     * its fixed chrome never overflows `termHeight`. The ONE place list
     * viewport math happens.
     */
    listViewport(termHeight: number, chromeLines: number, maxRows = 20): number {
        return Math.max(3, Math.min(maxRows, termHeight - chromeLines));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive screens — menus, confirms, forms
//
// The public surface most callers want: define what goes in, await what
// comes out. Every screen is a GRUB-style full-screen takeover sharing the
// active-element contract above. All three `show*` helpers resolve a
// cancel-safe value (null / false) outside the TUI so headless callers
// fall back to their per-field prompts without special-casing.
// ─────────────────────────────────────────────────────────────────────────────

/** Panel width for interactive screens; narrower terminals go full-bleed. */
const SCREEN_PANEL_WIDTH = 78;
/** Panel + footer lines that always exist around a menu list. */
const MENU_CHROME_LINES = 12;
/** Below this many terminal rows a form drops the blank line between fields. */
const FORM_TIGHT_HEIGHT = 30;

// ─── menus ──────────────────────────────────────────────────────────────────

export interface AftcMenuItem {
    value: string;
    label: string;
    description?: string;
}

export interface AftcMenuOptions {
    title: string;
    items: AftcMenuItem[];
    /** Pre-highlight this index (clamped). Defaults to 0. */
    initialIndex?: number;
    /** Body lines between the title and the list (e.g. a question). */
    body?: string[];
    /** Footer hint override. */
    help?: string;
    /**
     * Presentation. Defaults to the GRUB-style full-screen takeover.
     * Set false for a floating centred panel (same palette/chrome) —
     * needed when the surrounding pi UI must stay visible, e.g. live
     * theme previews.
     */
    fullscreen?: boolean;
    /** Fires whenever the highlight actually moves (live-preview use-cases). */
    onHighlight?: (item: AftcMenuItem, index: number) => void;
}

/**
 * A selectable list screen. Navigation follows the /cd contract: ↑/↓ wrap,
 * PageUp/PageDown jump by the visible viewport, Home/End jump to edges.
 * Enter resolves the highlighted item's value, Escape resolves null.
 */
export class AftcMenu implements Focusable {
    focused = false;

    private readonly ui: AftcUi;
    private selectedIndex: number;
    private scrollOffset = 0;
    /** Rows painted on the last render — the PageUp/PageDown step. */
    private viewportRowCount = 10;

    constructor(
        private readonly options: AftcMenuOptions,
        private readonly done: (value: string | null) => void,
        palette: AftcPalette = defaultAftcPalette(),
    ) {
        this.ui = new AftcUi(palette);
        const initial = options.initialIndex ?? 0;
        this.selectedIndex = Math.min(Math.max(0, initial), Math.max(0, options.items.length - 1));
    }

    /** The currently highlighted item, or undefined when the list is empty. */
    public selected(): AftcMenuItem | undefined {
        return this.options.items[this.selectedIndex];
    }

    handleInput(data: string): void {
        if (matchesKey(data, Key.escape)) {
            this.done(null);
            return;
        }
        if (matchesKey(data, Key.enter)) {
            const item = this.options.items[this.selectedIndex];
            this.done(item ? item.value : null);
            return;
        }
        if (matchesKey(data, Key.up)) return this.move(-1);
        if (matchesKey(data, Key.down)) return this.move(1);
        if (matchesKey(data, Key.pageUp)) return this.page(-this.viewportRowCount);
        if (matchesKey(data, Key.pageDown)) return this.page(this.viewportRowCount);
        if (matchesKey(data, "ctrl+pageup")) return this.edge("top");
        if (matchesKey(data, "ctrl+pagedown")) return this.edge("bottom");
        if (matchesKey(data, Key.home) || matchesKey(data, Key.ctrl("a"))) return this.edge("top");
        if (matchesKey(data, Key.end) || matchesKey(data, Key.ctrl("e"))) return this.edge("bottom");
    }

    /** ↑/↓ — wraps at the edges, matching /cd behaviour. */
    private move(delta: number): void {
        const total = this.options.items.length;
        if (total === 0) return;
        this.selectedIndex = (this.selectedIndex + delta + total) % total;
        this.clampScroll();
        this.fireHighlight();
    }

    /** PageUp/PageDown — clamps at the edges (no wrap for page nav). */
    private page(delta: number): void {
        const total = this.options.items.length;
        if (total === 0) return;
        const previous = this.selectedIndex;
        this.selectedIndex = Math.min(total - 1, Math.max(0, this.selectedIndex + delta));
        this.clampScroll();
        if (this.selectedIndex !== previous) this.fireHighlight();
    }

    private edge(edge: "top" | "bottom"): void {
        const total = this.options.items.length;
        if (total === 0) return;
        const previous = this.selectedIndex;
        this.selectedIndex = edge === "top" ? 0 : total - 1;
        this.clampScroll();
        if (this.selectedIndex !== previous) this.fireHighlight();
    }

    private fireHighlight(): void {
        const item = this.options.items[this.selectedIndex];
        if (item) this.options.onHighlight?.(item, this.selectedIndex);
    }

    private clampScroll(): void {
        const total = this.options.items.length;
        const max = Math.max(0, total - this.viewportRowCount);
        if (this.scrollOffset > max) this.scrollOffset = max;
        if (this.scrollOffset < 0) this.scrollOffset = 0;
        if (this.selectedIndex < this.scrollOffset) {
            this.scrollOffset = this.selectedIndex;
        } else if (this.selectedIndex >= this.scrollOffset + this.viewportRowCount) {
            this.scrollOffset = this.selectedIndex - this.viewportRowCount + 1;
        }
    }

    invalidate(): void {}

    render(width: number): string[] {
        const ui = this.ui;
        const palette = ui.palette;
        const termH = terminalRows();
        const panelW = ui.panelWidth(width);
        const innerW = Math.max(1, panelW - 2);
        const items = this.options.items;
        const bodyLines = this.options.body ?? [];
        const maxVisible = ui.listViewport(termH, MENU_CHROME_LINES + bodyLines.length);

        const panel: string[] = [];
        panel.push(ui.panelTop(this.options.title, innerW));
        panel.push(ui.panelBlank(innerW));
        for (const line of bodyLines) {
            panel.push(ui.panelRow([ui.span(` ${line}`)], innerW));
        }
        if (bodyLines.length > 0) panel.push(ui.panelBlank(innerW));

        if (items.length === 0) {
            panel.push(ui.panelRow([ui.span(" (empty)", { fg: palette.muted })], innerW));
        } else {
            const viewportEnd = Math.min(items.length, this.scrollOffset + maxVisible);
            if (viewportEnd > this.scrollOffset) {
                this.viewportRowCount = viewportEnd - this.scrollOffset;
            }
            for (let i = this.scrollOffset; i < viewportEnd; i++) {
                const item = items[i];
                if (!item) continue;
                panel.push(ui.menuRow(item.label, item.description, { selected: i === this.selectedIndex }, innerW));
            }
            if (items.length > maxVisible) {
                panel.push(ui.panelBlank(innerW));
                panel.push(ui.panelRow([
                    ui.span(` Rows ${this.scrollOffset + 1}–${viewportEnd} of ${items.length}`, { fg: palette.muted }),
                ], innerW));
            }
        }

        panel.push(ui.panelBlank(innerW));
        panel.push(ui.panelBottom(innerW));

        const help = this.options.help ?? "↑↓ navigate   Enter select   PgUp/PgDn jump   Home/End edges   Esc cancel";
        const footer = [[ui.span(help, { fg: palette.muted })]];
        if (this.options.fullscreen === false) {
            // Floating panel: no screen fill — the surrounding pi UI
            // stays visible (live previews, quick picks).
            return [...panel, blankRun(1, palette), ...footer.map((spans) => renderSpans(spans, panelW, palette))];
        }
        return ui.takeover({
            termWidth: width,
            termHeight: termH,
            panelWidth: panelW,
            panel,
            footer,
        });
    }
}

/**
 * Show a menu (full-screen takeover by default; `fullscreen: false` for a
 * floating panel). Resolves the highlighted item's value, or null on
 * Escape — and also null outside the TUI so headless callers fall back.
 */
export async function showMenu(ctx: ExtensionCommandContext, options: AftcMenuOptions): Promise<string | null> {
    if (ctx.mode !== "tui") return null;
    const floating = options.fullscreen === false;
    return ctx.ui.custom<string | null>(
        (_tui, _theme, _keybindings, done) => new AftcMenu(options, (v) => done(v)),
        {
            overlay: true,
            overlayOptions: floating
                ? { anchor: "center", width: "60%", minWidth: 40, maxHeight: "90%" }
                : { anchor: "center", width: "100%", maxHeight: "100%" },
        },
    );
}

// ─── confirms ───────────────────────────────────────────────────────────────

export interface AftcConfirmOptions {
    title: string;
    body?: string;
    yesLabel?: string;
    noLabel?: string;
}

/**
 * Two-choice confirm screen. The safe option (no) is highlighted by
 * default; Escape resolves false. Outside the TUI it falls back to
 * `ctx.ui.confirm` so the question still reaches the user.
 */
export async function showConfirm(ctx: ExtensionCommandContext, options: AftcConfirmOptions): Promise<boolean> {
    if (ctx.mode !== "tui") {
        return ctx.ui.confirm(options.title, options.body ?? "");
    }
    const body = (options.body ?? "").split("\n").filter((l) => l.trim().length > 0);
    const choice = await showMenu(ctx, {
        title: options.title,
        ...(body.length > 0 ? { body } : {}),
        // "no" first so it is the highlighted default — Esc and a blind
        // Enter both take the safe path.
        items: [
            { value: "no", label: options.noLabel ?? "No" },
            { value: "yes", label: options.yesLabel ?? "Yes" },
        ],
        initialIndex: 0,
        help: "↑↓ navigate   Enter confirm   Esc cancel",
    });
    return choice === "yes";
}

// ─── forms ──────────────────────────────────────────────────────────────────

export type AftcFieldType = "string" | "int" | "float" | "choice" | "password";

export interface AftcFormField {
    id: string;
    label: string;
    /** Defaults to "string". */
    type?: AftcFieldType;
    /** Empty-after-trim blocks submit with an inline error. */
    required?: boolean;
    /** Pre-filled text (choice: the option to pre-select). */
    initial?: string;
    /** Choice field options. */
    options?: string[];
    /** Numeric range for int/float fields. */
    min?: number;
    max?: number;
    /** Custom per-field validation; return the error message or null. */
    validate?: (value: string) => string | null;
}

export interface AftcFormOptions {
    title: string;
    fields: AftcFormField[];
    /** The bottom action row label. Defaults to "[ SUBMIT ]". */
    submitLabel?: string;
    /**
     * When true, Enter inside ANY field submits immediately (single-input
     * helpers). Default false: Enter advances to the next field and only
     * submits on the bottom action row.
     */
    submitOnEnter?: boolean;
    /** Cross-field validation; return the offending field + message or null. */
    validate?: (values: Record<string, string>) => { fieldId: string; message: string } | null;
}

interface FormFieldState {
    def: AftcFormField;
    /** Present for string/int/float; undefined for choice fields. */
    input?: Input;
    choiceIndex: number;
}

/** Strip " (…)" decorations and lowercase the first letter for messages. */
function fieldMessageName(label: string): string {
    const base = label.replace(/\s*\([^)]*\)/g, "").trim();
    return base.length > 0 ? base[0]!.toLowerCase() + base.slice(1) : "value";
}

function capitalize(text: string): string {
    return text.length > 0 ? text[0]!.toUpperCase() + text.slice(1) : text;
}

/**
 * Live keyup filter for numeric fields: characters that can never belong
 * to the type never enter the input. Digits always pass; a single leading
 * minus is allowed; float additionally allows a single decimal point.
 * Pasted text is not filtered here — submit-time validation backstops it.
 */
function numericCharAllowed(type: "int" | "float", ch: string, current: string): boolean {
    if (ch >= "0" && ch <= "9") return true;
    if (ch === "-") return !current.includes("-");
    if (type === "float" && ch === ".") return !current.includes(".");
    return false;
}

/**
 * A declarative input form: callers define the fields, await the values.
 * Tab / Shift+Tab cycle fields and the bottom submit action (wrapping);
 * Enter advances or submits; Escape resolves null. The active field is
 * unmistakable per the active-element contract (accent ❯ label, boxed
 * input with accent borders on the selection bar, the only live cursor).
 */
export class AftcForm implements Focusable {
    private _focused = false;
    get focused(): boolean {
        return this._focused;
    }
    set focused(value: boolean) {
        this._focused = value;
        this.syncInputFocus();
    }

    private readonly ui: AftcUi;
    private readonly states: FormFieldState[];
    private readonly submitLabel: string;
    /** 0..states.length-1 = fields, states.length = the submit action. */
    private focusIndex = 0;
    private errorMessage = "";

    constructor(
        private readonly options: AftcFormOptions,
        private readonly done: (values: Record<string, string | number | undefined> | null) => void,
        palette: AftcPalette = defaultAftcPalette(),
    ) {
        this.ui = new AftcUi(palette);
        this.submitLabel = options.submitLabel ?? "[ SUBMIT ]";
        this.states = options.fields.map((def) => {
            const type = def.type ?? "string";
            const state: FormFieldState = { def, choiceIndex: 0 };
            if (type === "choice") {
                const idx = (def.options ?? []).indexOf(def.initial ?? "");
                state.choiceIndex = Math.max(0, idx);
            } else {
                const input = new Input();
                input.setValue(def.initial ?? "");
                state.input = input;
            }
            return state;
        });
        this.syncInputFocus();
    }

    // ---- focus ----

    private syncInputFocus(): void {
        for (let i = 0; i < this.states.length; i++) {
            const state = this.states[i];
            if (state?.input) state.input.focused = this._focused && i === this.focusIndex;
        }
    }

    private setFocus(index: number): void {
        const total = this.states.length + 1; // fields + submit action
        this.focusIndex = ((index % total) + total) % total;
        this.errorMessage = "";
        this.syncInputFocus();
    }

    // ---- input ----

    handleInput(data: string): void {
        if (matchesKey(data, Key.escape)) {
            this.done(null);
            return;
        }
        // Tab / Shift+Tab cycle (Shift+Tab arrives as raw "\x1b[Z").
        if (matchesKey(data, Key.tab) || data === "\x1b[Z") {
            this.setFocus(this.focusIndex + (data === "\x1b[Z" ? -1 : 1));
            return;
        }
        if (matchesKey(data, Key.enter)) {
            if (this.focusIndex === this.states.length || this.options.submitOnEnter) this.submit();
            else this.setFocus(this.focusIndex + 1);
            return;
        }
        const state = this.states[this.focusIndex];
        if (!state) return;
        const type = state.def.type ?? "string";
        if (type === "choice") {
            const options = state.def.options ?? [];
            if (options.length === 0) return;
            if (matchesKey(data, Key.left) || matchesKey(data, Key.up)) {
                state.choiceIndex = (state.choiceIndex - 1 + options.length) % options.length;
            } else if (matchesKey(data, Key.right) || matchesKey(data, Key.down) || data === " ") {
                state.choiceIndex = (state.choiceIndex + 1) % options.length;
            }
            return;
        }
        // Numeric keyup filter: disallowed characters never enter the input.
        if ((type === "int" || type === "float") && data.length === 1 && data >= " ") {
            if (!numericCharAllowed(type, data, state.input?.getValue() ?? "")) return;
        }
        state.input?.handleInput(data);
    }

    // ---- values + validation ----

    private rawValues(): Record<string, string> {
        const raw: Record<string, string> = {};
        for (const state of this.states) {
            const type = state.def.type ?? "string";
            raw[state.def.id] = type === "choice"
                ? (state.def.options ?? [])[state.choiceIndex] ?? ""
                : state.input?.getValue() ?? "";
        }
        return raw;
    }

    private submit(): void {
        const raw = this.rawValues();
        for (const state of this.states) {
            const f = state.def;
            const type = f.type ?? "string";
            if (type === "choice") continue;
            const value = raw[f.id] ?? "";
            const trimmed = value.trim();
            const name = fieldMessageName(f.label);
            if (f.required && trimmed.length === 0) {
                return this.fail(f.id, `A ${name} is required.`);
            }
            if (trimmed.length === 0) continue; // optional empty — caller defaults
            if (type === "int" || type === "float") {
                const n = Number(trimmed);
                const kindOk = type === "int" ? Number.isInteger(n) : Number.isFinite(n);
                const kindText = type === "int" ? "a whole number" : "a number";
                if (!kindOk || !Number.isFinite(n)) {
                    return this.fail(f.id, `${capitalize(name)} must be ${kindText}.`);
                }
                if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
                    const range = f.min !== undefined && f.max !== undefined
                        ? `from ${f.min} to ${f.max}`
                        : f.min !== undefined ? `of at least ${f.min}` : `of at most ${f.max}`;
                    return this.fail(f.id, `${capitalize(name)} must be ${kindText} ${range}.`);
                }
            }
            if (f.validate) {
                const message = f.validate(value);
                if (message) return this.fail(f.id, message);
            }
        }
        if (this.options.validate) {
            const failure = this.options.validate(raw);
            if (failure) return this.fail(failure.fieldId, failure.message);
        }
        const out: Record<string, string | number | undefined> = {};
        for (const state of this.states) {
            const f = state.def;
            const type = f.type ?? "string";
            const value = raw[f.id] ?? "";
            if (type === "choice") {
                out[f.id] = value;
            } else if (type === "int" || type === "float") {
                const trimmed = value.trim();
                out[f.id] = trimmed.length > 0 ? Number(trimmed) : undefined;
            } else {
                // Strings resolve verbatim (whitespace is meaningful for
                // secrets); required checks above already ran on the trim.
                out[f.id] = value;
            }
        }
        this.done(out);
    }

    /** Show an error and move focus to the offending field. */
    private fail(fieldId: string, message: string): void {
        this.errorMessage = message;
        const index = this.states.findIndex((s) => s.def.id === fieldId);
        if (index >= 0) this.focusIndex = index;
        this.syncInputFocus();
    }

    // ---- rendering ----

    invalidate(): void {}

    render(width: number): string[] {
        const ui = this.ui;
        const palette = ui.palette;
        const termH = terminalRows();
        const panelW = ui.panelWidth(width);
        const innerW = Math.max(1, panelW - 2);
        // On short terminals drop the blank line between fields so the
        // panel (and the submit action) never overflows the screen.
        const tight = termH < FORM_TIGHT_HEIGHT;

        const panel: string[] = [];
        panel.push(ui.panelTop(this.options.title, innerW));
        panel.push(ui.panelBlank(innerW));

        for (let i = 0; i < this.states.length; i++) {
            const state = this.states[i];
            if (!state) continue;
            const type = state.def.type ?? "string";
            const active = i === this.focusIndex;
            panel.push(ui.fieldLabel(state.def.label, active, innerW));
            if (type === "choice") {
                const value = (state.def.options ?? [])[state.choiceIndex] ?? "";
                panel.push(ui.inputRow(`  ‹ ${value} ›`, active, innerW));
            } else if (type === "password") {
                // Masked: the value never renders — bullets only. The fake
                // cursor stays at the end (arrow-key edits still apply
                // internally; the cursor position is deliberately hidden).
                const len = [...(state.input?.getValue() ?? "")].length;
                const bullets = "•".repeat(len);
                const content = active ? `> ${bullets}\x1b[7m \x1b[27m` : (len > 0 ? `  ${bullets}` : "");
                panel.push(ui.inputRow(content, active, innerW));
            } else if (active) {
                const contentW = Math.max(1, innerW - 4);
                const inputLines = state.input?.render(contentW) ?? [""];
                panel.push(ui.inputRow(inputLines[0] ?? "", true, innerW));
            } else {
                const value = state.input?.getValue() ?? "";
                panel.push(ui.inputRow(value.length > 0 ? `  ${value}` : "", false, innerW));
            }
            if (!tight) panel.push(ui.panelBlank(innerW));
        }

        if (this.errorMessage) {
            panel.push(ui.panelRow([ui.span(` ${this.errorMessage}`, { fg: palette.error })], innerW));
            if (!tight) panel.push(ui.panelBlank(innerW));
        }

        panel.push(ui.menuRow(this.submitLabel, undefined, { selected: this.focusIndex === this.states.length }, innerW));
        panel.push(ui.panelBlank(innerW));
        panel.push(ui.panelBottom(innerW));

        return ui.takeover({
            termWidth: width,
            termHeight: termH,
            panelWidth: panelW,
            panel,
            footer: [[ui.span("Tab/Shift+Tab move   Enter advance / select   Esc cancel", { fg: palette.muted })]],
        });
    }
}

/**
 * Show a full-screen input form. Resolves typed values keyed by field id
 * (int/float fields resolve as numbers, optional empties as undefined,
 * choice fields as the selected option string, everything else verbatim),
 * or null on Escape — and also null outside the TUI.
 */
export async function showForm(
    ctx: ExtensionCommandContext,
    options: AftcFormOptions,
): Promise<Record<string, string | number | undefined> | null> {
    if (ctx.mode !== "tui") return null;
    return ctx.ui.custom<Record<string, string | number | undefined> | null>(
        (_tui, _theme, _keybindings, done) => new AftcForm(options, (v) => done(v)),
        { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" } },
    );
}
// ─── single-input helpers ───────────────────────────────────────────────────

export interface AftcInputOptions {
    title: string;
    /** Field label. Defaults to "Value". */
    label?: string;
    initial?: string;
    required?: boolean;
    /** Mask the value with bullets (secrets). */
    password?: boolean;
    /** Custom validation; return the error message or null. */
    validate?: (value: string) => string | null;
}

/**
 * One text input, Enter submits (Escape cancels to null). Resolves the
 * verbatim string, or null outside the TUI / on Escape.
 */
export async function showInput(ctx: ExtensionCommandContext, options: AftcInputOptions): Promise<string | null> {
    const values = await showForm(ctx, {
        title: options.title,
        submitLabel: "[ OK ]",
        submitOnEnter: true,
        fields: [{
            id: "value",
            label: options.label ?? "Value",
            type: options.password ? "password" : "string",
            ...(options.required ? { required: true } : {}),
            ...(options.initial !== undefined ? { initial: options.initial } : {}),
            ...(options.validate ? { validate: options.validate } : {}),
        }],
    });
    if (!values) return null;
    return typeof values.value === "string" ? values.value : null;
}

export interface AftcNumberInputOptions {
    title: string;
    /** Field label. Defaults to "Value". */
    label?: string;
    initial?: number;
    /** Defaults to true — these helpers exist to return a number. */
    required?: boolean;
    min?: number;
    max?: number;
}

async function showNumberInput(
    ctx: ExtensionCommandContext,
    options: AftcNumberInputOptions,
    type: "int" | "float",
): Promise<number | null> {
    const values = await showForm(ctx, {
        title: options.title,
        submitLabel: "[ OK ]",
        submitOnEnter: true,
        fields: [{
            id: "value",
            label: options.label ?? "Value",
            type,
            required: options.required !== false,
            ...(options.initial !== undefined ? { initial: String(options.initial) } : {}),
            ...(options.min !== undefined ? { min: options.min } : {}),
            ...(options.max !== undefined ? { max: options.max } : {}),
        }],
    });
    if (!values) return null;
    return typeof values.value === "number" ? values.value : null;
}

/**
 * One integer input with live keyup filtering (letters never enter),
 * optional range check, Enter submits. Resolves the number, or null on
 * Escape / outside the TUI (and null for an empty optional field).
 */
export async function showIntInput(ctx: ExtensionCommandContext, options: AftcNumberInputOptions): Promise<number | null> {
    return showNumberInput(ctx, options, "int");
}

/** One float input — same contract as showIntInput with decimals allowed. */
export async function showFloatInput(ctx: ExtensionCommandContext, options: AftcNumberInputOptions): Promise<number | null> {
    return showNumberInput(ctx, options, "float");
}

// ─── viewers ────────────────────────────────────────────────────────────────

/** Panel + footer lines that always exist around a viewer's text rows. */
const VIEWER_CHROME_LINES = 9;

export interface AftcViewerRow {
    text: string;
    /** Colour role: default "text" (white). */
    tone?: "text" | "accent" | "muted";
    /** Bold text (e.g. section titles). */
    bold?: boolean;
    /** Render a full-content-width horizontal rule (text ignored). */
    divider?: boolean;
}

export interface AftcViewerOptions {
    title: string;
    /** Plain text rows (pre-split). Ignored when `rows` is set. */
    lines?: string[];
    /** Toned rows (accent titles, muted hints…). Long text wraps. */
    rows?: AftcViewerRow[];
    /** Footer hint override. */
    help?: string;
}

/**
 * Read-only scrollable text screen (command output, reports, help).
 * ↑/↓ scroll one row, PageUp/PageDown by the viewport, Home/End and
 * Ctrl+PgUp/Ctrl+PgDn jump to the edges. Escape, Enter, or q closes.
 */
export class AftcViewer implements Focusable {
    focused = false;

    private readonly ui: AftcUi;
    private scrollOffset = 0;
    /** Rows painted on the last render — the PageUp/PageDown step. */
    private viewportRowCount = 10;

    constructor(
        private readonly options: AftcViewerOptions,
        private readonly done: () => void,
        palette: AftcPalette = defaultAftcPalette(),
    ) {
        this.ui = new AftcUi(palette);
    }

    handleInput(data: string): void {
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === "q") {
            this.done();
            return;
        }
        if (matchesKey(data, Key.up)) return this.scroll(-1);
        if (matchesKey(data, Key.down)) return this.scroll(1);
        if (matchesKey(data, Key.pageUp)) return this.scroll(-this.viewportRowCount);
        if (matchesKey(data, Key.pageDown)) return this.scroll(this.viewportRowCount);
        if (matchesKey(data, "ctrl+pageup") || matchesKey(data, Key.home) || matchesKey(data, Key.ctrl("a"))) {
            return this.jumpTo(0);
        }
        if (matchesKey(data, "ctrl+pagedown") || matchesKey(data, Key.end) || matchesKey(data, Key.ctrl("e"))) {
            return this.jumpTo(Number.MAX_SAFE_INTEGER);
        }
    }

    private maxOffset(displayRows: AftcViewerRow[]): number {
        return Math.max(0, displayRows.length - this.viewportRowCount);
    }

    /** Scroll by `delta` rows, clamped (no wrap — reading, not picking). */
    private scroll(delta: number): void {
        this.scrollOffset = Math.min(Math.max(0, this.scrollOffset + delta), this.maxOffset(this.lastDisplayRows));
    }

    private jumpTo(offset: number): void {
        this.scrollOffset = Math.min(Math.max(0, offset), this.maxOffset(this.lastDisplayRows));
    }

    /** Display rows from the last render (wrapped) — basis for scroll math. */
    private lastDisplayRows: AftcViewerRow[] = [];

    /** Normalize options to toned rows, then word-wrap every row to `width`. */
    private buildDisplayRows(width: number): AftcViewerRow[] {
        const source: AftcViewerRow[] = this.options.rows ?? (this.options.lines ?? []).map((text) => ({ text }));
        const out: AftcViewerRow[] = [];
        for (const row of source) {
            if (row.divider) {
                // Dividers always span the full content width — every rule
                // on screen has the same length.
                out.push({ ...row, text: "─".repeat(Math.max(1, width)), tone: row.tone ?? "muted" });
                continue;
            }
            if (row.text.length === 0) {
                out.push(row);
                continue;
            }
            for (const wrapped of wrapTextWithAnsi(row.text, Math.max(1, width))) {
                out.push({ ...row, text: wrapped });
            }
        }
        return out;
    }

    invalidate(): void {}

    render(width: number): string[] {
        const ui = this.ui;
        const palette = ui.palette;
        const termH = terminalRows();
        const panelW = ui.panelWidth(width);
        const innerW = Math.max(1, panelW - 2);
        const maxVisible = ui.listViewport(termH, VIEWER_CHROME_LINES);
        const displayRows = this.buildDisplayRows(innerW - 1);
        this.lastDisplayRows = displayRows;
        // Keep the offset legal even if the terminal shrank or rows changed.
        this.scrollOffset = Math.min(this.scrollOffset, this.maxOffset(displayRows));

        const panel: string[] = [];
        panel.push(ui.panelTop(this.options.title, innerW));
        panel.push(ui.panelBlank(innerW));

        if (displayRows.length === 0) {
            panel.push(ui.panelRow([ui.span(" (empty)", { fg: palette.muted })], innerW));
        } else {
            const viewportEnd = Math.min(displayRows.length, this.scrollOffset + maxVisible);
            if (viewportEnd > this.scrollOffset) {
                this.viewportRowCount = viewportEnd - this.scrollOffset;
            }
            for (let i = this.scrollOffset; i < viewportEnd; i++) {
                const row = displayRows[i];
                if (!row) continue;
                const fg = row.tone === "accent" ? palette.accent : row.tone === "muted" ? palette.muted : palette.text;
                panel.push(ui.panelRow([ui.span(` ${row.text}`, { fg, ...(row.bold ? { bold: true } : {}) })], innerW));
            }
            if (displayRows.length > maxVisible) {
                panel.push(ui.panelBlank(innerW));
                panel.push(ui.panelRow([
                    ui.span(` Lines ${this.scrollOffset + 1}–${viewportEnd} of ${displayRows.length}`, { fg: palette.muted }),
                ], innerW));
            }
        }

        panel.push(ui.panelBlank(innerW));
        panel.push(ui.panelBottom(innerW));

        const help = this.options.help ?? "↑↓ scroll   PgUp/PgDn page   Home/End edges   Esc close";
        return ui.takeover({
            termWidth: width,
            termHeight: termH,
            panelWidth: panelW,
            panel,
            footer: [[ui.span(help, { fg: palette.muted })]],
        });
    }
}

/**
 * Show a read-only scrollable text screen. Long lines word-wrap inside
 * the panel. Resolves when the user closes it (Escape / Enter / q).
 * Outside the TUI the lines are printed with the `[aftc-toolset]` prefix.
 */
export async function showViewer(ctx: ExtensionCommandContext, options: AftcViewerOptions): Promise<void> {
    if (ctx.mode !== "tui") {
        const rows: AftcViewerRow[] = options.rows ?? (options.lines ?? []).map((text) => ({ text }));
        for (const row of rows) console.log(`[aftc-toolset] ${row.text}`);
        return;
    }
    await ctx.ui.custom<void>(
        (_tui, _theme, _keybindings, done) => new AftcViewer(options, () => done()),
        { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" } },
    );
}

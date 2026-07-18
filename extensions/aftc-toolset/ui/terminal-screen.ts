// Minimal VT100/xterm virtual screen for the AFTC UI toolkit.
//
// The SSH carrier ships raw PTY byte streams (scrollback), which the old
// /ssh-shell overlay dumped line-by-line: cursor-addressed programs (nano,
// vim, htop, top, less) came out as garbled piles of text. This module
// interprets the stream instead: a fixed-size cell grid with a cursor,
// scroll region, alternate screen, and the common CSI controls, so what
// renders is what a real terminal would show.
//
// Output is AftcSpan rows (the shared UI vocabulary), NOT raw ANSI — the
// overlay composes them with the usual panel primitives, so the terminal
// lives inside the same GRUB-style full-screen takeover as every other
// AFTC screen. Colours are resolved to #rrggbb (SGR 30-37 / 90-97, 256-colour
// cube, and truecolour all map to hex).
//
// Dark-background colour adaptation: xterm's stock palette (and remote
// programs in general) assumes nothing about the background — a dark
// blue `ls` directory on the AFTC overlay's solid black is unreadable.
// renderSpans therefore takes a colour policy: "raw" keeps the faithful
// hex mapping (used by the parser tests), "dark" runs every cell through
// adaptForDarkBackground() — light backgrounds are crushed to a dark
// shade of the same hue with near-white text, and foregrounds that
// would lack contrast are lightened (hue preserved) until they clear a
// luma floor. The cursor cell always keeps its raw inversion so it can
// never blend into the text.
//
// Supported: SGR (colour/bold/reverse), CUP/CUU/CUD/CUF/CUB/CNL/CPL/CHA/VPA,
// ED/EL, IL/DL/ICH/DCH/ECH, SU/SD, DECSTBM scroll regions, IND/NEL/RI,
// save/restore cursor, DEC graphics charset (line drawing), alternate
// screen (?1049/?47/?1047), cursor visibility (?25). OSC sequences are
// skipped. Unsupported: wide (CJK/emoji) cells — every code point occupies
// one column, and underline/dim attributes are dropped (AftcSpan has no
// such channel). This module is a leaf utility: type-only import from
// aftcUi, no feature-module imports.

import { type AftcSpan } from "./aftcUi";

/** One screen cell. fg/bg are #rrggbb or undefined (use palette default). */
interface Cell {
    ch: string;
    fg?: string;
    bg?: string;
    bold: boolean;
    reverse: boolean;
}

interface Cursor {
    x: number;
    y: number;
    visible: boolean;
}

const DEFAULT_CELL: () => Cell = () => ({ ch: " ", bold: false, reverse: false });

// xterm's standard 16 colours.
const ANSI_16 = [
    "#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
    "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff",
];

/** xterm 256-colour palette entry as #rrggbb. */
function ansi256(n: number): string {
    if (n < 16) return ANSI_16[n]!;
    const hex = (v: number) => v.toString(16).padStart(2, "0");
    if (n < 232) {
        const i = n - 16;
        const level = (v: number) => v === 0 ? 0 : 55 + v * 40;
        const r = level(Math.floor(i / 36));
        const g = level(Math.floor((i % 36) / 6));
        const b = level(i % 6);
        return `#${hex(r)}${hex(g)}${hex(b)}`;
    }
    const gray = 8 + (n - 232) * 10;
    return `#${hex(gray)}${hex(gray)}${hex(gray)}`;
}

// ──────────────────────────────────────────────────────────────────────
// Dark-background colour adaptation
//
// The AFTC terminal overlay sits on a solid black background. Colours a
// remote program picks are adapted per cell so output stays readable:
//   1. A LIGHT background (white/yellow/light-gray, e.g. reverse-video
//      status bars) is crushed to a dark shade of the SAME HUE and its
//      text forced near-white — the bar stays visible, the text stays
//      readable.
//   2. A foreground too close in brightness to its background (dark blue
//      `ls` directories, black-on-black) is lightened in HSL steps (hue
//      and saturation preserved) until it clears the contrast floor.
// Everything else passes through untouched. Results are memoised — cells
// repeat the same few colour pairs constantly.
// ──────────────────────────────────────────────────────────────────────

/** Rec.601 luma (perceived brightness) of #rrggbb, 0..255. */
function luma(hex: string): number {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

function hexToRgb(hex: string): [number, number, number] {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h: number;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
    const hue2rgb = (p: number, q: number, t: number): number => {
        let tt = t;
        if (tt < 0) tt += 1;
        if (tt > 1) tt -= 1;
        if (tt < 1 / 6) return p + (q - p) * 6 * tt;
        if (tt < 1 / 2) return q;
        if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
        return p;
    };
    let r: number;
    let g: number;
    let b: number;
    if (s === 0) {
        r = g = b = l;
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    const hex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Backgrounds brighter than this (0..255 luma) count as "light" and get
 *  darkened: catches white, yellow, cyan, light gray AND bright green
 *  (#00cd00, luma ~120 — the `ls` world-writable-directory background),
 *  while keeping genuinely dark colour bars (#cd0000 red, #0000ee blue). */
const LIGHT_BG_LUMA = 100;
/** A crushed background must end up at or below this luma — dark enough
 *  that near-white text always reads well on it. */
const CRUSHED_BG_MAX_LUMA = 55;
/** Minimum luma gap between text and its background. */
const MIN_FG_LUMA_CONTRAST = 90;
/** Text colour forced onto crushed (formerly light) backgrounds. */
const FG_ON_CRUSHED_BG = "#f2f2f2";

const adaptCache = new Map<string, { fg: string; bg: string }>();

/** Adapt one resolved fg/bg pair for readability on a dark background.
 *  Pure; both inputs and outputs are #rrggbb. Exported for unit tests. */
export function adaptForDarkBackground(fg: string, bg: string): { fg: string; bg: string } {
    const key = `${fg}|${bg}`;
    const cached = adaptCache.get(key);
    if (cached) return cached;

    let out: { fg: string; bg: string };
    if (luma(bg) > LIGHT_BG_LUMA) {
        // Light/bright background (white status bar, green `ls` marker,
        // yellow highlight, ...): darken in HSL steps — hue and
        // saturation preserved — until it is a genuinely dark bar
        // (green -> ~#005c00, white -> ~#333333), then force near-white
        // text on it so the bar stays readable.
        const { h, s, l } = rgbToHsl(...hexToRgb(bg));
        let crushed = hslToHex(h, s, 0.08); // darkest fallback
        for (let nl = l; nl >= 0.08; nl -= 0.02) {
            const candidate = hslToHex(h, s, nl);
            crushed = candidate;
            if (luma(candidate) <= CRUSHED_BG_MAX_LUMA) break;
        }
        out = { fg: FG_ON_CRUSHED_BG, bg: crushed };
    } else if (luma(fg) - luma(bg) >= MIN_FG_LUMA_CONTRAST) {
        out = { fg, bg }; // already readable — untouched
    } else {
        // Too little contrast: lighten the foreground in HSL steps (hue
        // and saturation preserved) until it clears the floor.
        const { h, s, l } = rgbToHsl(...hexToRgb(fg));
        const bgLuma = luma(bg);
        let best = fg;
        for (let nl = l; nl <= 0.95; nl += 0.02) {
            const candidate = hslToHex(h, s, nl);
            if (luma(candidate) - bgLuma >= MIN_FG_LUMA_CONTRAST) {
                best = candidate;
                break;
            }
            best = candidate;
        }
        out = { fg: best, bg };
    }

    if (adaptCache.size > 4096) adaptCache.clear();
    adaptCache.set(key, out);
    return out;
}

// DEC special-graphics charset (used by htop, nano, mc, ...).
const DEC_GRAPHICS: Record<string, string> = {
    q: "─", x: "│", l: "┌", k: "┐", m: "└", j: "┘", t: "├", u: "┤",
    v: "┴", w: "┬", n: "┼", a: "▒", f: "°", g: "±", h: "░", e: "␤",
};

export class TerminalScreen {
    private grid: Cell[][];
    private mainGrid: Cell[][] | undefined;
    private cursor: Cursor = { x: 0, y: 0, visible: true };
    private savedCursor: Cursor = { x: 0, y: 0, visible: true };
    private mainCursor: Cursor | undefined;
    private fg: string | undefined;
    private bg: string | undefined;
    private bold = false;
    private reverse = false;
    private decGraphics = false;
    private scrollTop = 0;
    private scrollBottom: number;
    /** Parser state for an in-progress escape sequence across writes. */
    private pending = "";

    constructor(
        private readonly cols: number,
        private readonly rows: number,
    ) {
        this.grid = this.blankGrid();
        this.scrollBottom = rows - 1;
    }

    private blankGrid(): Cell[][] {
        return Array.from({ length: this.rows }, () => Array.from({ length: this.cols }, DEFAULT_CELL));
    }

    private cellAt(y: number, x: number): Cell | undefined {
        return this.grid[y]?.[x];
    }

    /** Feed a raw PTY chunk into the screen. */
    public write(data: string): void {
        const input = this.pending + data;
        this.pending = "";
        let i = 0;
        while (i < input.length) {
            const ch = input[i]!;
            if (ch === "\x1b") {
                const consumed = this.consumeEscape(input, i);
                if (consumed === -1) {
                    // Incomplete sequence: stash the tail for the next write.
                    this.pending = input.slice(i);
                    return;
                }
                i = consumed;
                continue;
            }
            if (ch === "\r") { this.cursor.x = 0; i++; continue; }
            if (ch === "\n" || ch === "\x0b" || ch === "\x0c") { this.lineFeed(); i++; continue; }
            if (ch === "\b") { this.cursor.x = Math.max(0, this.cursor.x - 1); i++; continue; }
            if (ch === "\t") { this.cursor.x = Math.min(this.cols - 1, (Math.floor(this.cursor.x / 8) + 1) * 8); i++; continue; }
            if (ch === "\x07" || ch === "\x0e" || ch === "\x0f") { i++; continue; } // BEL, SO/SI
            this.putChar(this.decGraphics ? (DEC_GRAPHICS[ch] ?? ch) : ch);
            i++;
        }
    }

    /**
     * Handle an escape sequence starting at input[i] ("\x1b"). Returns the
     * index just past the sequence, or -1 when the sequence is incomplete.
     */
    private consumeEscape(input: string, i: number): number {
        const next = input[i + 1];
        if (next === undefined) return -1;
        if (next === "[") {
            // CSI: params/intermediates until a final byte in @-~.
            let j = i + 2;
            while (j < input.length && !/[@-~]/.test(input[j]!)) j++;
            if (j >= input.length) return -1;
            this.applyCsi(input.slice(i + 2, j), input[j]!);
            return j + 1;
        }
        if (next === "]") {
            // OSC: terminated by BEL or ST (\x1b\\).
            const bel = input.indexOf("\x07", i + 2);
            const st = input.indexOf("\x1b\\", i + 2);
            if (st !== -1 && (bel === -1 || st < bel)) return st + 2;
            if (bel !== -1) return bel + 1;
            return -1;
        }
        if (next === "(" || next === ")" || next === "*") {
            // Charset designation; only (0 switches DEC graphics on.
            const designator = input[i + 2];
            if (designator === undefined) return -1;
            if (next === "(") this.decGraphics = designator === "0";
            return i + 3;
        }
        if (next === "D") { this.lineFeed(); return i + 2; } // IND
        if (next === "E") { this.cursor.x = 0; this.lineFeed(); return i + 2; } // NEL
        if (next === "M") { // RI
            if (this.cursor.y === this.scrollTop) this.scrollDown(1);
            else this.cursor.y = Math.max(0, this.cursor.y - 1);
            return i + 2;
        }
        if (next === "7") { this.savedCursor = { ...this.cursor }; return i + 2; }
        if (next === "8") { this.cursor = { ...this.savedCursor }; return i + 2; }
        if (next === "c") { this.softReset(); return i + 2; } // RIS
        // Unknown single-character escape: skip it.
        return i + 2;
    }

    private applyCsi(rawParams: string, finalByte: string): void {
        const isPrivate = rawParams.startsWith("?");
        const body = isPrivate ? rawParams.slice(1) : rawParams;
        const params = body.split(";").map((p) => (p === "" ? 0 : Number.parseInt(p, 10)));
        const n = (index: number, fallback: number) => {
            const value = params[index];
            return value === undefined || Number.isNaN(value) || value === 0 ? fallback : value;
        };

        if (isPrivate) {
            if (finalByte === "h" || finalByte === "l") {
                const enable = finalByte === "h";
                for (const p of params) this.applyPrivateMode(p, enable);
            }
            return;
        }

        switch (finalByte) {
            case "m": this.applySgr(params.length === 0 ? [0] : params); return;
            case "H": case "f":
                this.cursor.y = this.clampRow(n(0, 1) - 1);
                this.cursor.x = this.clampCol(n(1, 1) - 1);
                return;
            case "A": this.cursor.y = Math.max(0, this.cursor.y - n(0, 1)); return;
            case "B": this.cursor.y = Math.min(this.rows - 1, this.cursor.y + n(0, 1)); return;
            case "C": this.cursor.x = Math.min(this.cols - 1, this.cursor.x + n(0, 1)); return;
            case "D": this.cursor.x = Math.max(0, this.cursor.x - n(0, 1)); return;
            case "E": this.cursor.y = Math.min(this.rows - 1, this.cursor.y + n(0, 1)); this.cursor.x = 0; return;
            case "F": this.cursor.y = Math.max(0, this.cursor.y - n(0, 1)); this.cursor.x = 0; return;
            case "G": case "`": this.cursor.x = this.clampCol(n(0, 1) - 1); return;
            case "d": this.cursor.y = this.clampRow(n(0, 1) - 1); return;
            case "J": this.eraseDisplay(params[0] ?? 0); return;
            case "K": this.eraseLine(params[0] ?? 0); return;
            case "L": this.insertLines(n(0, 1)); return;
            case "M": this.deleteLines(n(0, 1)); return;
            case "@": this.insertChars(n(0, 1)); return;
            case "P": this.deleteChars(n(0, 1)); return;
            case "X": this.eraseChars(n(0, 1)); return;
            case "S": this.scrollUp(n(0, 1)); return;
            case "T": this.scrollDown(n(0, 1)); return;
            case "r":
                this.scrollTop = this.clampRow(n(0, 1) - 1);
                this.scrollBottom = this.clampRow(n(1, this.rows) - 1);
                if (this.scrollBottom < this.scrollTop) [this.scrollTop, this.scrollBottom] = [this.scrollBottom, this.scrollTop];
                this.cursor.x = 0;
                this.cursor.y = 0;
                return;
            case "s": this.savedCursor = { ...this.cursor }; return;
            case "u": this.cursor = { ...this.savedCursor }; return;
            default: return; // Unhandled CSI: ignore.
        }
    }

    private applyPrivateMode(mode: number, enable: boolean): void {
        if (mode === 25) { this.cursor.visible = enable; return; }
        if (mode === 1049 || mode === 1047 || mode === 47) {
            if (enable && !this.mainGrid) {
                this.mainGrid = this.grid;
                this.mainCursor = { ...this.cursor };
                this.grid = this.blankGrid();
                this.cursor.x = 0;
                this.cursor.y = 0;
            } else if (!enable && this.mainGrid) {
                this.grid = this.mainGrid;
                this.mainGrid = undefined;
                if (this.mainCursor) this.cursor = this.mainCursor;
                this.mainCursor = undefined;
            }
        }
    }

    private applySgr(params: number[]): void {
        for (let k = 0; k < params.length; k++) {
            const p = params[k]!;
            if (p === 0) { this.fg = undefined; this.bg = undefined; this.bold = false; this.reverse = false; }
            else if (p === 1) this.bold = true;
            else if (p === 22) this.bold = false;
            else if (p === 7) this.reverse = true;
            else if (p === 27) this.reverse = false;
            else if (p === 39) this.fg = undefined;
            else if (p === 49) this.bg = undefined;
            else if (p >= 30 && p <= 37) this.fg = ANSI_16[p - 30];
            else if (p >= 40 && p <= 47) this.bg = ANSI_16[p - 40];
            else if (p >= 90 && p <= 97) this.fg = ANSI_16[p - 90 + 8];
            else if (p >= 100 && p <= 107) this.bg = ANSI_16[p - 100 + 8];
            else if ((p === 38 || p === 48) && params[k + 1] === 5) {
                const colour = ansi256(params[k + 2] ?? 0);
                if (p === 38) this.fg = colour; else this.bg = colour;
                k += 2;
            } else if ((p === 38 || p === 48) && params[k + 1] === 2) {
                const r = params[k + 2] ?? 0;
                const g = params[k + 3] ?? 0;
                const b = params[k + 4] ?? 0;
                const hex = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
                if (p === 38) this.fg = `#${hex(r)}${hex(g)}${hex(b)}`;
                else this.bg = `#${hex(r)}${hex(g)}${hex(b)}`;
                k += 4;
            }
        }
    }

    private putChar(ch: string): void {
        if (this.cursor.x >= this.cols) {
            this.cursor.x = 0;
            this.lineFeed();
        }
        const cell = this.cellAt(this.cursor.y, this.cursor.x);
        if (cell) {
            cell.ch = ch;
            cell.fg = this.fg;
            cell.bg = this.bg;
            cell.bold = this.bold;
            cell.reverse = this.reverse;
        }
        this.cursor.x++;
    }

    private lineFeed(): void {
        if (this.cursor.y === this.scrollBottom) this.scrollUp(1);
        else if (this.cursor.y < this.rows - 1) this.cursor.y++;
    }

    private scrollUp(count: number): void {
        for (let k = 0; k < count; k++) {
            this.grid.splice(this.scrollTop, 1);
            this.grid.splice(this.scrollBottom, 0, Array.from({ length: this.cols }, DEFAULT_CELL));
        }
    }

    private scrollDown(count: number): void {
        for (let k = 0; k < count; k++) {
            this.grid.splice(this.scrollBottom, 1);
            this.grid.splice(this.scrollTop, 0, Array.from({ length: this.cols }, DEFAULT_CELL));
        }
    }

    private insertLines(count: number): void {
        if (this.cursor.y < this.scrollTop || this.cursor.y > this.scrollBottom) return;
        for (let k = 0; k < count; k++) {
            this.grid.splice(this.scrollBottom, 1);
            this.grid.splice(this.cursor.y, 0, Array.from({ length: this.cols }, DEFAULT_CELL));
        }
    }

    private deleteLines(count: number): void {
        if (this.cursor.y < this.scrollTop || this.cursor.y > this.scrollBottom) return;
        for (let k = 0; k < count; k++) {
            this.grid.splice(this.cursor.y, 1);
            this.grid.splice(this.scrollBottom, 0, Array.from({ length: this.cols }, DEFAULT_CELL));
        }
    }

    private insertChars(count: number): void {
        const row = this.grid[this.cursor.y];
        if (!row) return;
        for (let k = 0; k < count; k++) {
            row.splice(this.cursor.x, 0, DEFAULT_CELL());
            row.length = this.cols;
        }
    }

    private deleteChars(count: number): void {
        const row = this.grid[this.cursor.y];
        if (!row) return;
        for (let k = 0; k < count; k++) {
            row.splice(this.cursor.x, 1);
            row.push(DEFAULT_CELL());
        }
    }

    private eraseChars(count: number): void {
        for (let x = this.cursor.x; x < Math.min(this.cols, this.cursor.x + count); x++) {
            const cell = this.cellAt(this.cursor.y, x);
            if (cell) Object.assign(cell, DEFAULT_CELL());
        }
    }

    private eraseDisplay(mode: number): void {
        if (mode === 2 || mode === 3) {
            this.grid = this.blankGrid();
            return;
        }
        if (mode === 0) {
            this.eraseLine(0);
            for (let y = this.cursor.y + 1; y < this.rows; y++) this.blankRow(y);
        } else if (mode === 1) {
            for (let y = 0; y < this.cursor.y; y++) this.blankRow(y);
            this.eraseLine(1);
        }
    }

    private eraseLine(mode: number): void {
        const start = mode === 1 ? 0 : mode === 2 ? 0 : this.cursor.x;
        const end = mode === 1 ? this.cursor.x : this.cols - 1;
        for (let x = start; x <= end; x++) {
            const cell = this.cellAt(this.cursor.y, x);
            if (cell) Object.assign(cell, DEFAULT_CELL());
        }
    }

    private blankRow(y: number): void {
        const row = this.grid[y];
        if (row) for (const cell of row) Object.assign(cell, DEFAULT_CELL());
    }

    private softReset(): void {
        this.grid = this.blankGrid();
        this.mainGrid = undefined;
        this.cursor = { x: 0, y: 0, visible: true };
        this.savedCursor = { ...this.cursor };
        this.fg = undefined;
        this.bg = undefined;
        this.bold = false;
        this.reverse = false;
        this.decGraphics = false;
        this.scrollTop = 0;
        this.scrollBottom = this.rows - 1;
    }

    private clampRow(y: number): number {
        return Math.max(0, Math.min(this.rows - 1, y));
    }

    private clampCol(x: number): number {
        return Math.max(0, Math.min(this.cols - 1, x));
    }

    /**
     * Render the grid as full-width AftcSpan rows (every row exactly `cols`
     * cells, blanks included, so the caller's panel padding never fights the
     * screen background). Consecutive cells sharing attributes are grouped
     * into one span. `defaults` supplies the palette colours for unset
     * fg/bg; when `drawCursor` is set the cursor cell is inverted.
     *
     * `colorPolicy` selects the colour mapping: "raw" (default) is the
     * faithful xterm hex mapping (used by the parser tests); "dark" adapts
     * every cell for readability on the overlay's dark background via
     * adaptForDarkBackground(). The cursor cell always keeps its raw
     * inversion, so it can never blend into the surrounding text.
     */
    public renderSpans(
        defaults: { text: string; background: string },
        drawCursor = true,
        colorPolicy: "raw" | "dark" = "raw",
    ): AftcSpan[][] {
        const out: AftcSpan[][] = [];
        for (let y = 0; y < this.rows; y++) {
            const spans: AftcSpan[] = [];
            let run: { text: string; fg: string; bg: string; bold: boolean } | undefined;
            for (let x = 0; x < this.cols; x++) {
                const cell = this.cellAt(y, x) ?? DEFAULT_CELL();
                let fg = cell.fg ?? defaults.text;
                let bg = cell.bg ?? defaults.background;
                if (cell.reverse) [fg, bg] = [bg, fg];
                const isCursor = drawCursor && this.cursor.visible && y === this.cursor.y && x === this.cursor.x;
                if (isCursor) [fg, bg] = [bg, fg];
                if (colorPolicy === "dark" && !isCursor) {
                    const adapted = adaptForDarkBackground(fg, bg);
                    fg = adapted.fg;
                    bg = adapted.bg;
                }
                if (run && run.fg === fg && run.bg === bg && run.bold === cell.bold) {
                    run.text += cell.ch;
                } else {
                    if (run) spans.push({ text: run.text, fg: run.fg, bg: run.bg, ...(run.bold ? { bold: true } : {}) });
                    run = { text: cell.ch, fg, bg, bold: cell.bold };
                }
            }
            if (run) spans.push({ text: run.text, fg: run.fg, bg: run.bg, ...(run.bold ? { bold: true } : {}) });
            out.push(spans);
        }
        return out;
    }
}

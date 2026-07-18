// Full-screen interactive SSH terminal for `/ssh-shell`.
//
// A GRUB-style AFTC takeover (same frame as /ssh-cm and every other toolset
// screen): solid black background, centred #555555-bordered panel, accent
// title, hints below the box. The remote terminal lives inside the panel as
// a live virtual screen (ui/terminal-screen.ts) — cursor-addressed programs
// (nano, vim, htop, top, less) render properly instead of piling up as
// stripped scrollback, and pi's own text can never bleed through behind it.
//
// Keys: text, navigation, function keys, editing keys, and Ctrl chords are
// forwarded to the remote shell; pasted multi-character input goes as
// bracketed paste; Escape is forwarded to the remote program; Ctrl+] is the
// local-only escape chord that closes the screen. The remote PTY is resized
// to match the panel's inner viewport. Polling is bounded; the timer stops
// when the shell closes, fails, or the screen is dismissed.

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Focusable } from "@earendil-works/pi-tui";
import { AftcUi, terminalRows, defaultAftcPalette, type AftcPalette } from "../../ui/aftcUi";
import { TerminalScreen } from "../../ui/terminal-screen";
import type { SshSessionManager } from "./session";

const POLL_INTERVAL_MS = 150;
/** Panel chrome + footer lines that always exist; the terminal viewport
 * gets everything else down to a small minimum. */
const CHROME_LINES = 8;
/** Widest panel the terminal will grow to; narrower terminals go full-bleed. */
const PANEL_WIDTH = 110;
const MIN_VIEWPORT_COLS = 20;
const MIN_VIEWPORT_ROWS = 4;

function terminalKey(data: string): string | undefined {
    const keys: Array<[string, string]> = [
        [Key.enter, "enter"], [Key.tab, "tab"], [Key.escape, "escape"],
        [Key.backspace, "backspace"], [Key.delete, "delete"], [Key.home, "home"],
        [Key.end, "end"], [Key.pageUp, "pageup"], [Key.pageDown, "pagedown"],
        [Key.up, "up"], [Key.down, "down"], [Key.left, "left"], [Key.right, "right"],
    ];
    for (const [key, name] of keys) if (matchesKey(data, key)) return name;
    for (let code = 1; code <= 26; code++) {
        const character = String.fromCharCode(96 + code);
        if (matchesKey(data, Key.ctrl(character))) return `ctrl+${character}`;
    }
    for (let number = 1; number <= 12; number++) {
        if (matchesKey(data, `f${number}`)) return `f${number}`;
    }
    if (/^\x1b\[1[5-9]~$/.test(data)) return `f${Number(data.slice(3, -1)) - 10}`;
    return data.length > 0 && !data.startsWith("\x1b") ? data : undefined;
}

class SshTerminalScreen implements Focusable {
    focused = false;

    private closed = false;
    private polling = false;
    private resizePending = false;
    private termCols = 80;
    private termRows = 24;
    private screen = new TerminalScreen(this.termCols, this.termRows);
    private lastSnapshot = "";
    private truncated = false;
    private readonly ui: AftcUi;
    private readonly timer: ReturnType<typeof setInterval>;

    constructor(
        private readonly sessions: SshSessionManager,
        private readonly sessionId: string,
        private readonly shellId: string,
        private readonly sessionName: string,
        private readonly requestRender: () => void,
        private readonly done: () => void,
        palette: AftcPalette = defaultAftcPalette(),
    ) {
        this.ui = new AftcUi(palette);
        this.screen.write("Waiting for remote shell output...");
        this.timer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
        void this.refresh();
    }

    public handleInput(data: string): void {
        // Ctrl+] is a local escape chord and is never forwarded remotely.
        if (matchesKey(data, Key.ctrl("]"))) {
            this.close();
            return;
        }
        const key = terminalKey(data);
        if (!key) return;
        const send = key === data && [...data].length > 1
            ? this.sessions.paste(this.sessionId, this.shellId, data)
            : this.sessions.sendKeys(this.sessionId, this.shellId, [key]);
        void send.then(() => this.requestRender())
            .catch(() => this.fail());
    }

    public render(width: number): string[] {
        const ui = this.ui;
        const palette = ui.palette;
        const termH = terminalRows();
        const panelW = ui.panelWidth(width, PANEL_WIDTH);
        const innerW = Math.max(MIN_VIEWPORT_COLS, panelW - 2);
        const viewportRows = Math.max(MIN_VIEWPORT_ROWS, termH - CHROME_LINES);
        this.resizeViewport(innerW, viewportRows);

        const panel: string[] = [];
        panel.push(ui.panelTop(`SSH terminal — ${this.sessionName}`, innerW));
        panel.push(ui.panelBlank(innerW));
        const rows = this.screen.renderSpans({ text: palette.text, background: palette.background }, true, "dark");
        for (const spans of rows) panel.push(ui.panelRow(spans, innerW));
        panel.push(ui.panelBlank(innerW));
        panel.push(ui.panelBottom(innerW));

        const hints = ["Ctrl+] exit   Esc → remote"];
        if (this.truncated) hints.push("older output discarded");
        return ui.takeover({
            termWidth: width,
            termHeight: termH,
            panelWidth: panelW,
            panel,
            footer: [[ui.span(hints.join("   "), { fg: palette.muted })]],
        });
    }

    public invalidate(): void {}

    public close(): void {
        if (this.closed) return;
        this.closed = true;
        clearInterval(this.timer);
        this.done();
    }

    private fail(): void {
        this.close();
    }

    /** Rebuild the virtual screen at a new size and replay the snapshot. */
    private resizeViewport(cols: number, rows: number): void {
        if (cols === this.termCols && rows === this.termRows) return;
        this.termCols = cols;
        this.termRows = rows;
        this.rebuildScreen();
        if (this.resizePending || this.closed) return;
        this.resizePending = true;
        void this.sessions.resizeShell(this.sessionId, this.shellId, cols, rows)
            .catch(() => this.fail())
            .finally(() => { this.resizePending = false; });
    }

    private rebuildScreen(): void {
        const screen = new TerminalScreen(this.termCols, this.termRows);
        if (this.lastSnapshot) screen.write(this.lastSnapshot);
        else screen.write("Waiting for remote shell output...");
        this.screen = screen;
    }

    private async refresh(): Promise<void> {
        if (this.closed || this.polling) return;
        this.polling = true;
        try {
            const output = await this.sessions.peek(this.sessionId, this.shellId);
            const text = this.sessions.redactText(this.sessionId, output.text || "(no output)");
            this.truncated = output.truncated;
            if (text !== this.lastSnapshot) {
                this.lastSnapshot = text;
                this.rebuildScreen();
            }
            this.requestRender();
        } catch {
            this.fail();
        } finally {
            this.polling = false;
        }
    }
}

export async function showSshTerminal(
    ctx: ExtensionCommandContext,
    sessions: SshSessionManager,
    sessionId: string,
    shellId: string,
): Promise<void> {
    if (ctx.mode !== "tui") {
        ctx.ui.notify("Interactive SSH terminal requires Pi's TUI mode.", "warning");
        return;
    }
    const sessionName = sessions.list().find((session) => session.id === sessionId)?.name ?? "session";
    let screen: SshTerminalScreen | undefined;
    try {
        await ctx.ui.custom<void>((tui, _theme, _keybindings, done) => {
            const created = new SshTerminalScreen(sessions, sessionId, shellId, sessionName, () => tui.requestRender(), () => done());
            screen = created;
            return created;
        }, { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" } });
    } finally {
        screen?.close();
    }
}

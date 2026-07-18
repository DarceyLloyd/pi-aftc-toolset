// Full-screen SSH connection manager.
//
// Opened by `/ssh-connection-manager` (alias `/ssh-cm`), both registered
// at the bottom of this file and wired into pi by the SSH module
// (ssh/index.ts). The manager is a GRUB-style full-screen takeover built
// on the shared AFTC UI toolkit (ui/aftcUi.ts): solid black background,
// centred #555555-bordered panel, #fca02f accents, and a dark-orange
// selection bar on the active row.
//
// Focus model (Tab / Shift+Tab cycles):
//   - With saved connections: connection list <-> bottom options row.
//   - Without saved connections: options row <-> nothing (Tab de-selects
//     the option; there is no list to focus).
// Exactly one element looks active at any time: the focused list row or
// the focused option carries the full-width selection bar; the other is
// rendered plain.
// The connection list keeps the /cd navigation contract: ↑/↓ wrap,
// PageUp/PageDown jump by the visible viewport, Home/End jump to edges.
// The bottom options row holds [ Add new connection ] [ Edit ] [ Delete ]
// ([] Edit ]/[ Delete ] only when a connection is selected); ←/→ moves
// between options, Enter activates the focused option. Enter on a list
// row is intentionally NOT handled.
// Escape (and Ctrl+C) close the manager and return to the pi prompt.
//
// Only the saved name and a `username@host[:port]` description are
// shown. No password, key path, or fingerprint is emitted here — the
// privacy boundary still holds.

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Focusable } from "@earendil-works/pi-tui";
import { AftcUi, terminalRows, defaultAftcPalette, type AftcPalette, type AftcSpan } from "../../ui/aftcUi";
import { findSshConnection, getSshConnections, removeSshConnection, saveSshConnection, type SshConnection } from "../connection-store";
import { editConnectionSettings } from "../connection-form";
import { confirmOverlay } from "../confirmation-overlay";
import { runNewConnectionFlow } from "./NewConnectionDialog";

const TITLE = "AFTC SSH Connection manager";
/** Maximum rows rendered in the list viewport. Larger lists scroll. */
const MAX_VISIBLE_ROWS = 20;
/** Panel + footer lines that always exist (borders, header, options row,
 * hints). The list viewport is capped to `terminalRows - CHROME_LINES`
 * so the panel never overflows short terminals. */
const CHROME_LINES = 14;
/** Panel width in columns; narrower terminals render the panel full-bleed. */
const PANEL_WIDTH = 78;

interface ConnectionRow {
    connection: SshConnection;
    label: string;
    description: string;
}

/** Focusable areas of the manager. "none" only occurs in the empty state. */
type FocusArea = "list" | "option" | "none";

/** Bottom-row actions. Edit/Delete need a selected connection to act on. */
type OptionId = "add" | "edit" | "delete";

/** What the screen resolved with. The caller decides the follow-up action. */
export type ConnectionManagerResult =
    | { kind: "cancelled" }
    | { kind: "add" }
    | { kind: "edit"; name: string }
    | { kind: "delete"; name: string };

/**
 * Full-screen SSH connection manager. Satisfies `Component + Focusable`
 * so the TUI can hand it keyboard focus and route input.
 */
export class ConnectionManagerScreen implements Focusable {
    focused = false;

    private readonly rows: ConnectionRow[];
    private readonly ui: AftcUi;
    private selectedIndex = 0;
    private scrollOffset = 0;
    /** Last number of rows actually painted — used for PageUp/PageDown step. */
    private viewportRowCount = 10;
    /** Which area currently owns keyboard input. */
    private focusArea: FocusArea;
    /** Which bottom-row option is focused (when the options row has focus). */
    private optionIndex = 0;

    constructor(
        private readonly done: (result: ConnectionManagerResult) => void,
        palette: AftcPalette = defaultAftcPalette(),
    ) {
        this.ui = new AftcUi(palette);
        const connections = getSshConnections();
        this.rows = connections.map((c) => ({
            connection: c,
            label: c.name,
            description: this.formatDescription(c),
        }));
        // Empty state: the options row is the only actionable control, so
        // it starts focused. Tab then de-selects it ("none").
        this.focusArea = this.rows.length > 0 ? "list" : "option";
    }

    /** Snapshot of the highlighted row, or undefined if the list is empty. */
    public selected(): ConnectionRow | undefined {
        return this.rows[this.selectedIndex];
    }

    public get hasConnections(): boolean {
        return this.rows.length > 0;
    }

    /** Options offered on the bottom row in the current state. */
    private visibleOptions(): { id: OptionId; label: string }[] {
        const options: { id: OptionId; label: string }[] = [{ id: "add", label: "[ Add new connection ]" }];
        if (this.rows.length > 0) {
            options.push({ id: "edit", label: "[ Edit ]" }, { id: "delete", label: "[ Delete ]" });
        }
        return options;
    }

    private formatDescription(c: SshConnection): string {
        const userHost = `${c.username}@${c.host}`;
        // Hide the default port to keep the description tidy.
        const port = c.port !== undefined && c.port !== 22 ? `:${c.port}` : "";
        return `${userHost}${port}`;
    }

    handleInput(data: string): void {
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
            this.done({ kind: "cancelled" });
            return;
        }
        // Tab / Shift+Tab moves focus between the list and the options row.
        // (matchesKey(Key.tab) only matches "\t"; Shift+Tab is "\x1b[Z".)
        if (matchesKey(data, Key.tab) || data === "\x1b[Z") {
            this.cycleFocus(data === "\x1b[Z" ? -1 : 1);
            return;
        }
        // Enter activates the focused bottom option. Enter on a list row is
        // deliberately unhandled (actions go through the options row).
        if (matchesKey(data, Key.enter)) {
            if (this.focusArea === "option") {
                this.activateOption();
            }
            return;
        }
        // ←/→ moves between bottom-row options when the row has focus.
        if (this.focusArea === "option") {
            if (matchesKey(data, Key.left)) {
                this.moveOption(-1);
                return;
            }
            if (matchesKey(data, Key.right)) {
                this.moveOption(1);
                return;
            }
            return;
        }
        // Everything below is list navigation — only when the list has focus.
        if (this.focusArea !== "list") return;

        if (matchesKey(data, Key.up)) {
            this.moveSelection(-1);
            return;
        }
        if (matchesKey(data, Key.down)) {
            this.moveSelection(1);
            return;
        }
        if (matchesKey(data, Key.pageUp)) {
            this.moveByPage(-this.viewportRowCount);
            return;
        }
        if (matchesKey(data, Key.pageDown)) {
            this.moveByPage(this.viewportRowCount);
            return;
        }
        if (matchesKey(data, Key.home) || matchesKey(data, Key.ctrl("a"))) {
            this.jumpToEdge("top");
            return;
        }
        if (matchesKey(data, Key.end) || matchesKey(data, Key.ctrl("e"))) {
            this.jumpToEdge("bottom");
            return;
        }
    }

    /**
     * Tab cycle order. With connections: list <-> option. Without
     * connections: option <-> none (Tab de-selects the only option).
     */
    private cycleFocus(delta: number): void {
        const areas: FocusArea[] = this.rows.length > 0
            ? ["list", "option"]
            : ["option", "none"];
        const index = areas.indexOf(this.focusArea);
        const next = areas[(index + delta + areas.length) % areas.length];
        if (next) this.focusArea = next;
    }

    /** Move the focused bottom-row option, wrapping at the edges. */
    private moveOption(delta: number): void {
        const total = this.visibleOptions().length;
        this.optionIndex = (this.optionIndex + delta + total) % total;
    }

    /** Activate the focused bottom-row option. */
    private activateOption(): void {
        const option = this.visibleOptions()[this.optionIndex];
        if (!option) return;
        if (option.id === "add") {
            this.done({ kind: "add" });
            return;
        }
        // Edit/Delete act on the highlighted connection. The row always
        // exists: those options are hidden when the list is empty.
        const name = this.selected()?.connection.name;
        if (!name) return;
        this.done(option.id === "edit" ? { kind: "edit", name } : { kind: "delete", name });
    }

    private moveSelection(delta: number): void {
        const total = this.rows.length;
        if (total === 0) return;
        // Wraps around at the edges, matching /cd behaviour.
        this.selectedIndex = (this.selectedIndex + delta + total) % total;
        this.clampScroll();
    }

    private moveByPage(delta: number): void {
        const total = this.rows.length;
        if (total === 0) return;
        // Clamps at row 0 / last — no wrap-around for page navigation.
        let target = this.selectedIndex + delta;
        if (target < 0) target = 0;
        if (target >= total) target = total - 1;
        this.selectedIndex = target;
        this.clampScroll();
    }

    private jumpToEdge(edge: "top" | "bottom"): void {
        const total = this.rows.length;
        if (total === 0) return;
        this.selectedIndex = edge === "top" ? 0 : total - 1;
        this.clampScroll();
    }

    /**
     * Keep `selectedIndex` inside `[scrollOffset, scrollOffset + viewportRowCount)`
     * and never leave empty rows at the bottom of the viewport.
     */
    private clampScroll(): void {
        const total = this.rows.length;
        if (total === 0) {
            this.scrollOffset = 0;
            return;
        }
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
        // Full-screen takeover: never render wider than pi's width (that
        // would crash the TUI) and never taller than the terminal.
        const panelW = ui.panelWidth(width, PANEL_WIDTH);
        const innerW = Math.max(1, panelW - 2);
        const maxVisible = ui.listViewport(termH, CHROME_LINES, MAX_VISIBLE_ROWS);

        const panel: string[] = [];
        panel.push(ui.panelTop(TITLE, innerW));
        panel.push(ui.panelBlank(innerW));

        if (this.rows.length === 0) {
            // Empty state: header + hint pointing the user at the Add option.
            panel.push(ui.panelRow([ui.span(" No saved connections.", { fg: palette.accent, bold: true })], innerW));
            panel.push(ui.panelSeparator(innerW));
            panel.push(ui.panelBlank(innerW));
            panel.push(ui.panelRow([ui.span("   No saved SSH connections yet.")], innerW));
            panel.push(ui.panelBlank(innerW));
            panel.push(ui.panelRow([
                ui.span("   Tab to ", { fg: palette.muted }),
                ui.span("Add new connection", { fg: palette.accent }),
                ui.span(" and press Enter to create one.", { fg: palette.muted }),
            ], innerW));
        } else {
            // Populated state: count header, separator, then a scrolling list.
            panel.push(ui.panelRow([
                ui.span(` Saved connections (${this.rows.length})`, { fg: palette.accent, bold: true }),
            ], innerW));
            panel.push(ui.panelSeparator(innerW));
            panel.push(ui.panelBlank(innerW));

            const viewportEnd = Math.min(this.rows.length, this.scrollOffset + maxVisible);
            // Track how many rows we actually painted so PageUp/PageDown match
            // the visible viewport size.
            if (viewportEnd > this.scrollOffset) {
                this.viewportRowCount = viewportEnd - this.scrollOffset;
            }
            for (let i = this.scrollOffset; i < viewportEnd; i++) {
                const row = this.rows[i];
                if (!row) continue;
                // The selection bar only shows while the list owns focus —
                // when the options row is focused the list is de-emphasised.
                const active = i === this.selectedIndex && this.focusArea === "list";
                panel.push(ui.menuRow(row.label, row.description, { selected: active, labelWidth: 20 }, innerW));
            }

            // Position indicator only when the list actually overflows.
            if (this.rows.length > maxVisible) {
                panel.push(ui.panelBlank(innerW));
                panel.push(ui.panelRow([
                    ui.span(` Rows ${this.scrollOffset + 1}–${viewportEnd} of ${this.rows.length}`, { fg: palette.muted }),
                ], innerW));
            }
        }

        // Bottom options row (Tab-reachable in every state). The focused
        // option carries the selection bar; the others render plain.
        panel.push(ui.panelBlank(innerW));
        const optionSpans: AftcSpan[] = [];
        this.visibleOptions().forEach((option, index) => {
            const focused = this.focusArea === "option" && index === this.optionIndex;
            if (index > 0) optionSpans.push(ui.span("   "));
            optionSpans.push(focused
                ? ui.span(option.label, { fg: palette.accent, bg: palette.selectionBg, bold: true })
                : ui.span(option.label, { fg: palette.accent }));
        });
        panel.push(ui.panelRow(optionSpans, innerW, this.focusArea === "option" ? palette.selectionBg : undefined));
        panel.push(ui.panelBlank(innerW));
        panel.push(ui.panelBottom(innerW));

        // GRUB-style hints below the box so they don't compete with chrome.
        const help = this.rows.length > 0
            ? "↑↓ navigate   Tab focus   ←/→ option   Enter select   PgUp/PgDn jump   Home/End edges   Esc exit"
            : "Tab focus   Enter select   Esc exit";

        return ui.takeover({
            termWidth: width,
            termHeight: termH,
            panelWidth: panelW,
            panel,
            footer: [[ui.span(help, { fg: palette.muted })]],
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Command surface — /ssh-connection-manager + /ssh-cm
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Edit flow for the manager's [ Edit ] option. Opens the shared edit
 * screen (connection-form.ts's editConnectionSettings) pre-filled with
 * the selected connection, then saves the result:
 *   - a saved password is preserved (the edit screen never collects one);
 *   - renaming through the name field removes the old record, with a
 *     replace confirm when the new name collides;
 *   - cancelling returns to the manager with the record untouched.
 */
async function runEditConnectionFlow(ctx: ExtensionCommandContext, name: string): Promise<void> {
    const existing = findSshConnection(name);
    if (!existing) {
        ctx.ui.notify("That saved connection no longer exists.", "warning");
        return;
    }
    const updated = await editConnectionSettings(ctx, existing);
    if (!updated) return; // Cancelled — back to the connection list.
    // The edit screen has no password field by design; never silently drop
    // a saved password because the user edited other settings.
    if (existing.password && !updated.password) updated.password = existing.password;
    if (updated.name !== existing.name) {
        if (findSshConnection(updated.name)) {
            const replace = await confirmOverlay(ctx, {
                title: "Replace saved SSH connection?",
                body: "A saved connection already uses this name. Replace its local settings?",
            });
            if (!replace) return; // Back to the list; original record untouched.
        }
        removeSshConnection(existing.name);
    }
    saveSshConnection(updated);
    ctx.ui.notify(`SSH connection updated: ${updated.name}`, "info");
}

/**
 * Delete flow for the manager's [ Delete ] option. Confirms first (safe
 * option highlighted by default), then removes the saved record. "No"
 * returns to the connection list unchanged. A live session started from
 * the deleted record is left running — the manager edits saved records,
 * not active sessions.
 */
async function runDeleteConnectionFlow(ctx: ExtensionCommandContext, name: string): Promise<void> {
    if (!findSshConnection(name)) {
        ctx.ui.notify("That saved connection no longer exists.", "warning");
        return;
    }
    const sure = await confirmOverlay(ctx, {
        title: "Are you sure?",
        body: "Are you sure you wish to delete that connection?",
        yesLabel: "Yes",
        noLabel: "No",
    });
    if (!sure) return; // Back to the connection list.
    removeSshConnection(name);
    ctx.ui.notify(`SSH connection deleted: ${name}`, "info");
}

/**
 * Open the full-screen connection manager. Resolves when the user exits
 * (Escape / Ctrl+C); pi's normal interface is then restored. TUI-only —
 * headless callers are told to use the individual /ssh-* commands.
 *
 * The screen itself only reports WHAT the user asked for; this function
 * owns the follow-up action and then re-opens a freshly-built manager
 * (overlay components are disposed on close — never reused):
 *
 *   - "add"    → the manager's own new-connection dialog
 *     (NewConnectionDialog.ts) → empty-password confirm → save.
 *   - "edit"   → the shared edit screen → preserve password / handle
 *     rename → save.
 *   - "delete" → Are-you-sure confirm → remove the saved record.
 */
export async function openConnectionManager(ctx: ExtensionCommandContext): Promise<void> {
    if (!ctx.hasUI || ctx.mode !== "tui") {
        ctx.ui.notify("The SSH connection manager requires Pi's TUI mode.", "warning");
        return;
    }
    for (;;) {
        // Full-screen takeover overlay (same lifecycle as the /cd picker):
        // the manager paints the whole terminal until `done()` is called
        // inside the screen (Escape / Ctrl+C), then the pi prompt is
        // restored. Plain `ctx.ui.custom()` without `overlay: true` only
        // replaces the input editor — that is NOT what we want here.
        const result = await ctx.ui.custom<ConnectionManagerResult>(
            (_tui, _theme, _keybindings, done) =>
                new ConnectionManagerScreen((r) => done(r)),
            { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" } },
        );
        if (!result || result.kind === "cancelled") return;

        // Either way we loop back into a freshly-built manager so the list
        // reflects any added / edited / deleted entry.
        if (result.kind === "add") await runNewConnectionFlow(ctx);
        else if (result.kind === "edit") await runEditConnectionFlow(ctx, result.name);
        else if (result.kind === "delete") await runDeleteConnectionFlow(ctx, result.name);
    }
}

/**
 * Register `/ssh-connection-manager` and its short alias `/ssh-cm`.
 * Both open the same manager; the two-registration alias pattern
 * matches stfu.ts. Wired into pi by the SSH module (ssh/index.ts).
 */
export function createConnectionManager(pi: ExtensionAPI): void {
    const handler = async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
        await openConnectionManager(ctx);
    };
    pi.registerCommand("ssh-connection-manager", {
        description: "Open the full-screen SSH connection manager. Alias for /ssh-cm.",
        handler,
    });
    pi.registerCommand("ssh-cm", {
        description: "Open the full-screen SSH connection manager. Short alias for /ssh-connection-manager.",
        handler,
    });
}

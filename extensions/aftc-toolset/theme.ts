/**
 * pi-aftc-toolset — theme-selector shortcut feature module.
 *
 * Registers the `/theme` slash command which opens an AFTC UI menu
 * (ui/aftcUi.ts `showMenu`) with extended keyboard navigation AND live
 * theme preview:
 *
 *   - ↑ / ↓              move selection by 1 (applies as preview)
 *   - PageUp / PageDown  move by one viewport (applies as preview)
 *   - Ctrl+PageUp / Ctrl+PageDown (or Home/End) — jump to first / last
 *   - Enter              commit the previewed theme
 *   - Esc                revert to the theme that was active when the
 *                        picker opened, then close
 *
 * The picker is a full-screen AFTC UI takeover (`showMenu`). Every
 * navigation still applies the highlighted theme as a live preview via
 * `ctx.ui.setTheme` (visible once the picker closes); Enter commits,
 * Esc reverts to the theme that was active when the picker opened.
 *
 * Self-contained feature module (.dev/dev_guide.md section 1.5):
 *   - No closure state outside the picker invocation.
 *   - No event subscriptions.
 *   - Imports only the AFTC UI leaf utility.
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
import { showMenu } from "./ui/aftcUi";

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

            const items = themes.map((t: { name: string }) => ({
                value: t.name,
                label: t.name,
            }));

            // ---- 3. Find current theme so we can pre-select it ----
            const currentName = readCurrentThemeName(ctx.ui);
            const currentIndex = currentName
                ? items.findIndex((i) => i.value === currentName)
                : -1;
            // Capture the theme that was active when the picker opened so
            // we can revert on cancel. Skip the "<in-memory>" sentinel —
            // that means the theme was loaded via setThemeInstance(), so
            // there is no real name to revert to.
            const originalName =
                currentName && currentName !== "<in-memory>"
                    ? currentName
                    : undefined;

            // True once at least one preview successfully changed the
            // theme. Tracked per-invocation so each /theme starts clean.
            let hasChangedTheme = false;

            // Apply theme as a live preview during navigation. On failure
            // we notify but keep the picker open so the user can press
            // Esc to revert or Enter to commit elsewhere.
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

            // ---- 4. Open the picker (full-screen takeover) ----
            const chosen = await showMenu(ctx, {
                title: "Select theme",
                body: [currentName ? `Current: ${currentName}` : "Pick a theme to switch to"],
                items,
                initialIndex: currentIndex >= 0 ? currentIndex : 0,
                help: "↑↓ = preview   PgUp/PgDn = page   Ctrl+PgUp/PgDn = top/bottom   Enter = commit   Esc = revert",
                onHighlight: (item) => previewTheme(item.value),
            });

            // ---- 5. Apply / bail ----
            if (chosen === null) {
                // Cancelled: revert only if we actually changed the theme
                // AND we know what to revert to.
                if (hasChangedTheme && originalName) {
                    ctx.ui.setTheme(originalName);
                }
                return;
            }
            // Commit path: re-set the chosen theme so the result is
            // definitive. Idempotent if the preview already applied it,
            // and retries cleanly if a preview failed mid-navigation.
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

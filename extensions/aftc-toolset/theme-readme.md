# theme.ts

Theme-selector shortcut. Registers the `/theme` slash command which
opens a theme picker with live preview and switches the active theme.

## What it does

`/theme` opens a full-screen AFTC UI takeover (`showMenu`), pre-selected
on the currently active theme. Every navigation applies the highlighted
theme as a live preview via `ctx.ui.setTheme` (applied to pi's UI and
seen when the picker closes); Enter commits, Esc reverts to the theme
that was active when the picker opened.

## Keys

- **Arrow Up / Down** — move selection by 1 (wraps; previews each move).
- **PageUp / PageDown** — move by the visible viewport (previews).
- **Ctrl+PageUp / Ctrl+PageDown** (or Home/End) — jump to first / last.
- **Enter** — commit the previewed theme.
- **Esc** — revert to the opening theme (only if a preview actually
  applied and the original theme name is known), then close.

## Events subscribed

None. Pure command handler.

## Commands registered (1)

- `/theme` — open a theme picker and switch to the selected theme.

## Public factory

```typescript
export function createTheme(pi: ExtensionAPI): void
```

Self-contained; imports only the AFTC UI leaf utility. The orchestrator
(`index.ts`) calls this once at startup.

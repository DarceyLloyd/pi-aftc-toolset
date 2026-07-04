# theme.ts

Theme-selector shortcut. Registers the `/theme` slash command which
opens a custom theme picker and switches the active theme.

## What it does

`/theme` opens a modal picker built on pi-tui's `SelectList`,
pre-selected on the currently active theme. The user navigates with
the keyboard and presses Enter to switch, or Esc to cancel.

The picker handles 100+ themes without losing its place because it
uses `SelectList`'s built-in scrolling and supports page-level
navigation:

- **Arrow Up / Down** - move selection by 1 (with wrap).
- **PageUp / PageDown** - move selection by one viewport (the
  visible row count, default 15).
- **Ctrl+PageUp** - jump to the first theme.
- **Ctrl+PageDown** - jump to the last theme.
- **Enter** - switch to the highlighted theme.
- **Esc** (or Ctrl+C) - cancel without switching.

## Events subscribed

None. Pure command handler.

## Commands registered (1)

- `/theme` - open a theme picker and switch to the selected theme.

## Public factory

```typescript
export function createTheme(pi: ExtensionAPI): void
```

Self-contained, no cross-module state. The orchestrator
(`index.ts`) calls this once at startup.

## Closure state

None. The picker's per-instance state (selected index, viewport)
lives on the `ThemePicker` instance and is garbage-collected when
the modal closes.

## Architecture

`ThemePicker` wraps a `SelectList`. It intercepts the four page-nav
keys before passing through to the underlying list (which only knows
up / down / enter / escape). The wrapper tracks its own
`selectedIndex` so it can step without touching the SelectList's
private state.

`ThemePickerOverlay` is a `Container` with:

- Title (Text)
- Current-theme hint (Text) - shown when the current theme has a
  resolvable name; otherwise shows a generic "Pick a theme" prompt.
- Picker (ThemePicker)
- Key-binding hint footer (Text)

## Failure modes

- **No UI** (headless / RPC mode) - falls back to printing the
  discovered theme names to stdout so the caller still gets useful
  information.
- **Zero themes discovered** - "No themes discovered" warning
  notification.
- **User cancels the picker** (Esc / Ctrl+C) - returns silently,
  no theme change, no notification.
- **`ctx.ui.setTheme` returns `{ success: false, error }`** -
  surfaces the error via `ctx.ui.notify` with severity `error`.
- **`ctx.ui.getAllThemes` not present** (older pi) - falls back to
  empty list and shows the "No themes discovered" notification.
- **`ctx.ui.setTheme` not present** (older pi) - returns
  undefined from `result`, surfaces as "unknown error".
- **`ctx.ui.theme.name` is "<in-memory>" or undefined** - the
  picker starts at index 0 instead of pre-selecting; the "Current:
  ..." hint is hidden.

## Current-theme detection

The picker reads `ctx.ui.theme.name` to find the currently active
theme and pre-selects it. The Theme instance's name field is the
same string pi passes to `ctx.ui.setTheme(name)`. If the theme was
set via `setThemeInstance()` (in-memory), pi sets the sentinel name
"<in-memory>" and we skip pre-selection rather than showing a
nonsense hint.

## Cross-platform

No filesystem or process access. Pure UI call. Behaves identically
on Windows, Linux, and macOS. Keyboard bindings use pi-tui's
`matchesKey` which handles the platform-specific escape sequences
for PageUp / PageDown / Ctrl+PageUp / Ctrl+PageDown.
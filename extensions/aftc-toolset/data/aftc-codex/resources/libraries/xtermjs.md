# Xtermjs

## Rules

## Gotchyas

- [sLU0QK] @xterm/addon-fit UMD registers window.FitAddon.FitAddon (a namespace object holding the class, not the class itself) - resolve the constructor as `(window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon` when loading via plain script tags (no bundler).

- [YkFy7M] fitAddon.fit() throws when the terminal container is hidden or zero-size (eg a display:none tab) - only fit after the container is visible (requestAnimationFrame after showing) and on resize, and wrap it in try/catch for mid-layout calls.

## Issues & Solutions

- [y8cUvX] Viewport scrollbar covers the rightmost terminal text after fitAddon.fit()
  Cause: a global `* { box-sizing: border-box }` makes the fit addon read the terminal container's computed width INCLUDING its padding, so cols are fitted up to one column too wide and the text runs under the `.xterm-viewport` scrollbar.
  Fix: Set the terminal container to `box-sizing: content-box` (or drop its padding) so the fit addon measures the true content width, then re-fit. (2026-08)

- [IJCza5] Terminal scroll bounces to the top on fitAddon.fit() / resize
  Cause: xterm.js reflows the buffer on resize and resets the viewport scroll position to the top when the scrollback is large.
  Fix: Before fit() capture `term.buffer.active.viewportY >= term.buffer.active.baseY` (user is at the bottom), call `term.scrollToBottom()` after fit when true; users scrolled up to read keep their position. (2026-08)

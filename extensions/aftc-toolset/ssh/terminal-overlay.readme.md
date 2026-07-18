# terminal-overlay.ts

Full-screen interactive SSH terminal opened by `/ssh-shell`.

## Behavior

- Opens with `ctx.ui.custom(..., { overlay: true })` at 100% width/height as
  a GRUB-style AFTC takeover (same frame as `/ssh-cm`): solid black
  background, centred `#555555`-bordered panel, accent title, hints below
  the box — pi's own text never bleeds through behind the terminal.
- The remote terminal renders through a virtual screen
  (`ui/terminal-screen.ts`): the raw PTY stream is interpreted (cursor
  movement, erase, scroll regions, alternate screen, SGR colours), so
  cursor-addressed programs (nano, vim, htop, top, less) render as they
  would in a real terminal instead of piling up as stripped scrollback.
- Polls the bounded remote buffer on a timer without blocking Pi rendering;
  the screen only rebuilds when the snapshot changed.
- Forwards text, navigation keys, function keys, common editing keys, and
  Ctrl combinations to the selected shell. Multi-character pasted input
  goes as bracketed paste. Escape is forwarded to the remote program.
- Ctrl+] is the local-only escape chord that closes the screen without
  sending anything remotely.
- Resizes the remote PTY to the panel's inner viewport (cols x rows).
- Stops its timer when the shell closes, fails, or the screen is dismissed.

## Notes

- The screen emits AftcSpan rows (no raw ANSI reaches pi's renderer);
  remote colours are resolved to `#rrggbb` hex and adapted for the dark
  background (`renderSpans` colour policy `"dark"`): light backgrounds
  are crushed to a dark shade of the same hue with near-white text, and
  low-contrast foregrounds (e.g. dark blue `ls` directories) are
  brightened. See `ui/terminal-screen.readme.md`.
- Wide (CJK/emoji) characters occupy one cell — documented limitation of
  the emulator; alignment in those scripts may drift.
- The overlay deliberately has no visual automated test. The emulator is
  unit-tested (`tests/ssh-terminal-screen-check`); verify editor workflows
  manually in a supported terminal.

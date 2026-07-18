# terminal-screen.ts

Minimal VT100/xterm virtual screen used by the SSH full-screen terminal
(`ssh/terminal-overlay.ts`). Interprets a raw PTY byte stream into a
fixed-size cell grid and renders it as AftcSpan rows, so cursor-addressed
terminal programs (nano, vim, htop, top, less) display correctly inside
the AFTC full-screen takeover.

## Model

- `TerminalScreen(cols, rows)` holds a cell grid; each cell carries a
  character plus `#rrggbb` (or default) fg/bg, bold, and reverse flags.
- `write(data)` feeds raw PTY text. Escape sequences may be split across
  writes; the parser stashes incomplete tails.
- `renderSpans({ text, background }, drawCursor, colorPolicy)` returns one
  AftcSpan array per row, always exactly `cols` wide (trailing blanks
  included, so panel padding never fights the screen background).
  Consecutive cells sharing attributes are grouped into single spans.
  Unset fg/bg resolve to the given palette defaults; the cursor cell is
  inverted when `drawCursor` is on and the remote cursor is visible.
  `colorPolicy` is `"raw"` (faithful xterm hex mapping, the default —
  used by the parser tests) or `"dark"` (adapted for readability on the
  overlay's dark background; used by the SSH terminal overlay).

## Dark colour adaptation (`colorPolicy: "dark"`)

The overlay sits on a solid black background, where stock xterm colours
like dark blue (`#0000ee`) are unreadable. `"dark"` runs every cell
through the exported pure function `adaptForDarkBackground(fg, bg)`:

- A light or bright background (luma > 100 — white status bars, yellow
  highlights, bright-green `ls` world-writable markers, reverse-video
  selection) is darkened in HSL steps — hue and saturation preserved —
  until its luma drops to <= 55 (green becomes ~`#005c00`, white
  ~`#333333`), and its text is forced near-white (`#f2f2f2`), so the
  bar stays visible and the text readable.
- A foreground too close in brightness to its background (luma gap
  < 90) is lightened in HSL steps — hue and saturation preserved —
  until it clears the floor. Dark blue becomes a readable `#4d4dff`-ish
  blue; black-on-black becomes gray.
- Everything else passes through untouched; results are memoised.
- The cursor cell always keeps its raw inversion, so it can never blend
  into the surrounding text.

## Supported sequences

- SGR: reset, bold, reverse, 16-colour / 256-colour / truecolour fg+bg
  (all resolved to hex; underline and dim are dropped — AftcSpan has no
  such channel).
- Cursor: CUP, CUU/CUD/CUF/CUB, CNL/CPL, CHA, VPA, save/restore
  (`\x1b7` / `\x1b8`, CSI s/u), visibility (`?25`).
- Editing: ED, EL, IL, DL, ICH, DCH, ECH.
- Scrolling: full-screen and DECSTBM regions, IND/NEL/RI, SU/SD.
- Alternate screen (`?1049` / `?47` / `?1047`) with main-screen save and
  restore — the vim/htop flow.
- DEC special-graphics charset (`\x1b(0`) mapped to Unicode line drawing.
- OSC sequences are skipped; `RIS` soft-resets the screen.

## Known limits

- Every code point occupies one cell: wide (CJK/emoji) text can drift out
  of alignment.
- No scrollback: the grid is exactly what a real terminal shows.

Leaf utility: type-only import from `aftcUi.ts`; no feature-module imports.
Unit-tested by `tests/ssh-terminal-screen-check` (emulation plus the
dark-adaptation rules).

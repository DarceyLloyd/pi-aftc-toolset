# intro-text.ts

AFTC text intro - the wordmark animation. A one-line typewriter widget
that types "AFTC", then expands to "All For The Code - \<random quip\>".
After the linger the widget clears (`clearAtEnd`, default `true`); the
feedback prompt ("PI-AFTC-Toolset > Like the extension? Got some
feedback?") with the feedback-page URL
(`https://dev.aftc.uk/pi-aftc-toolset/feedback`) underneath is printed
into the CONSOLE transcript as a display-only entry (type
`aftc-intro-feedback`, renderer registered by `initTextIntro(pi)` from
index.ts): white prompt line + accent URL wrapped in an OSC 8 hyperlink
(clickable in terminals that support links), scrolling away with normal
use instead of staying pinned. Runs as a widget + display entries (not
messages), so nothing enters model context or session history.

**Feedback prompt DISABLED by default (2026-08):** the emit is gated by
the `feedbackEnabled` flag in intro-text.ts (currently `false`); flip it
back to `true` to re-enable the feedback lines. The renderer stays
registered either way.

## Commands and preference

| Command | Action |
| --- | --- |
| `/aftc-intro-on` | Enable (plays immediately) |
| `/aftc-intro-off` | Disable |

- **Preference key:** `"aftc-intro"` (boolean, default `true`)
- **Widget key:** `"aftc-intro"` (one line: accent `All For The Code - `
  prefix + white message once the prefix is fully typed)

## Behaviour

- On `play(ctx)`: waits `START_DELAY_MS` (925ms) after session start,
  picks a random end-string quip, rebuilds the frame list, then types
  frame by frame via `ctx.ui.setWidget`. The final quip frame lingers
  `END_DELAY_MS` (1900ms); the animation then emits ONE
  `INTRO_FEEDBACK_ENTRY` console entry (`emitFeedback()`, fail-soft when
  `initTextIntro(pi)` was never called) - but ONLY when `feedbackEnabled`
  is true (disabled by default 2026-08) - and clears the widget when
  `clearAtEnd` is `true` (default) or leaves it up when `false`. The
  entry renderer draws two lines: `FEEDBACK_PROMPT` in the theme's
  default (white) foreground (fail-soft plain text if the theme lacks
  the key) and `FEEDBACK_URL` in the accent colour wrapped in an OSC 8
  hyperlink escape (`hyperlink()`; pi-tui skips OSC 8 in width
  measurement, terminals that support it render a clickable link).
  Entries are display-only — never model context (see codex [AbgNKI]).
- Quips are a weighted list (duplicates = higher probability); several
  include the package version read from `package.json` at module load
  (`unknown` on failure).
- `play(ctx, 0)` starts instantly (used by the `-on` command path).
- `stop(ctx?)` clears both timers and the widget.

## Non-TUI behaviour

Guards `ctx.hasUI` internally — silent no-op in headless/print mode.

## Contract

Returns an `IntroDescriptor` (`id: "aftc-intro"`,
`commandPrefix: "aftc-intro"`). See `intro-factory-readme.md` and
`intros/readme.md` for the subsystem contract. Currently wired directly
by `index.ts` (the factory is disconnected).

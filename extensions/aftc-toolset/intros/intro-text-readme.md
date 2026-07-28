# intro-text.ts

AFTC text intro — the wordmark animation. A one-line typewriter widget
that types "AFTC", then expands to "All For The Code — \<random quip\>".
Runs as a widget (not a message), so it never enters model context or
session history.

## Commands and preference

| Command | Action |
| --- | --- |
| `/aftc-intro-on` | Enable (plays immediately) |
| `/aftc-intro-off` | Disable |

- **Preference key:** `"aftc-intro"` (boolean, default `true`)
- **Widget key:** `"aftc-intro"` (one accent-coloured line)

## Behaviour

- On `play(ctx)`: waits `START_DELAY_MS` (925ms) after session start,
  picks a random end-string quip, rebuilds the frame list, then types
  frame by frame via `ctx.ui.setWidget`. The final frame lingers
  `END_DELAY_MS` (1500ms) before the widget clears itself.
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

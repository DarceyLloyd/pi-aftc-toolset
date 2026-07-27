# intros/

> **STATUS 2026-07: the factory is DISCONNECTED.** `index.ts` no longer calls
> `createIntros(pi)` — it wires `intro-text.ts` directly (session_start plays
> it when enabled, shutdown stops it, `/aftc-intro-on`/`/aftc-intro-off`).
> The factory + `intro-wargames.ts` (raw ANSI takeover) remain on disk,
> dormant. To restore the random draw, re-import `createIntros` in `index.ts`.

Startup intro animation subsystem. The factory (`intro-factory.ts`) picks one
random **enabled** intro on `session_start` and plays it. Each intro
module exports an `IntroDescriptor` with play/stop/isEnabled/setEnabled/
registerCommands. The factory owns the session lifecycle; each intro
owns its own on/off slash commands.

## Architecture

```
intros/
├── intro-factory.ts    — factory: random pick on session_start, stop all on shutdown
├── intro-text.ts       — AFTC wordmark typewriter widget (one line)
├── intro-wargames.ts   — WarGames full-screen green typewriter overlay + MP3
└── readme.md           — this file
```

## Adding a new intro

1. Create `intros/intro-<name>.ts` exporting `create<Name>Intro(): IntroDescriptor`
2. Import it in `intro-factory.ts` and add to the `intros` array
3. Add its preference key to `config.ts` (interface + defaults + migration)
4. Set `commandPrefix` in the descriptor — the factory auto-generates
   `/<prefix>-on` and `/<prefix>-off` slash commands (no need to register them
   yourself). Use an empty string for NO commands (config-only enable).
5. Update `help.ts` with the new commands (skip for commandless intros)

## IntroDescriptor contract

```ts
interface IntroDescriptor {
    id: string;           // preference key (eg "aftc-intro", "warGamesEnabled")
    label: string;        // human-readable (eg "AFTC text intro")
    commandPrefix: string; // slash command prefix (eg "aftc-intro" → /aftc-intro-on, /aftc-intro-off);
                           // empty string = NO commands (config-only enable)
    play(ctx): void;      // start the animation (guard hasUI/mode internally);
                           // the factory's session_start play() call IS the trigger
    stop(ctx?): void;     // clean up timers/widgets/overlays
    isEnabled(): boolean; // read from config
    setEnabled(v): void;  // write to config
}
```

## Existing intros

### intro-text (AFTC wordmark)

- **Preference:** `"aftc-intro"` (boolean, default `true`)
- **Commands:** `/aftc-intro-on`, `/aftc-intro-off`
- **Behaviour:** one-line widget typewriter — types "AFTC" then expands
  to "All For The Code - <random quip>". Never enters model context.
- **Moved from:** `intro.ts` (root level) into `intros/intro-text.ts`

### intro-wargames (WarGames)

- **Preference:** `"warGamesEnabled"` (boolean, default `false`)
- **Commands:** none (config-only enable — exists purely for the random draw)
- **Behaviour:** full-screen RAW ANSI takeover (no pi UI APIs): black screen,
  green typewriter text "GREETINGS PROFESSOR FALKEN" with blinking block
  cursor. The MP3 starts at the START of typing; the takeover ends 0.5s after
  the MP3 ends (once typing has finished). Any key dismisses early. Uses the
  terminal alternate screen buffer (the vim/htop mechanism) — non-destructive
  to pi; on exit a synthetic resize forces pi to fully repaint.
- **MP3:** user-supplied at `data/aftc-intro/audio/voc_greetings-professor-falcon.mp3`.
  Animation works without it (just no sound).
- **Moved from:** `wargames.ts` (root level) into `intros/intro-wargames.ts`

## Session lifecycle

- `session_start` → factory filters enabled intros, picks one at random,
  calls `play(ctx)` — the play() call IS the trigger signal. If none enabled,
  nothing happens. If multiple are enabled (eg both text and WarGames), each
  has an equal chance (50/50 with two, 33% with three, etc.).
- **WarGames is a raw ANSI takeover, not a pi overlay.** pi has no "TUI ready"
  event and `ctx.ui.custom()` overlays fired from `session_start` are
  flaky/dropped (timers are NOT a reliable workaround). The takeover avoids
  pi UI entirely: it writes straight to the terminal using the ALTERNATE
  SCREEN BUFFER (`\x1b[?1049h`/`\x1b[?1049l`), so pi's main screen is preserved
  and restored exactly on exit. A 250ms heartbeat full repaint covers any
  stray pi output mid-takeover; any key dismisses; crash-guards (max sound
  time) mean pi can never be trapped. Widget intros (intro-text) still play
  via `setWidget`, which queues for the next render cycle.
- `session_shutdown` → factory calls `stop(ctx)` on ALL intros to clean
  up any running animation.
- **On enable:** each intro's `/...-on` command (when it has one) plays it
  immediately.

## Audio assets

Intros that play sound should store their MP3s in `data/aftc-intro/audio/`.
The path is resolved relative to the intro module's `__dirname` (one
level up from `intros/` to `aftc-toolset/`, then into `data/aftc-intro/audio/`).
If the MP3 is missing the animation still works — just no sound.

## Non-TUI behaviour

Both intros guard `ctx.hasUI` and `ctx.mode === "tui"` internally.
In headless/print mode they are silent no-ops.

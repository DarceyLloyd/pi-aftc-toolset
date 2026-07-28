# intro-wargames.ts

WarGames intro — a full-screen green-on-black typewriter takeover that
types "GREETINGS PROFESSOR FALKEN" with a blinking block cursor while
the bundled MP3 plays.

## Preference

- **Preference key:** `"warGamesEnabled"` (boolean, default `false`)
- **Commands:** none (`commandPrefix: ""`) — config-only enable; exists
  purely for the `session_start` random draw.

## Why raw ANSI (not a pi overlay)

pi has no "TUI ready" event and `ctx.ui.custom()` overlays fired from
`session_start` are flaky/dropped (timers are NOT a reliable
workaround). So this intro bypasses pi UI entirely:

- The terminal **alternate screen buffer** (`\x1b[?1049h` / `\x1b[?1049l`,
  the vim/htop mechanism) preserves pi's main screen and restores it
  exactly on exit — non-destructive.
- A 250ms heartbeat full repaint overwrites any stray pi output that
  lands mid-takeover within one frame.
- Frames paint every row with absolute cursor positioning, one column
  short of full width, so the bottom-right cell is never touched
  (no scroll).
- Any key press dismisses early (the keypress also reaches pi — harmless).
- On exit a synthetic `resize` is emitted on stdout so pi does a full
  relayout + repaint (its differential renderer went stale while it
  painted into the discarded alt screen).

## Timeline

1. MP3 starts at the START of typing (first phase).
2. Typing at 40ms/char, cursor blinks at 530ms.
3. Takeover ends 0.5s (`SOUND_END_PAUSE_MS`) after the MP3 ends, once
   typing has finished.
4. **Crash-guard:** `SOUND_MAX_MS` (15s) hard cap — pi can never be
   trapped. Silent fallback: 1.5s hold after typing when no player.

## Audio

MP3: `data/aftc-intro/audio/voc_greetings-professor-falcon.mp3`
(user-supplied). Played via the platform `play_sound-*` binary in
`../bin/` — spawn logic duplicated from `notify.ts` because feature
modules must not import each other. Spawned NON-detached so the `close`
event marks the exact MP3 end. Missing MP3 or binary = animation still
works, just silent.

## Guards

`play()` requires `ctx.hasUI`, `ctx.mode === "tui"`, and a TTY stdout —
silent no-op otherwise. Currently dormant: the intro factory is
disconnected (see `intro-factory-readme.md`).

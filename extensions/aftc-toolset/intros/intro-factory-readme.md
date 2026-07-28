# intro-factory.ts

Intros subsystem coordinator. Picks ONE random **enabled** intro on
`session_start` and plays it; stops all intros on `session_shutdown`.
Each intro module exports an `IntroDescriptor` and the factory owns the
session lifecycle plus the auto-generated on/off slash commands.

> **STATUS:** the factory is currently DISCONNECTED — `index.ts` wires
> `intro-text.ts` directly instead of calling `createIntros(pi)`. The
> factory and `intro-wargames.ts` remain on disk, dormant. See
> `intros/readme.md` for the restore steps.

## IntroDescriptor contract

Every intro module returns one of these (see `intro-text.ts` /
`intro-wargames.ts`):

```ts
interface IntroDescriptor {
    id: string;            // preference key (eg "aftc-intro", "warGamesEnabled")
    label: string;         // human-readable label for logs / help
    commandPrefix: string; // "aftc-intro" → /aftc-intro-on, /aftc-intro-off;
                           // empty string = NO commands (config-only enable)
    play(ctx): void;       // start the animation (guard hasUI/mode internally)
    stop(ctx?): void;      // clean up timers/widgets/overlays
    isEnabled(): boolean;  // read from config
    setEnabled(v): void;   // persist to config
}
```

## What the factory does

- Builds the `INTROS` array (`createTextIntro()`, `createWarGamesIntro()`).
- Auto-generates `/<commandPrefix>-on` and `/<commandPrefix>-off` slash
  commands per intro (skipped when the prefix is empty). `-on` also plays
  the intro immediately; both go through `aftcConsole.emphasis`.
- `session_start` → filter enabled intros, pick one at random, `play(ctx)`.
  The play() call IS the trigger signal.
- `session_shutdown` → `stop(ctx)` on ALL intros.

## Debug log

`dlog()` appends timestamped lines to `<data-dir>/intros-debug.log` so
output survives the console flood right after `session_start`.
Best-effort only — write failures are swallowed.

## Adding a new intro

See `intros/readme.md` for the full subsystem contract and the
step-by-step recipe.

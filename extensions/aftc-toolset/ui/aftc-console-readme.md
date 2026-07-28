# aftc-console.ts

Centralised transcript + diagnostic output facade for every aftc-toolset feature.

## Why

`ctx.ui.notify(msg, type)` only renders three ways, none of which is the theme's
accent/emphasis colour:

| type       | rendered as          |
| ---------- | -------------------- |
| `"info"`   | dim (faint grey)     |
| `"warning"`| yellow + "Warning: " |
| `"error"`  | red + "Error: "      |

So ordinary status/success output was either a faint `info` aside or — worse — a
yellow `warning`. This module owns the one accent-coloured entry renderer
(`pi.registerEntryRenderer` + `pi.appendEntry`, the same mechanism `/cwd` and
`/dir` use) and exposes a uniform severity API. Output styling is defined in
exactly one place; change it here and it applies everywhere.

Full contract and severity guidance: `docs/aftc-console-documentation.md`.

## API

```ts
import * as aftcConsole from "../ui/aftc-console";

aftcConsole.init(pi);                  // register the emphasis renderer; once per session (index.ts)
aftcConsole.emphasis(ctx, text);       // accent/emphasis line — status, success, state change (NOT a warning)
aftcConsole.warn(ctx, text);           // yellow — action could not proceed (nothing selected, missing args…)
aftcConsole.error(ctx, text);          // red — hard failure
aftcConsole.info(ctx, text);           // dim — rare neutral aside
aftcConsole.log(text);                 // "[aftc-toolset] …" stdout diagnostic (NOT the transcript)
```

## Transport

- `emphasis` -> `pi.appendEntry` (cached `pi`, registered via `init`). Falls back
  to a dim `info` line when the host has no entry-renderer API (tests/edge).
- `warn` / `error` / `info` -> `ctx.ui.notify` (the three native severities).
- `log` -> `console.log` with the `[aftc-toolset]` prefix (de-duplicated).

## Wiring

`init(pi)` is called once from the orchestrator (`index.ts`) at session start.
Feature modules then call the line methods with their `ctx`. Never use raw
`ctx.ui.notify` or `console.log("[aftc-toolset]…")` directly in a feature — go
through aftc-console.

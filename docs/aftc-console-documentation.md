# aftc-console — centralised transcript + diagnostic output

`extensions/aftc-toolset/ui/aftc-console.ts` is the single facade every
aftc-toolset feature uses to write to the user's console. Read this before
relying on it.

---

## Why it exists

pi's `ctx.ui.notify(message, type)` only supports three severities, **none of
which is the theme's accent/emphasis colour**:

| `type`     | rendered as            |
| ---------- | ---------------------- |
| `"info"`   | dim (faint grey)       |
| `"warning"`| yellow + "Warning: "   |
| `"error"`  | red + "Error: "        |

That left no good option for ordinary status/success output — it was either a
faint `info` aside or a misleading yellow `warning`. Any feature wanting an
emphasised line previously had to build its own `pi.registerEntryRenderer` +
`pi.appendEntry` renderer. `aftc-console` owns that renderer once and exposes a
uniform severity API, so output styling lives in exactly one place.

---

## API

```ts
import * as aftcConsole from "../ui/aftc-console";

aftcConsole.init(pi);                // once per session (index.ts)
aftcConsole.emphasis(ctx, text);     // accent/emphasis line
aftcConsole.warn(ctx, text);         // yellow
aftcConsole.error(ctx, text);        // red
aftcConsole.info(ctx, text);         // dim
aftcConsole.log(text);               // "[aftc-toolset] …" stdout diagnostic
```

| Method | Colour | Transport | Use it for |
| --- | --- | --- | --- |
| `init(pi)` | — | `pi.registerEntryRenderer` | Setup. Call **once** at session start from `index.ts`. |
| `emphasis(ctx, text)` | **accent / emphasis** (orange in aftc-orange-viz) | `pi.appendEntry` (cached `pi`); falls back to a dim `info` line if unavailable | Status, success, state changes — **anything that is not a warning or an error**. This is the capability `ctx.ui.notify` cannot provide. |
| `warn(ctx, text)` | yellow | `ctx.ui.notify("warning")` | A requested action could not proceed: nothing selected, not connected, missing arguments, "not a file". |
| `error(ctx, text)` | red | `ctx.ui.notify("error")` | Hard failures ("…failed", "could not be opened"). |
| `info(ctx, text)` | dim / grey | `ctx.ui.notify("info")` | The rare neutral aside. Most ordinary output should use `emphasis` instead. |
| `log(text)` | stdout (not transcript) | `console.log` with `[aftc-toolset]` prefix | Load / diagnostic messages to the process console. The prefix is de-duplicated. |

---

## Severity guidance (read before choosing a method)

1. Is it a hard failure (an operation threw / could not run)? → `error`
2. Did the user's requested action stall because a precondition was not met
   (nothing selected, not connected, missing args, path is not a file)? → `warn`
3. Is it a rare, low-key neutral aside you explicitly want faint? → `info`
4. **Otherwise** (status, success, a completed action, a state change, guidance)
   → `emphasis`

The default for ordinary feature output is `emphasis`, **not** `info`. If you
are unsure, use `emphasis`.

---

## Transport notes

- `emphasis` needs `pi` (only `pi.appendEntry` exists; `ctx` has no equivalent).
  `init(pi)` caches the `pi` reference and registers the accent entry renderer.
  The cache is refreshed on every `init` call, so it survives `/reload`.
  Registration is **fail-soft**: a host/mock without `registerEntryRenderer`
  skips it and `emphasis` degrades to a dim `info` line (the text still shows).
- `warn` / `error` / `info` are thin wrappers over `ctx.ui.notify`. They exist
  for a single uniform output surface and so future changes (icons, telemetry,
  a new severity) land in one place.
- `log` writes to **stdout**, not the transcript. It standardises the
  `[aftc-toolset]` prefix so load/diagnostic messages stay consistent and
  greppable.

---

## Rules for feature modules

- **Never** call `ctx.ui.notify` directly — use `aftcConsole.warn` / `error` /
  `info` / `emphasis`.
- **Never** write `console.log("[aftc-toolset] …")` directly — use
  `aftcConsole.log(text)`.
- Only `index.ts` calls `init(pi)`. Every other file just imports the line
  methods.
- This is a shared UI utility (sibling to `aftc-ui.ts`), not a feature module —
  every feature may import it without violating the "feature modules must not
  import each other" rule.

---

## Entry type

The emphasised line is a custom transcript entry of type
`aftc-console-emphasis` (`AFTC_CONSOLE_EMPHASIS_ENTRY`). It renders inline in
the conversation transcript (a `Text` coloured with the theme's `accent` token,
indented to match `ctx.ui.notify` status lines) and is **display-only** — it
never enters the LLM context (same property as `/cwd` and `/dir` cards).

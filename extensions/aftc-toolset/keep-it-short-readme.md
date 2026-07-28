# keep-it-short.ts

Keep-it-short slash command feature module. One command (with a short
alias) that sends a fixed "be concise" instruction prompt to the active
model as a fresh user message — a quick nudge when the model has drifted
into verbose explanations.

## Commands

| Command | Action |
| --- | --- |
| `/keep-it-short` | Send the fixed "be terse" prompt to the model |
| `/kis` | Short alias — same handler, fewer keystrokes |

## Behaviour

- The prompt text is a constant (`KIS_PROMPT`): terse answers, no
  preamble/recap/filler, code stays code, one-word replies are fine,
  but always reply with *something* ("short" means terse, not silent).
- Delivery depends on agent state:

  | Agent state | Delivery |
  | --- | --- |
  | Idle | `pi.sendUserMessage(prompt)` — new turn immediately |
  | Busy (streaming) | `sendUserMessage(prompt, { deliverAs: "followUp" })` — queued until the current turn finishes |

  `followUp` is deliberate: `"steer"` would interrupt mid-thought. To
  interrupt, use `/aftc-stop` first, then `/kis`.
- Feedback goes through `aftcConsole.emphasis` in the TUI and a
  `[aftc-toolset]` `console.log` line headless.

## Wiring

Self-contained: no closure state, no event subscriptions, no background
resources, no cross-module imports (except `ui/aftc-console`). Wired by
the orchestrator (`index.ts`) via `createKeepItShort(pi)`.

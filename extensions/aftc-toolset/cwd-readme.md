# cwd.ts

Current-working-directory feature module. Registers the `/cwd` slash
command which displays the current working directory as an inline card
in pi's conversation area (above the input prompt), using the same
inline-card style as `/dir` (see `dir-readme.md`).

## Commands

| Command | Action |
| --- | --- |
| `/cwd` | Show the current working directory (inline card) |

## How it works

- Uses `pi.registerEntryRenderer()` + `pi.appendEntry()` with the custom
  entry type `"cwd-display"`, so output is a clean inline card in the
  transcript — not a modal dialog — and never pollutes the LLM context.
- `$HOME`-prefixed paths are shortened to `~/…` for readability.
- The platform label (Windows / macOS / Linux) is appended to the card.

## Wiring

Self-contained feature module: no shared state, no event subscriptions,
no cross-module imports. Wired in by the orchestrator (`index.ts`) via
`createCwd(pi)`.

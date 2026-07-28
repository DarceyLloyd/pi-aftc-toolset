# dir.ts

Directory-listing feature module. Registers the `/dir` slash command
(aliased `/ls`) which displays the current working directory followed by
a platform-native directory listing as an inline card in pi's
conversation area.

## Commands

| Command | Action |
| --- | --- |
| `/dir` | List current directory contents (inline card) |
| `/ls` | Alias for `/dir` — identical handler |

## How it works

- Uses `pi.registerEntryRenderer()` + `pi.appendEntry()` with the custom
  entry type `"dir-listing"`, so output is a clean inline card in the
  transcript — not a modal dialog — and never pollutes the LLM context.
- Listing command is chosen from `process.platform`:

  | Platform | Command |
  | --- | --- |
  | win32 | `dir` |
  | darwin / linux / other | `ls -la` |

- The listing runs synchronously via `execSync` (shell). On failure the
  card shows the error (`📁 <dir> — error` title, `[error] …` body)
  instead of throwing.
- `$HOME`-prefixed paths are shortened to `~/…` for readability.

## Wiring

Self-contained feature module: no shared state, no event subscriptions,
no cross-module imports. Wired in by the orchestrator (`index.ts`) via
`createDir(pi)`.

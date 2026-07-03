# stfu.ts

Emergency-interrupt slash commands. Aborts the current agent operation
- the escape hatch when a reasoning model is stuck in a long internal
monologue or a runaway tool-call loop.

## What it does

Registers two slash commands that both call `ctx.abort()`:

- **`/aftc-stop`** - namespaced, follows the project's `/aftc-*`
  convention. Use this when you want to be explicit.
- **`/stfu`** - short alias for the same action. Use this when the
  model has gone into a 30-minute "wait…" loop and you just want out,
  fast.

Both commands are functionally identical aliases. They appear together
in `/aftc-help` under a new "Interrupt" section so users see both
names at once and learn they are equivalent.

## Why two commands

- **`/aftc-stop`** - discoverable, namespaced, scriptable. The command
  you'll autocomplete or find in `/aftc-help`.
- **`/stfu`** - typable in a hurry. Three characters, no shift key,
  memorable. The command you'll actually hit when the model is stuck.

Same handler, same behaviour. The `cmdName` is included in the
"Stopped via /stfu" notification so the user can see which alias fired
(useful for muscle-memory situations where you forget which one you
typed).

## How it works

Pi's `ExtensionContext` exposes a fire-and-forget `ctx.abort()` helper
(see pi's `docs/extensions.md` §"ctx.isIdle() / ctx.abort() /
ctx.hasPendingMessages()"). Calling it cancels the current agent
operation - provider stream, in-flight tool, queued follow-ups - and
returns the user to the editor. It does not require awaiting.

When the agent is already idle (`ctx.isIdle() === true`), there is
nothing to abort. We emit a friendly "Agent is already idle - nothing
to stop." notification instead of failing silently, so the user knows
the command was received.

## Behaviour matrix

| Agent state | `/aftc-stop` | `/stfu` |
|---|---|---|
| Streaming / tool-call loop | `ctx.abort()` + notification "Stopped via /aftc-stop" | `ctx.abort()` + notification "Stopped via /stfu" |
| Idle | notification "Agent is already idle - nothing to stop." | notification "Agent is already idle - nothing to stop." |
| Headless (RPC / `-p` mode) | stdout log `[aftc-toolset] stfu: aborted via /aftc-stop` | stdout log `[aftc-toolset] stfu: aborted via /stfu` |

`ctx.hasUI` guards the notification; `ctx.mode === "rpc" / "print"`
falls through to the headless `console.log` path.

## Why not a keyboard shortcut

The user explicitly asked for slash commands. The project also already
exposes `Escape` as a built-in pi shortcut for the same operation at
the TUI level - adding another shortcut (e.g. `Ctrl+Shift+Escape`)
would be redundant. KISS: slash commands only.

## Why this module exists separately from `core.ts`

Per rules.md §1.4 - one feature per file. The stop commands are an
independent user-facing capability that has nothing to do with cache
diagnostics. They live in their own file so the orchestrator can wire
them in independently and so the per-file contract is small and
focused.

## Events subscribed

None. The module only registers commands - no `pi.on(...)` handlers,
no shared state, no background resources.

## Public factory

```typescript
export function createStfu(pi: ExtensionAPI): void
```

Returns void - the module is self-contained and stateless. The
orchestrator (`index.ts`) calls this once at startup; the rest of the
lifecycle is per-command-handler invocation.

## Commands registered (2)

- **`/aftc-stop`** - stop the current agent operation (alias for
  `/stfu`).
- **`/stfu`** - short alias for `/aftc-stop`.

Both share the same handler implementation (see the `handleStop`
helper in `stfu.ts`).

## Failure modes

- **Calling `ctx.abort()` while idle** - handled. The handler checks
  `ctx.isIdle()` first and emits an informational notification
  instead. `ctx.abort()` itself is documented as safe to call at any
  time, so even if the check were skipped there would be no crash -
  just a silent no-op.
- **Missing `ctx.isIdle` on older pi versions** - guarded by `ctx.isIdle
  && ctx.isIdle()`. If `isIdle` is not present on the context, we
  fall through to calling `ctx.abort()` (which is the documented
  safe-at-all-times operation). Older pi versions are expected to
  still have `ctx.abort()`.
- **Headless / RPC mode** - `ctx.hasUI` is `false`. Notifications are
  skipped; the action is logged to stdout via `console.log` with the
  `[aftc-toolset]` prefix (rules.md §5.10).
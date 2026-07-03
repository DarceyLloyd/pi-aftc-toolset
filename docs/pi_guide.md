# pi — Working with the pi coding agent

Everything you need to know to extend pi with TypeScript extensions,
custom commands, tools, TUI widgets, themes, skills, and packages. Written
from the perspective of an extension author who has shipped
`pi-aftc-toolset` against pi. Read this once instead of re-reading all
the pi docs.

> If you're picking up `pi-aftc-toolset` itself, also read
> [`project_guide.md`](./project_guide.md) — it covers the conventions
> and workflows specific to that package.

---

## 1. What pi is

pi is a minimal terminal coding harness. TypeScript `Extension`s add
custom tools callable by the LLM, slash commands, keyboard shortcuts,
event handlers, and TUI components. Skills and prompt templates add
reusable instructions. Themes restyle the TUI. Packages bundle any of
the above for distribution via npm or git.

pi loads extensions via **jiti** — no build step. `.ts` files run as-is.
The rule: **TypeScript works without compilation. Do not add `tsc`,
bundlers, or `dist/` output.**

Official docs (also copied under `docs/pi-docs/`):
- `extensions.md` — extension API, events, lifecycle
- `tui.md` — components, widgets, footer, themes
- `themes.md` — theme format, all 51 color tokens
- `keybindings.md` — keyboard shortcuts
- `skills.md` — skill format (Agent Skills standard)
- `packages.md` — distribution via npm/git
- `sdk.md` — programmatic / runtime API
- `development.md` — forking pi itself

Authoritative location for the running pi install:
`C:\Users\Darcey\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\`

---

## 2. The extension API surface

Every TS file under `~/.pi/agent/extensions/`, `.pi/extensions/`, or
anywhere `pi.extensions` in `settings.json` points to, becomes an
extension. The entry point is a default-export factory:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
    // subscribe to events, register tools/commands/shortcuts, etc.
}
```

The factory is called once at startup. It can be sync or async (async
is useful for one-time init like fetching model lists). **Never start
background resources (timers, sockets, processes) in the factory** —
defer to `session_start` and clean up in `session_shutdown`.

### ExtensionAPI methods (used in pi-aftc-toolset)

| Method | Purpose |
|---|---|
| `pi.on(event, handler)` | Subscribe to a lifecycle event. |
| `pi.registerCommand(name, { description, handler, getArgumentCompletions? })` | Register a slash command. |
| `pi.registerTool({ name, label, description, parameters, execute, renderCall?, renderResult?, promptSnippet?, promptGuidelines? })` | Register an LLM-callable tool. |
| `pi.registerShortcut(key, { description, handler })` | Register a keyboard shortcut. |
| `pi.registerMessageRenderer(customType, fn)` | Custom render for messages with `customType` matching. |
| `pi.registerProvider(name, opts)` | Add a custom model provider (rare; for adapters). |
| `pi.appendEntry(customType, data)` | Persist extension state to the session JSONL. |
| `pi.sendMessage({ customType, content, display, details }, { triggerTurn?, deliverAs? })` | Inject a custom message into the session. |
| `pi.sendUserMessage(content, opts?)` | Send a user message that triggers an agent turn. |
| `pi.exec(command, args, opts?)` | Run a shell command. Returns `Promise<ExecResult>`. |
| `pi.getAllTools()` / `pi.getActiveTools()` / `pi.setActiveTools(names)` | Tool inventory + enablement. |
| `pi.getThinkingLevel()` | Current thinking level (`"off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh"`). |
| `pi.getCommands()` | List all registered commands. |
| `pi.getFlag(name)` | CLI flag value passed at startup. |

`pi.ui.*` and `pi.sessionManager.*` are accessed via `ctx.ui` /
`ctx.sessionManager` inside event / command handlers — see §4.

---

## 3. ExtensionContext vs ExtensionCommandContext

Two flavors of context object passed to handlers.

**`ExtensionContext`** (everything) — passed to event handlers and
shortcut handlers:
- `ctx.cwd`, `ctx.hasUI`, `ctx.mode` (`"tui" | "rpc" | "json" | "print"`),
  `ctx.model`, `ctx.signal`, `ctx.sessionManager`, `ctx.ui`
- `ctx.isProjectTrusted()` — for gating project-local resource reads.
- `ctx.shutdown()`, `ctx.compact()`, `ctx.getContextUsage()`,
  `ctx.getSystemPrompt()`, `ctx.abort()`, `ctx.hasPendingMessages()`,
  `ctx.isIdle()`

**`ExtensionCommandContext`** — extends ExtensionContext with
session-control methods. Only commands get this. **Never call
session-control methods from event handlers — they can deadlock.**

Command-context additions:
- `ctx.waitForIdle()` — wait for the agent to finish.
- `ctx.newSession({ setup?, withSession? })` — start a new session.
- `ctx.fork(entryId, { position?, withSession? })` — fork from an entry.
- `ctx.switchSession(path, { withSession? })` — switch to a saved session.
- `ctx.navigateTree(targetId, opts?)` — jump to a session-tree node.
- `ctx.reload()` — equivalent to `/reload`.

### ctx.mode and ctx.hasUI — guard UI work

```typescript
if (!ctx.hasUI) return;          // skip dialogs in headless modes
if (ctx.mode === "tui") { ... }  // only use ctx.ui.custom() etc in TUI
```

---

## 4. The event lifecycle

All events fire async. Handlers can be `async function`s. Event
handlers receive `ExtensionContext` (not the command one).

### Lifecycle order on startup

```
pi starts
  ├─► project_trust          (user/global + CLI extensions only)
  ├─► session_start { reason: "startup" }
  └─► resources_discover
      └─► (user submits prompt)
          ├─► input (can transform/handle)
          ├─► before_agent_start (can inject message + modify systemPrompt)
          ├─► agent_start
          ├─► message_start / message_update / message_end
          │   (loop per turn — tool calls cause more message_start/end pairs)
          ├─► tool_execution_start / tool_execution_update / tool_execution_end
          ├─► turn_start / turn_end
          └─► agent_end
      └─► (next prompt)
```

### Full event reference

| Event | When | Payload |
|---|---|---|
| `project_trust` | Before project resources load (user/global + CLI extensions only) | `{ cwd }` — return `{ trusted: "yes"\|"no"\|"undecided", remember? }` |
| `session_start` | Session started/loaded/reloaded | `{ reason: "startup"\|"new"\|"resume"\|"fork"\|"reload", previousSessionFile? }` |
| `session_info_changed` | `/name` or `pi.setSessionName()` | `{ name, previousName? }` |
| `session_before_switch` | Before `/new` or `/resume` | `{ reason, targetSessionFile? }` — return `{ cancel: true }` to abort |
| `session_before_fork` | Before `/fork` or `/clone` | `{ entryId, position }` — return `{ cancel: true }` |
| `session_before_compact` | Before `/compact` or auto-compact | `{ preparation, branchEntries, customInstructions, reason, willRetry, signal }` |
| `session_before_tree` | Before `/tree` navigation | `{ preparation, signal }` |
| `session_shutdown` | Before session runtime torn down | `{ reason: "quit"\|"reload"\|"new"\|"resume"\|"fork", targetSessionFile? }` — clean up resources |
| `session_compact` | After compaction | `{ compactionEntry, fromExtension, reason, willRetry }` |
| `session_tree` | After `/tree` navigation | `{ newLeafId, oldLeafId, summaryEntry, fromExtension }` |
| `input` | User submitted input, before skill/template expansion | `{ text, images?, source: "interactive"\|"rpc"\|"extension", streamingBehavior? }` — return `{ action: "continue"\|"transform"\|"handled" }` |
| `before_agent_start` | User prompt received, before agent loop | `{ prompt, images?, systemPrompt, systemPromptOptions }` — return `{ message?, systemPrompt? }` |
| `agent_start` | Once per user prompt | `{}` |
| `agent_end` | Agent finished | `{ messages }` |
| `turn_start` / `turn_end` | One turn = one LLM response + tool calls | `{ turnIndex, timestamp }` / `{ turnIndex, message, toolResults }` |
| `message_start` | Message lifecycle | `{ message }` — message has `role` (`"user"\|"assistant"\|"toolResult"`) |
| `message_update` | Streaming | `{ message, assistantMessageEvent }` — `assistantMessageEvent.type` is `"text_start"\|"text_delta"\|"thinking_delta"\|"toolcall_start"\|...` |
| `message_end` | Message finalized | `{ message }` — handler can return `{ message }` to replace it. |
| `tool_execution_start` / `_update` / `_end` | Tool lifecycle | `{ toolCallId, toolName, args }` / `{ toolCallId, toolName, args, partialResult }` / `{ toolCallId, toolName, result, isError }` |
| `tool_call` | After `tool_execution_start`, before execution. **Can block.** | `{ toolName, toolCallId, input }` — mutate `event.input` in place; return `{ block: true, reason? }` to block. Use `isToolCallEventType("bash", event)` to narrow input types. |
| `tool_result` | After tool execution, before `tool_execution_end`. **Can modify.** | `{ toolName, toolCallId, input, content, details, isError }` — return `{ content?, details?, isError? }` partial patches. |
| `user_bash` | User typed `!command`. **Can intercept.** | `{ command, excludeFromContext, cwd }` — return `{ operations? }` (e.g. SSH override) or `{ result? }`. |
| `model_select` | Model changed (`/model`, `Ctrl+P`, restore) | `{ model, previousModel?, source }` |
| `thinking_level_select` | Thinking level changed | `{ level, previousLevel }` |
| `context` | Before each LLM call. **Modify messages.** | `{ messages }` (deep copy, safe to mutate) — return `{ messages }` |
| `before_provider_request` | After payload built, before HTTP request. Inspect/replace. | `{ payload }` — return `{ ...payload }` to replace. |
| `after_provider_response` | After HTTP response received, before stream consumed | `{ status, headers }` — logging / rate-limit detection. |

### Helper type guards

```typescript
import { isToolCallEventType, isBashToolResult } from "@earendil-works/pi-coding-agent";
```

These narrow the union payload types so you can access tool-specific
fields without `as any` casts.

### input event return values (discriminated union)

```typescript
type InputEventResult =
    | { action: "continue" }
    | { action: "transform"; text: string; images?: ImageContent[] }
    | { action: "handled" };
```

- `continue` — pass through unchanged (default if you return nothing).
- `transform` — rewrite input before skill/template expansion.
- `handled` — skip the agent entirely (first handler to return this wins).

---

## 5. Tools (`registerTool`)

```typescript
import { Type } from "typebox";

pi.registerTool({
    name: "my_tool",                   // LLM-facing identifier (snake_case recommended)
    label: "My Tool",                    // human-readable label
    description: "What this tool does.",
    promptSnippet: "Optional one-liner shown in Available tools.",
    promptGuidelines: [
        "Use my_tool when the user asks to do X.",
    ],
    parameters: Type.Object({
        input: Type.String({ description: "The input value." }),
        count: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    }),
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
        onUpdate?.({ content: [{ type: "text", text: "Working…" }] });  // partial progress
        return {
            content: [{ type: "text", text: "Result" }],
            details: { foo: "bar" },  // optional metadata
            isError: false,
        };
    },
    renderCall: (args, theme, ctx) => { /* custom call rendering */ },
    renderResult: (result, options, theme, ctx) => { /* custom result rendering */ },
});
```

### Critical rules

- **Errors throw, not return** — throwing sets `isError: true` on the
  result. Returning a value never marks an error.
- **`execute` parameters**: `(toolCallId, params, signal, onUpdate, ctx)`.
  `params` is already validated/typed against the Typebox schema.
- **String enums use `StringEnum` from `@earendil-works/pi-ai`** —
  never `Type.Union([Type.Literal("a"), Type.Literal("b")])`. Google
  API breaks on the latter.
- **Use `ctx.signal`** for nested async (`fetch`, child-process
  spawn) so Escape cancels cleanly.
- **Truncate tool output** with `truncateHead` / `truncateTail`
  (exported from `@earendil-works/pi-coding-agent`). Always tell
  the LLM when output was truncated and where the full version
  lives. Default cap is 50KB / 2000 lines.
- **File-mutating tools** must wrap read-modify-write in
  `withFileMutationQueue(absolutePath, …)` so they serialize with
  built-in `edit`/`write`. Resolve to absolute path first.

### `onUpdate` for streaming partial results

```typescript
onUpdate?.({ content: [{ type: "text", text: "Progress: 50%" }] });
```

The TUI re-renders with the partial content. Final result replaces
it on `execute`'s return.

### Custom rendering

`renderCall(args, theme, ctx)` — what the LLM sees when it calls
the tool.
`renderResult(result, { expanded, isPartial }, theme, ctx)` — what
the user sees after execution.

Both must return a `pi-tui` Component (use `Text` / `Box` / `Markdown`
from `@earendil-works/pi-tui`). The default renderers are sensible;
only override when you need bespoke UI.

---

## 6. Commands (`registerCommand`)

```typescript
pi.registerCommand("my-command", {
    description: "What this command does.",
    getArgumentCompletions: (prefix) => [/* autocomplete strings */],
    handler: async (args: string, ctx: ExtensionCommandContext) => {
        // args is the raw text after the command name
        // ctx is ExtensionCommandContext (with newSession/fork/etc.)
    },
});
```

- **Namespace** with your extension's domain: `/<name>-stats`,
  `/<name>-profile`, `/<name>-toggle`. Avoid generic names like
  `/help` that collide with built-ins.
- **Long output** → use `ctx.ui.select(title, lines, { timeout })`.
  Returns when dismissed, ESC, Enter, or timeout. Never `console.log`
  inside a TUI extension — interleaves with pi's redraws.
- **Commands checked BEFORE `input` event, skills, and templates.**
  Keep them focused and fast.

---

## 7. TUI components and widgets

### Built-in components (import from `@earendil-works/pi-tui`)

- `Text` — multi-line text with word wrapping.
- `Box` — container with padding + bg.
- `Container` — groups children vertically.
- `Spacer(n)` — n empty lines.
- `Markdown(content, padX, padY, theme)` — markdown with syntax
  highlighting (use `getMarkdownTheme()` for the theme).
- `Image(base64, mime, theme, opts)` — terminal images (Kitty,
  iTerm2, Ghostty, WezTerm, Warp).

### Component interface

```typescript
interface Component {
    render(width: number): string[];   // one string per line, ≤ width
    handleInput?(data: string): void;
    wantsKeyRelease?: boolean;
    invalidate(): void;                // clear cached render
}
```

### Key detection

```typescript
import { matchesKey, Key } from "@earendil-works/pi-tui";
if (matchesKey(data, Key.enter)) { ... }
if (matchesKey(data, "ctrl+shift+p")) { ... }
if (matchesKey(data, Key.ctrl("c"))) { ... }
```

Key identifiers: `Key.enter`, `Key.escape`, `Key.tab`, `Key.space`,
`Key.up`/`down`/`left`/`right`, `Key.home`/`end`, `Key.backspace`,
`Key.delete`, `Key.pageUp`/`pageDown`, `Key.ctrl("c")`,
`Key.shift("tab")`, `Key.ctrlShift("p")`. String format also works:
`"enter"`, `"ctrl+c"`, `"ctrl+shift+p"`.

### Line width — critical

Every line in `render(width)`'s return MUST be ≤ `width` visible
cells. Use `truncateToWidth(str, width, ellipsis?)` from
`@earendil-works/pi-tui` and `visibleWidth(str)` for measurement.
Without truncation, the TUI can crash with a "rendered line exceeds
terminal width" error.

### Theme changes — invalidate() must rebuild pre-baked styles

If you build styled content with `theme.fg(...)` and cache it, you
**must** override `invalidate()` and rebuild:

```typescript
class MyComponent extends Container {
    private text: Text;
    constructor(message: string, private theme: Theme) {
        super();
        this.text = new Text("", 0, 0);
        this.addChild(this.text);
        this.rebuild();
    }
    private rebuild() {
        this.text.setText(this.theme.fg("accent", "X"));
    }
    override invalidate() {
        super.invalidate();
        this.rebuild();
    }
}
```

If you don't pre-bake styles (e.g. pass theme callbacks into child
components at render time), `invalidate()` can be a no-op.

### setWidget vs setFooter — pick the right slot

| Slot | Behavior | Use when |
|---|---|---|
| `ctx.ui.setFooter(factory, opts?)` | **Exclusive.** Whichever extension loads last wins. Factory gets `footerData: ReadonlyFooterDataProvider` with git branch + extension statuses. | You want to replace pi's entire footer. Don't share with other footer extensions. |
| `ctx.ui.setWidget(key, content, opts?)` | **Keyed.** Multiple extensions coexist. Each widget has a unique string key. | Default choice — composes with other extensions. |
| `ctx.ui.setStatus(key, content?)` | Bottom-of-screen status line. | Small status indicator (e.g. divider active toggle). |

```typescript
// Footer (exclusive):
ctx.ui.setFooter((tui, theme, footerData) => {
    return { dispose() {}, invalidate() {}, render(width) { return [/* lines */]; } };
});

// Widget (keyed):
ctx.ui.setWidget("my-widget", (tui, theme) => {
    return { dispose() {}, invalidate() {}, render(width) { return [/* lines */]; } };
}, { placement: "belowEditor" });  // or "aboveEditor" (default)

// Status (small text):
ctx.ui.setStatus("my-status", theme.fg("accent", "● on"));  // pass undefined to clear
```

### Common UI patterns (from official examples)

**Selection dialog** — `SelectList` + `DynamicBorder` + `Container`:

```typescript
import { Container, SelectList, Text } from "@earendil-works/pi-tui";

await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const items = [{ value: "a", label: "Option A" }, { value: "b", label: "B" }];
    const list = new SelectList(items, 10, {
        selectedPrefix: (t) => theme.fg("accent", t),
        selectedText: (t) => theme.fg("accent", t),
    });
    list.onSelect = (i) => done(i.value);
    list.onCancel = () => done(null);
    return { render: (w) => [/* container */], invalidate: () => {}, handleInput: (d) => list.handleInput(d) };
});
```

**Long scrollable text** — `ctx.ui.select(title, lines, { timeout })`.

**Settings toggles** — `SettingsList` + `getSettingsListTheme()`.

**Async with cancel** — `BorderedLoader`:

```typescript
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
const loader = new BorderedLoader(tui, theme, "Fetching…");
loader.onAbort = () => done(null);
fetchData(loader.signal).then(done).catch(() => done(null));
```

**Working indicator animation** — `ctx.ui.setWorkingIndicator`:

```typescript
ctx.ui.setWorkingIndicator({
    frames: [
        ctx.ui.theme.fg("dim", "·"),
        ctx.ui.theme.fg("muted", "•"),
        ctx.ui.theme.fg("accent", "●"),
        ctx.ui.theme.fg("muted", "•"),
    ],
    intervalMs: 120,
});
```

Pass `undefined` or empty `frames: []` to hide / restore default.

---

## 8. Themes

### File format

```json
{
    "$schema": "https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json",
    "name": "my-theme",
    "vars": { "primary": "#00aaff", "gray": 242 },
    "colors": {
        "accent": "primary",
        "border": "gray",
        // ... all 51 required tokens
    }
}
```

### All 51 required color tokens

**Core UI (11)** — `accent`, `border`, `borderAccent`, `borderMuted`,
`success`, `error`, `warning`, `muted`, `dim`, `text` (use `""` for
default), `thinkingText`.

**Backgrounds & content (11)** — `selectedBg`, `userMessageBg`,
`userMessageText`, `customMessageBg`, `customMessageText`,
`customMessageLabel`, `toolPendingBg`, `toolSuccessBg`,
`toolErrorBg`, `toolTitle`, `toolOutput`. Use with `theme.bg(token, text)`.

**Markdown (10)** — `mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`,
`mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`,
`mdHr`, `mdListBullet`.

**Tool diffs (3)** — `toolDiffAdded`, `toolDiffRemoved`,
`toolDiffContext`.

**Syntax (9)** — `syntaxComment`, `syntaxKeyword`, `syntaxFunction`,
`syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`,
`syntaxOperator`, `syntaxPunctuation`.

**Thinking-level borders (6)** — `thinkingOff`, `thinkingMinimal`,
`thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`.

**Modes (1)** — `bashMode`.

### Color value formats

- Hex: `"#ff0000"`
- 256-color index: `42`
- Variable reference: `"primary"` (must be defined in `vars`)
- Default: `""` (use terminal default)

### Theme hot-reload

pi watches the active theme file and reloads on change. Components
that pre-bake theme colors must override `invalidate()` to rebuild
— see §7.

### Runtime theme switching

```typescript
ctx.ui.getAllThemes()             // [{ name, path? }, ...]
ctx.ui.getTheme("light")          // load without switching
const result = ctx.ui.setTheme("light");  // returns { success, error? }
ctx.ui.theme.fg("accent", "X")    // current active theme at any time
```

---

## 9. Skills (Agent Skills standard)

```markdown
<!-- ~/.pi/agent/skills/my-skill/SKILL.md -->
---
name: my-skill
description: Specific description of when to use this skill.
---

# My Skill

## Steps
1. Do this
2. Then that
```

Frontmatter fields (per Agent Skills spec):
- `name` (required) — 1-64 chars, lowercase a-z 0-9 hyphens.
- `description` (required) — what the skill does AND when to use it.
  Be specific — this is what the model matches on.
- `license`, `compatibility`, `metadata`, `allowed-tools`,
  `disable-model-invocation` (optional).

Skills invoke via `/skill:<name>` or get auto-loaded by the model
matching on the description. Frontmatter-only versions are loaded
automatically; full content loads on demand. Keep descriptions
specific.

---

## 10. Keybindings

Customize via `~/.pi/agent/keybindings.json`:

```json
{
    "tui.editor.cursorUp": ["up", "ctrl+p"],
    "tui.editor.deleteWordBackward": ["ctrl+w", "alt+backspace"]
}
```

Format: `modifier+key`. Modifiers: `ctrl`, `shift`, `alt` (combinable).
Keys: letters, digits, special (`escape`, `enter`, `tab`, `space`,
`backspace`, `delete`, `home`, `end`, `pageUp`, `pageDown`,
function keys `f1`-`f12`, symbols (`` ` ``, `-`, `=`, `[`, `]`, `\`,
etc).

Use the full namespaced action id (`tui.editor.cursorUp`,
`app.session.new`, `app.model.cycleForward`, etc.). See `keybindings.md`
for the full list of 40+ actions.

---

## 11. Packages and distribution

### `pi install` sources

```bash
pi install npm:@foo/bar@1.2.3        # npm
pi install git:github.com/user/repo@v1  # git tag/commit
pi install https://github.com/user/repo  # raw URL
pi install ssh://git@github.com/user/repo  # SSH
pi install /absolute/path/to/package  # local
pi install ./relative/path  # local (relative to settings file)
```

Project-local installs go to `.pi/npm/` or `.pi/git/`. Use `-l`.

### Manifest in `package.json`

```json
{
    "name": "my-package",
    "keywords": ["pi-package"],
    "pi": {
        "extensions": ["./extensions"],
        "skills": ["./skills"],
        "themes": ["./themes"]
    }
}
```

Without the `pi` manifest, pi auto-discovers from conventional dirs:
`extensions/`, `skills/`, `themes/`.

### Dependencies

Runtime deps (extension imports) → `dependencies` in `package.json`.
Bundled pi packages (e.g. `pi-coding-agent`, `pi-ai`, `pi-tui`,
`typebox`) → `peerDependencies` with `"*"` range (do NOT bundle).
Other pi packages you wrap → `dependencies` AND `bundledDependencies`.

`pi install` runs `npm install --omit=dev` for git/npm packages, so
runtime deps must be in `dependencies` (not `devDependencies`).

---

## 12. Custom message rendering

Inject custom messages via `pi.sendMessage`:

```typescript
pi.sendMessage({
    customType: "my-extension",
    content: "Display this in the TUI",
    display: true,           // show in TUI (false = persisted but hidden)
    details: { extra: "data" },
}, { triggerTurn: true, deliverAs: "steer" });
```

Render with `pi.registerMessageRenderer`:

```typescript
pi.registerMessageRenderer("my-extension", (message, { expanded }, theme) => {
    const text = theme.fg("accent", message.content);
    return new Text(text, 1, 0);
});
```

Three cooperating hooks for visual-only messages (no LLM pollution):
1. `before_agent_start` injects the message.
2. `context` strips messages with `role === "custom" && customType === "my-extension"`.
3. `registerMessageRenderer` draws it.

---

## 13. The pub/sub event bus (cross-extension)

`pi.events` (and the `DefaultResourceLoader.eventBus`) is a shared
event bus. Extensions can emit and listen:

```typescript
const bus = createEventBus();
const loader = new DefaultResourceLoader({ eventBus: bus });
bus.on("my-extension:status", (data) => console.log(data));
bus.emit("my-extension:status", { state: "ready" });
```

Use sparingly — most communication should go through the orchestrator
pattern (one module imports another via the entry file).

---

## 14. Common pitfalls (synthesized from the rules + experience)

### `ctx.model` is undefined on early renders

Capture it from `session_start` and `model_select` event contexts
into a closure-scoped object. Read from that at render time, not
from `ctx.model` directly.

### `pi.getAllTools()` order is not stable

Sort the tool list before hashing or comparing (e.g. for prefix-
shape churn detection).

### `setFooter` is exclusive

If another extension loads after yours with `setFooter`, it wins.
Use `setWidget` for coexistence.

### Tool input shape

`event.input` in `tool_call` is mutable — mutate in place before
the tool runs. Use `isToolCallEventType("bash", event)` to narrow.

### `input` event `streamingBehavior`

`event.streamingBehavior` is `"steer"` (mid-stream interrupt) or
`"followUp"` (queued) when applicable. Otherwise undefined. Use this
to classify the prompt kind.

### `message_end` runs for every assistant message

Including tool-call continuations. Use `_pendingUserTurn` (set in
`message_start` for user) to distinguish the first assistant
response after a user message from automated tool-call continuations.

### `tui.requestRender()` schedules a render, doesn't block

The next animation frame calls `render()`. Safe to call from
timers, event handlers, anywhere.

### `setInterval` in a widget can leak

If pi recreates the widget (theme change, /reload), each call to
the widget factory creates a new ticker. The old tickers keep
running until something calls `dispose()`. Track the active
component at module scope and dispose on recreate. Wrap the
ticker callback in try/catch so errors don't kill the timer.

### `console.log` inside TUI extensions

Never use `console.log` for output the user should see — it
interleaves with the TUI's redraws and corrupts the screen. Use
`ctx.ui.notify(...)`, `ctx.ui.select(...)`, or your widget.

### String enums must use `StringEnum` from `@earendil-works/pi-ai`

`Type.Union([Type.Literal("a"), Type.Literal("b")])` breaks the
Google API. `StringEnum(["a", "b"] as const)` is correct.

### Errors are thrown, not returned

`execute()` throws → `isError: true`. `return { isError: true }` is
NOT how it works.

### `ctx.signal` for nested async

Pass `ctx.signal` to `fetch`, `spawn`, etc. so Escape cancels
cleanly. Same for `AbortController` inside tools.

### Background resources in the factory

The factory runs even in invocations that never start a session
(`pi list`, `pi --help`). Defer timers / sockets / processes to
`session_start` and clean up in `session_shutdown`.

### Per-session state in closure

Mutable per-session state belongs in the factory closure or a
class instance created there, not in module globals. Module-level
mutable state is only for intentional cross-session persistence.

---

## 15. Quick reference cheatsheet

```typescript
// imports
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Type, StringEnum } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";  // for tool string enums
import { Text, Box, Container, Markdown, truncateToWidth, visibleWidth, matchesKey, Key } from "@earendil-works/pi-tui";
import { isToolCallEventType, isBashToolResult, getMarkdownTheme, withFileMutationQueue, truncateHead, truncateTail, defineTool } from "@earendil-works/pi-coding-agent";

// minimal extension
export default function (pi: ExtensionAPI): void {
    pi.on("session_start", async (_e, ctx) => {
        // setup
    });
    pi.on("session_shutdown", async () => {
        // cleanup timers / processes
    });
    pi.registerCommand("name", {
        description: "…",
        handler: async (args, ctx) => {
            if (ctx.hasUI) await ctx.ui.select("Title", ["line 1", "line 2"]);
        },
    });
    pi.registerTool({
        name: "name", label: "Name", description: "…",
        parameters: Type.Object({ input: Type.String() }),
        execute: async (_id, params, signal, onUpdate) => ({
            content: [{ type: "text", text: "ok" }],
        }),
    });
}
```

### Paths quick reference

| What | Where |
|---|---|
| pi binary | `C:\Users\Darcey\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\` |
| pi docs | `…\pi-coding-agent\docs\` (or local `docs/pi-docs/`) |
| pi examples | `…\pi-coding-agent\examples\extensions\` |
| pi types | `…\pi-coding-agent\dist\core\extensions\types.d.ts` |
| pi-tui types | `…\pi-coding-agent\node_modules\@earendil-works\pi-tui\dist\` |
| User global extensions | `~/.pi/agent/extensions/` |
| User global skills | `~/.pi/agent/skills/` |
| User global themes | `~/.pi/agent/themes/` |
| Settings | `~/.pi/agent/settings.json` |
| Keybindings | `~/.pi/agent/keybindings.json` |
| Auth (API keys / OAuth) | `~/.pi/agent/auth.json` |
| Models config | `~/.pi/agent/models.json` |
| Sessions | `~/.pi/agent/sessions/` |

### Quick commands

```bash
# reload extensions + skills + prompts + keybindings (themes hot-reload)
pi # then /reload

# list installed packages
pi list

# install / remove
pi install npm:@foo/bar
pi install git:github.com/user/repo@v1
pi remove npm:@foo/bar

# update
pi update
pi update --all
pi update npm:@foo/bar

# debug
PI_DEBUG_REDRAW=1 pi             # log why pi did a full redraw
PI_TUI_DEBUG=1 pi               # dump each render to /tmp/tui/
PI_SKIP_VERSION_CHECK=1 pi       # no startup network check
PI_OFFLINE=1 pi                 # disable all startup network
```

### Modal dialog ordering (TUI)

```
overlayStack (rendered on top of editor area)
  └─ visible only if isOverlayVisible(entry)
       ├─ true: enter captures input, blocks editor
       └─ false: still in stack but doesn't capture input
```

Use `ctx.ui.custom(factory, { overlay: true })` for modals. Pass
`overlayOptions` for anchor + size + position. Set `nonCapturing`
in options if the overlay should not steal focus.

---

## 16. When to use what — decision tree

| Need | Use |
|---|---|
| LLM-callable capability | `registerTool` |
| User-invoked command | `registerCommand` |
| Persistent key binding | `registerShortcut` |
| Inject instructions per turn | `before_agent_start` (return `{ systemPrompt }`) |
| Inject a one-time message | `before_agent_start` (return `{ message }`) + `context` (strip) + `registerMessageRenderer` |
| Block / modify a tool call | `tool_call` event |
| Modify tool result before LLM sees | `tool_result` event |
| Modify messages before next LLM call | `context` event |
| Status indicator in footer | `setStatus` |
| Multi-line panel in editor area | `setWidget` |
| Replace footer entirely | `setFooter` |
| Modal dialog with input | `ctx.ui.custom(factory, { overlay: true })` |
| Modal with list selection | `ctx.ui.custom(factory)` + `SelectList` |
| Long scrollable output | `ctx.ui.select(title, lines, { timeout })` |
| Periodic update | `setInterval` in factory + `tui.requestRender()` |
| Persistent extension state | `pi.appendEntry(customType, data)` |
| Cross-extension messaging | `pi.events` event bus |
| Capture TUI focus | `ctx.ui.custom` overlay (nonCapturing: false) |

---

## 17. Files copied under `docs/pi-docs/`

For offline reference. These are copies of the official pi docs
at the time this guide was written. If they drift, the live versions
live at `C:\Users\Darcey\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\docs\`.

- `extensions.md` — full extension API reference
- `tui.md` — TUI components, widgets, footer, common patterns
- `themes.md` — theme format + all 51 color tokens
- `keybindings.md` — full action list + customization
- `skills.md` — skill format (Agent Skills standard)
- `packages.md` — npm/git distribution
- `sdk.md` — programmatic / runtime API (`createAgentSession`)
- `development.md` — forking pi itself
- `quickstart.md` — install + auth + first command
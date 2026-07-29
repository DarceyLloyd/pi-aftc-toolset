# pi Extension Development

Gotchas and conventions for building extensions for the pi CLI coding agent (`@earendil-works/pi-coding-agent`). Official docs: `docs/extensions.md` under the installed package. Entries lead with the greppable symptom.

## Rules

## Gotchyas

- [cL1pBd] Clipboard write from an extension — hand-rolling clip/pbcopy/wl-copy/OSC 52 per platform is error-prone and unnecessary; import { copyToClipboard } from "@earendil-works/pi-coding-agent" (pi's own cross-platform helper: native addon, platform tools, OSC 52 fallback — it throws "Failed to copy to clipboard" when every method fails, so await it in try/catch and only clear the source text AFTER it resolves).
- [kQ7vX2] Caching a JSON config/preferences file in module memory — pi keeps extension modules alive across /new (the factory does NOT re-run), so the cache goes stale when the user hand-edits the file mid-process and the next write flushes the stale cache back over their edits; read the file fresh from disk on EVERY access (small local file, sync read is free) and make writes a fresh read-modify-write so external edits survive.

## Issues & Solutions


- [h3YB8Y] Trailing text shows on every row of a showMenu / selectable list (eg every option ends with "NONE")
  Cause: the item `description` field renders to the right of the label on the same row, so a placeholder like "NONE" for "unset" clutters every line.
  Fix: only set `description` when there is a real value; spread it in conditionally (`...(cur ? { description: label } : {})`), omit it otherwise. (2026-07)
- [PBFPV8] Extension TypeScript fails to load after adding a build step / tsc / dist
  Cause: pi loads .ts directly through jiti, there is no compile stage.
  Fix: never add tsc/bundler/dist; ship raw .ts and import npm packages directly. (2026-07)
- [wcpRdB] Process/socket/watcher starts even when no session runs (orphaned sidecars)
  Cause: the default-export factory runs on every load, including loads that never start a session.
  Fix: never start background resources in the factory; defer to `session_start` or the command/tool/event that needs them and tear down in an idempotent `session_shutdown`. (2026-07)
- [JNQyUx] Dialog crashes or silently no-ops in print mode (`pi -p`)
  Cause: dialog methods need a UI.
  Fix: guard `select`/`confirm`/`input`/`notify` with `ctx.hasUI`; guard `ctx.ui.custom()` and TUI components with `ctx.mode === "tui"`. (2026-07)
- [ZdaSgo] Custom tool never appears in the system prompt's Available tools / LLM never calls it
  Cause: tools are omitted from the prompt unless opted in.
  Fix: add a `promptSnippet`, and make every `promptGuidelines` bullet name the tool explicitly ("Use my_tool when...", never "Use this tool when..." — guidelines are appended flat with no tool prefix). (2026-07)
- [BREhq6] Status/notify integration fires while pi is still auto-retrying or compacting
  Cause: `agent_end` fires per low-level run and pi may still retry/compact/continue.
  Fix: use `agent_settled` (not `agent_end`) when you need to know pi will not continue automatically. (2026-07)
- [UABWUm] New preference missing from an existing user's config.json after you add the field
  Cause: config.json is only rewritten on `setPreference`, so older files lack new keys.
  Fix: `getPreference(key, default)` already falls back at read time; to make a new key explicit on disk, detect the missing/wrong-type field in the load-merge and write back once (the aftc-intro migration pattern). (2026-07)
- [MSs2I3] Extension state (config.json / turns.db / ssh.json) wiped after `pi update --extensions` or a version-mismatch reinstall
  Cause: pi replaces the whole package directory on update, deleting anything inside it.
  Fix: don't store durable state inside the package; put it in a per-user persistent dir OUTSIDE the package: `%APPDATA%\<pkg>` (win32), `~/Library/Application Support/<pkg>` (darwin), `$XDG_DATA_HOME/<pkg>` or `~/.local/share/<pkg>` (linux); honour an env override (eg AFTC_TOOLSET_DATA_ROOT) for tests. (2026-07)
- [pJRyWq] Migration to a persistent dir loses the EXISTING data on the very update that introduces it
  Cause: pi wipes the old package dir BEFORE the new extension code loads, and the new code resolves paths to its own (fresh) package dir, so it never sees the old files.
  Fix: you cannot recover prior package-local data through a normal update; ship forward-looking preservation (data survives every FUTURE update) and accept the one-time transition loss; a copy-forward migration only helps non-wipe cases (dev installs, `pi -e`, manual copies). (2026-07)
- [FKUzM0] Migrating a possibly-locked file (eg the SQLite DB held open on Windows)
  Cause: a move/rename fails on a locked source.
  Fix: do copy-only forward (a read succeeds even on a locked source), never overwrite an existing destination, then best-effort delete the legacy file, retrying deletion on the next run once the previous session's handles are released; make it idempotent and run it at startup before any module opens the data. (2026-07)
- [9gbnFW] Selectable overlay modal renders full-screen or mis-anchored
  Cause: overlay geometry must be requested explicitly.
  Fix: open with `ctx.ui.custom(factory, { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" } })` and follow the cd.ts selection pattern (reset selection after refresh, keep it in the viewport, page movement). (2026-07)
- [IfdS1v] Custom tool string enum rejected by Google models
  Cause: raw TS string unions are not Google-compatible.
  Fix: use `StringEnum` from `@earendil-works/pi-ai` for tool parameter enums. (2026-07)
- [jPehMS] Tool error swallowed / shown as success
  Cause: returning an error object is not treated as failure.
  Fix: `throw` from a tool `execute()` to report an error; truncate large output with `truncateHead`/`truncateTail` and state that it was truncated. (2026-07)
- [hDU7Lp] Esc does not cancel a fetch/model call started in a handler
  Cause: the work is not wired to the abort signal.
  Fix: pass `ctx.signal` into nested async (`fetch(..., { signal: ctx.signal })`); note it is `undefined` in idle/command contexts. (2026-07)
- [FJ7k4l] Code after `await ctx.reload()` runs against stale state
  Cause: reload tears down the current runtime but the running handler keeps its old call frame.
  Fix: treat `await ctx.reload(); return;` as terminal for the handler; tools cannot call it, so expose a command and have the tool queue it via `pi.sendUserMessage("/cmd", { deliverAs: "followUp" })`. (2026-07)
- `[Qs2kOy] withSession` callback throws when using a captured old ctx/sessionManager
  Cause: after session replacement the old pi/ctx/session objects are stale and throw.
  Fix: use only the `ctx` passed into `withSession`; capture only plain data (strings/ids) before replacement, never live objects. (2026-07)
- [tW4Q5a] Concurrent file-mutating tools corrupt a target
  Cause: parallel tool execution can write the same path at once.
  Fix: wrap file-mutating custom tools in `withFileMutationQueue()` keyed on the absolute target path. (2026-07)
- [X1MYbl] Project-local config path breaks on rebranded pi distributions
  Cause: hardcoding `.pi` assumes the default config dir name.
  Fix: import `CONFIG_DIR_NAME` from `@earendil-works/pi-coding-agent` and join it instead of the literal `.pi`. (2026-07)
- [vB94CM] A navigation menu shows a disable / "NONE" option that makes no sense there
  Cause: NONE/disable is a *selection* concern, not a *navigation* concern; a top-level menu whose options only open sub-screens should list just those destinations.
  Fix: put NONE/disable only inside the actual file/value picker where choosing "nothing" is a real outcome; keep navigation rows to plain labels (at most a current-value hint), never action placeholders. (2026-07)
- [Y0RWnY] A skill helper script (eg a file-concatenation tool) writes its script/output into the extension's data dir, polluting persistent state (and a data-migration then promotes that junk to permanent state)
  Cause: skill artifacts are NOT extension state; the data dir is only for cross-session state (config/db/ssh/replay).
  Fix: bundle the helper WITH the skill (`skills/<name>/scripts/<tool>.js`, referenced by a path relative to SKILL.md per the Agent Skills standard) and default its output to the OS temp dir (`os.tmpdir()` — %TEMP% win, /tmp linux, /var/folders mac), never the extension data dir or the folder being read. (2026-07)
- [DKmmsL] User reports a visual/report bug but your headless test of the source passes, and re-editing seems to do nothing
  Cause: pi loads extensions through jiti which CACHES the compiled module for the running process until `/reload`, so an edited .ts is NOT live, and any artifact the extension writes (eg report.html) was produced by the OLD in-memory code, so even opening the on-disk file shows the stale output.
  Fix: diagnose by grepping the artifact the user is actually viewing for a unique marker from your new code and comparing its mtime to the .ts mtime; to give an immediate preview, regenerate the artifact from a fresh out-of-process jiti load (a throwaway node script), and tell the user the live extension needs `/reload` to pick up the .ts change. (2026-07)
- `[VOUzcV] ctx.ui.custom()` overlay silently never appears (or is flaky/intermittent) when called from `session_start`
  Cause: the TUI isn't idle/ready yet, so the overlay is dropped; the documented `setTimeout(..., 500-600)` workaround is UNRELIABLE in practice (a startup intro built on it never worked reliably even after hours of trying).
  Fix: don't gate startup UI on timers/TUI-ready. Reliable alternatives: (1) for content that belongs in the transcript, use `pi.appendEntry(customType, data)` + `pi.registerEntryRenderer(customType, renderer)` (a durable entry rendered in the normal transcript flow with NO timing dependency); (2) `ctx.ui.setStatus(key, text)` / `ctx.ui.setWidget(key, lines)` queue for the NEXT render cycle and work from session_start; (3) if you truly need a `ctx.ui.custom()` overlay, defer it to the `input` event (fires only when the user interacts, TUI guaranteed up) rather than a timer. If you must use the timer, clear it in stop/dispose so a shutdown during the delay doesn't leave a dangling overlay. (2026-07)
- [O4csev] Need to tell a fresh session from a resume/reload at startup (eg show a one-time notice only on a fresh session)
  Cause: heuristics off `getEntries().length` are unreliable for fresh-vs-resume.
  Fix: don't heuristic off `getEntries().length`; `session_start` carries `event.reason: "startup" | "reload" | "new" | "resume" | "fork"`; treat `"new"`/`"startup"` as fresh and `"resume"`/`"reload"`/`"fork"` as restore. (2026-07)
- [zUXcj6] Filtering messages in the `context` event removes a tool result but the provider then rejects the request / the model errors ('tool_use without tool_result', orphaned tool call)
  Cause: the assistant message still carries the matching tool_use ToolCall when you drop only its tool_result message.
  Fix: remove tool calls and their results as MATCHED PAIRS: strip the ToolCall from the assistant message's content array AND remove the corresponding tool_result message together (custom non-tool messages drop freely). There is NO public API to delete a stored session entry (only destructive `branch(entryId)`/`resetLeaf()`), so the `context` event filter (a non-destructive edit of the LLM-bound deep copy) is the only safe way to hide content from the model; the stored transcript keeps the inert entries until compaction. (2026-07)
- `[AbgNKI] pi.appendEntry(customType, data)` content never reaches the model (you expected it in context), or a user-only notice is polluting the model context
  Cause: appendEntry creates a custom ENTRY that does NOT participate in LLM context (pair with `pi.registerEntryRenderer` for TUI display).
  Fix: to put content INTO the model context use `pi.sendMessage(...)` / `appendCustomMessageEntry(customType, content, display, details)` (a custom MESSAGE, pair with `pi.registerMessageRenderer`). Rule: durable state / user-only notices → appendEntry; content the model must see → sendMessage. (2026-07)
- `[SXsM82] before_agent_start` can return `{ systemPrompt }` and/or `{ message }` and you picked the wrong one / injected system-prompt content causes a cache miss every turn
  Cause: the two targets behave differently: `{ systemPrompt: event.systemPrompt + ... }` rewrites the per-turn system prompt (the CACHED PREFIX, chained across extensions, NOT stored in history), ideal for stable always-on content; `{ message: { customType, content, display } }` injects a PERSISTENT message stored in the session and sent to the LLM (searchable/prunable in history, but in the conversation body, not the prefix). Because the system prompt is the cached prefix, anything injected there must be BYTE-STABLE (sorted, no timestamps/'generated at', skip the write when unchanged) or the prefix churns and every turn cache-misses.
  Fix: keep volatile/per-session data in a message or out of the prefix. (2026-07)
- `[m5UHsz] pi.sendMessage` throws 'must specify deliverAs' / an injected message is never delivered when sent while the agent is streaming
  Cause: `deliverAs` is REQUIRED when the agent is busy: 'steer' (deliver after the current turn's tool calls), 'followUp' (wait until the agent fully finishes), 'nextTurn' (queue for the next user prompt, triggers nothing); `triggerTurn:true` only applies to steer/followUp.
  Fix: Before injecting from a command/tool that may run mid-stream, check `ctx.isIdle()` and pass an explicit `deliverAs` when not idle. (2026-07)
- [X2Ff3n] Need to transform/rewrite the finalized assistant message (eg convert inline think tags to ThinkingContent, redact, correct cost)
  Cause: the finalized message must be replaced in place, which the `message_end` hook supports.
  Fix: `message_end` handlers can `return { message }` to REPLACE the finalized message; the replacement MUST keep the same `role`. Fires for user/assistant/toolResult messages; `message_update` carries the token stream (`assistantMessageEvent`) for live streaming edits. (2026-07)
- [rwp25U] State stored only in conversation messages is lost or garbled after compaction (the model 'forgets' it)
  Cause: compaction folds messages into a lossy summary (`serializeConversation` emits `[Assistant thinking]: …`).
  Fix: `session_before_compact` can cancel (`{ cancel: true }`) or supply a custom summary, but to PRESERVE data across compaction store it in a custom ENTRY (`pi.appendEntry` — survives intact, not in LLM context) or a file, not a message; restore it on `session_start` by scanning `ctx.sessionManager.getEntries()`. (2026-07)
- [3e8BFd] Your slash command silently became `/name:1` / `/name:2`
  Cause: when multiple extensions (or an extension + a prompt template/skill) register the same command name, pi keeps them ALL and assigns numeric invocation suffixes in load order.
  Fix: pick distinctive names and verify no collision with pi built-ins or other loaded extensions/templates/skills. (2026-07)
- [7tJ1hx] Custom tool path argument resolves to a nonexistent file like `@src/foo.ts`
  Cause: some models prepend a `@` to path arguments (built-in tools strip it; custom tools don't).
  Fix: normalize a leading `@` off any path parameter in your custom tool before resolving it against `ctx.cwd`. (2026-07)
- [rXjDDA] Custom provider extension is redundant or fights the built-in (pi 0.81+)
  Cause: pi now registers providers natively (native `/login`, model picker), so a custom provider may be disconnected/unnecessary (eg an Alibaba/Qwen module that had to be disabled once pi added native support).
  Fix: before building a `pi.registerProvider` extension, check whether pi already ships the provider natively. (2026-07)
- [Qf8Wn2] Coloring custom TUI output / `theme.fg("white", …)` throws "Unknown theme color" / putting two colors on one line
  Cause: `theme.fg(color, text)` and `theme.bg(color, text)` take a COLORS KEY from the theme's `colors` map — NOT a `vars` name and NOT a hex; an unknown key THROWS. The theme JSON has `vars` (raw hex, eg `white: #fee3cd`, `accent: #fca02f`) and `colors` (semantic key → var, eg `accent→accent`, `mdHeading→white`, `toolTitle→white`, `text→""`=default fg, `dim→gray`, `muted→gray`). `theme.fg` wraps the text in ANSI and resets ONLY the foreground (`\x1b[39m`); `theme.bold(text)` is chalk.bold.
  Fix: pass a colors KEY that resolves to the var you want — `theme.fg("accent", s)` for the accent orange (#fca02f); `theme.fg("mdHeading", s)` or `theme.fg("toolTitle", s)` for white (the `white` var); `theme.fg("text", s)` for the default fg. pi-tui `Text(content, x, y)` renders embedded ANSI, so compose a multi-color line by concatenating fg segments: `new Text(theme.fg("mdHeading", theme.bold(title + ":")) + " " + theme.fg("accent", value), 0, 0)`. `Box(width, height, styleFn)` stacks `addChild` children vertically (one per line); the styleFn is a background (eg `(t) => theme.bg("customMessageBg", t)`) or identity `(t) => t` for none. For custom colored transcript output use `pi.appendEntry(customType, data)` + `pi.registerEntryRenderer(customType, (entry, opts, theme) => box)` (the renderer receives the theme; return a Box of Text children); wrap the color calls in try/catch with a plain-text fallback so a theme missing a key fails soft. (2026-07)
- [Kz4TxQ] `import type { helper }` on a line shared with a real type, then calling the helper at runtime -> extension feature silently never runs (runtime ReferenceError)
  Cause: `import type` is fully erased at compile time (jiti/esbuild strip it without type-checking), so any VALUE imported through it becomes an unresolved identifier at runtime; easy to miss when a type and a function share one import line (eg `import type { IntroDescriptor, dlog } from "./intro-factory"`).
  Fix: import runtime values with a value import (`import { dlog, type IntroDescriptor } from ...`); reserve `import type` for types only. If an extension feature "silently never runs," check every `import type` line for a value used at runtime. (2026-07)
- [Qn7VbK] Startup full-screen takeover intro impossible with pi UI (no "TUI ready" event; ctx.ui.custom() from session_start dropped; timers flaky; first-input-event trigger means the user waits)
  Cause: pi's event union has no readiness signal, and every pi-UI path either fires too early (overlay dropped) or too late (input event needs a prompt submit).
  Fix: bypass pi UI entirely with a RAW ANSI takeover: enter the terminal ALTERNATE SCREEN BUFFER (`\x1b[?1049h`, restore with `\x1b[?1049l` — the vim/htop mechanism, non-destructive, terminal restores the app screen exactly), hide the cursor (`\x1b[?25l`/`\x1b[?25h`), paint every row with absolute cursor positioning one column short of full width (never touch the bottom-right cell = no scroll), repaint on a ~250ms heartbeat so stray app writes are covered within one frame, dismiss on any stdin `data` key (remove the listener on exit), and guard with a max-time failsafe so the app can never be trapped. Trigger it directly from the session_start handler — with raw ANSI the handler call IS the signal. (2026-07)
- [dR7kPm] Module-level function destructures a field from a shared context/interface object that doesn't declare it -> field is `undefined` at runtime, crashes on first use (eg `const { inject } = ctx` where CodexContext has no `inject`)
  Cause: pi loads .ts via jiti which does NOT type-check, so TypeScript interface mismatches that would be compile errors in tsc are silent at runtime; the destructured field resolves to `undefined` and the first method call on it throws `TypeError: Cannot read properties of undefined`.
  Fix: never destructure a field from a shared context object unless the interface explicitly declares it; pass additional APIs as separate function parameters (eg `openMainMenu(ctx, cctx, inject)` not `const { inject } = ctx`); grep for destructuring patterns against the interface definition after any refactor that moves fields between objects. (2026-07)
- [wQ4nXt] Need to identify/filter custom messages (from pi.sendMessage) in the `context` event's messages array
  Cause: the shape is not obvious from the sendMessage API alone.
  Fix: custom messages in `event.messages` have `role: "custom"` and a `customType: string` field (confirmed against session-format.md `CustomMessage` interface); filter with `m.role === "custom" && m.customType === "your-type"`; they can be freely removed (no tool_use pairing needed, unlike assistant toolCall + toolResult pairs); `content` is `string | (TextContent | ImageContent)[]`. (2026-07)
- [jT9dNm] Test comparing a module-resolved path against a test-computed path fails on Windows with separator mismatch (C:/x vs C:\x)
  Cause: under jiti, __dirname inside the loaded .ts module uses FORWARD slashes on Windows, while the test's own fileURLToPath(import.meta.url)/path.join produce BACKslashes — same dir, different string.
  Fix: path.normalize() BOTH sides before asserting equality in any test that compares a path coming out of a jiti-loaded module (eg getPackageRoot()) against one the test built itself. (2026-07)
- [eD7aRw] pi edit tool: oldText fails to match when the target contains a Unicode arrow (→) but you typed ASCII ">" / "->"
  Cause: docs in this ecosystem use the U+2192 arrow heavily; composing oldText from memory produces ">" which never matches the literal "→". A failed edit batch applies NOTHING (every edit in the call is rolled back), and the same rollback happens when one call mixes edits for TWO different files (the second path's oldText can't be found in the first).
  Fix: copy oldText verbatim from a FRESH read of the exact region (never from memory), keep it small, and run ONE edit call per file. On any "oldText must match exactly" failure: re-read the region, fix the anchor, re-apply the whole batch. (2026-07)

- [sK9fQ2] Need to edit the ACTIVE session .jsonl while pi is running (compact/redact/rewrite entries) — is the file locked, does pi notice?
  Cause: pi appends one JSONL line per entry with appendFileSync and closes the handle immediately (NO lock, NO file watcher); _rewriteFile (truncate + full rewrite) runs ONLY at load time (version migration / empty-file init), never mid-session on the active file; pi keeps the whole session in memory and never re-reads the file.
  Fix: there is no lock to wait for — rewrite via tmp + rename at any time, keep every other line byte-identical, and re-read the file before the rename to merge a pi append that landed mid-rewrite (pi only ever appends, so raw2.startsWith(raw) means merge the tail). Disk edits are invisible to the RUNNING session until /reload or /resume; for a LIVE effect mutate the entry objects returned by ctx.sessionManager.getBranch()/getEntries()/getEntry() — they are SHARED references to pi's internal entries, so the next buildSessionContext picks the mutation up (verified in dist; do a read-back check and degrade to disk-only if a future pi deep-copies). Unknown extra fields on an entry object (eg a "processed" marker) survive both in memory and on disk. (2026-07)

- [tH4xW8] Editing an assistant thinking block's TEXT breaks the next provider call (Anthropic invalid thinking signature)
  Cause: ThinkingContent carries a cryptographic thinkingSignature that Anthropic validates on replay; pi-ai's transformMessages keeps same-model thinking blocks WITH signatures and converts them to plain text only cross-model, so a mutated text + old signature = API error.
  Fix: never edit thinking text in place — replace the whole thinking block with a {type:"text"} block (pi's own cross-model shape), and never touch the most recent assistant turn's thinking (it must stay intact for tool-call replay — keep a safe distance of several entries from the session leaf). (2026-07)

- [pi7Qa2] Want status/success output in the theme's accent (emphasis) colour, but ctx.ui.notify renders it dim or yellow
  Cause: ctx.ui.notify(msg, type) accepts only "info"|"warning"|"error" and maps them to dim / yellow+"Warning:" / red+"Error:" — there is NO severity for the theme's `accent` token, so emphasised status/success/state-change text is impossible through notify (info reads as a faint aside, warning mislabels ordinary output as a caution).
  Fix: emit an accent-coloured transcript ENTRY instead — register once with pi.registerEntryRenderer(customType, (entry, _opts, theme) => new Text(theme.fg("accent", text), 1, 0)), then pi.appendEntry(customType, { text }) per message (display-only, never in LLM context — see [AbgNKI]; valid theme.fg keys in [Qf8Wn2]). appendEntry/registerEntryRenderer live on `pi` (ExtensionAPI), NOT on `ctx`, so a reusable output module caches `pi` in an init(pi) and has its line methods take `ctx`. (2026-07)

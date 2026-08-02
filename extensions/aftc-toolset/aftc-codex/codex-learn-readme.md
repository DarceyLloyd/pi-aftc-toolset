# codex-learn.ts

Self-education loop (`/aftc-codex-learn`) (spec B).

## What it adds to the extension

### `/aftc-codex-learn` (spec B2)

Injects instructions (as a user message) telling the model to persist DURABLE,
GENERAL lessons into the codex using the codex entry tools
(`codex_add_entry` / `codex_edit_entry` / `codex_remove_entry` — see
`codex-entries-readme.md`). Every write goes through the tools: never hand-edited
resource files, never a bash-run sync script (the tools handle `[ID]`s, per-kind
format validation, canonical section placement, topic/category creation and the
resource-list sync internally). The prompt keeps only the work the tools cannot
do:

1. **Review the session** for durable, general lessons (never project-specific).
2. **Consult the resource list** (already in the system prompt, or
   `codex_load("list")`) — update the right existing doc; create a new topic
   (`category/name`, new categories allowed) only when nothing covers it.
3. **codex_load each target topic** and check the lesson is not already there.
   This is enforced, not trusted: the write tools REFUSE to modify a topic not
   loaded this session, and reject exact duplicates.
4. **Classify + write** — first match wins, in order: observed failure with a
   diagnosis > `issue`; a convention we choose > `rule`; a technology trap you
   can only avoid > `gotcha`. Auto-add by default
   (`aftcCodexAutoAddEntries`), or propose-then-confirm when that pref is off
   (M-I8). Routing: TECH lessons > the correct category doc under `resources/`
   only; the fixed top-level docs (`codex-rules.md`, `markdown-guidance.md`,
   `thought-and-action-guidance.md`) are never written by `-learn`.
5. **Correct/remove** outdated entries noticed along the way
   (`codex_edit_entry` / `codex_remove_entry`) — no waiting for a future `-learn`.

The prompt states the WRITE target explicitly (the tools write the LIVE per-user
copy; the package's `data/aftc-codex` seed is read-only) and closes with the
guardrails: durable + general only, write for a weak reader, never fabricate or
pad — report an empty result honestly (added after a session whose learn loop
burned most of its budget on meta-deliberation).

## Public API

`createCodexLearn(ctx)` returns `CodexLearnApi`:

- `buildLearnPrompt()` — the learn instruction prompt.
- `injectLearnPrompt(busy)` — send it as a user message (`deliverAs: "followUp"` when busy).

## Events subscribed

None.

## Files persisted

None.

## Failure modes

`injectLearnPrompt` is best-effort try/catch -> no-op.

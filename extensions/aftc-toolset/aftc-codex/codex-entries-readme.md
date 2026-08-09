# codex-entries.ts

Model tools for deterministic codex resource WRITES: `codex_add_entry`,
`codex_edit_entry`, `codex_remove_entry`. They replace the old prompt-choreographed
flow (hand-edit files, hand-generate 6-char `[ID]`s, run the sync script via bash)
with validated, atomic, tool-executed writes. The model still owns the judgement
(what is worth recording, where it routes, which kind, duplicates-by-meaning); the
tools own everything mechanical.

## What it adds to the extension

### `codex_add_entry` (batched)

Appends one or more entries to `resources/<category>/<topic>.md` in ONE call:

- Generates the 6-char `[ID]` in TypeScript (unique within the file; mirrors
  `scripts/ensure-entry-ids.mjs`). Any model-made wrapper (`- `, backticks, a
  hand-made `[ID]`, `Cause:`/`Fix:` prefixes, a stale date) is stripped.
- Validates per kind: `rule`/`gotcha` = single line in `text`; `issue` = `text`
  (symptom lead) + `cause` + `fix`, the current `(YYYY-MM)` date auto-appended.
  One invalid entry fails the WHOLE batch before anything is written (single
  write per call), with the offending `entries[i]` labelled.
- Inserts at the END of the matching canonical section (`## Rules` /
  `## Gotchyas` / `## Issues & Solutions`; a missing heading is appended at EOF —
  legacy-file tolerance).
- Creates a missing topic file with the three-heading skeleton, and missing
  CATEGORY folders (any well-formed lowercase name — new categories are
  legitimate; the result notes `created NEW category folder` as a typo signal).
  Topic shapes: `name` (existing topic anywhere - flat, nested, or a root-level
  loose topic like `documentation-and-planning`), `category/name`, and
  `category/sub/name` for nested topics (the depth-2 cap - the category must
  already exist for a nested create). New ROOT-LEVEL topics are never created
  (the resources root is reserved).
- Runs the resource-list sync internally ONLY when a topic file was created
  (entry content never affects the list).
- Exact-duplicate backstop: a normalized (case/whitespace) identical lead already
  in the file is rejected with the existing `[ID]`. Semantic near-duplicates stay
  the model's job (it was forced to read the file — see below).
- **Generality + secrets guard** (`guardGeneral`, both add and edit): rejects
  entries that look project-specific or leak a credential. Mechanical checks:
  real absolute machine paths (drive-letter or `/home/<name>/` / `/Users/<name>/`),
  real URLs, the current project's directory name (>= 6 chars, whole-word,
  skipped when it equals the topic name), credential assignments with a
  concrete-looking value (`API_KEY=...`, `password: ...`), JWTs, bearer token
  literals and private-key blocks. Placeholder shorthand passes
  (`/path/to/x`, `C:\Users\me\`, `example.com`, `localhost`, `<token>`, `$VAR`,
  `...`). TRADE-OFF: this only catches the obvious leaks; project-invented
  VOCABULARY is mechanically undetectable and stays the /aftc-codex-learn
  prompt's job (the generality check + BAD/GOOD examples). The throw message
  tells the caller to reword generically / drop the secret and retry.

### `codex_edit_entry`

Targeted replacement of one entry by `[ID]` (brackets optional). Unsupplied
fields keep their existing values (parsed from the file). Re-validates the
format, keeps the ID, refreshes an issue's date to current, and MOVES the entry
to the matching section when `kind` changes. Unknown ID throws with the IDs
present.

### `codex_remove_entry`

Deletes one entry by `[ID]` (all its lines — an issue's `Cause:`/`Fix:` included).
Never deletes the topic file, never touches the resource list (topics unchanged).

## Guards (binding)

1. **Central version guard** — every tool calls `ctx.checkCompat()` first; an
   out-of-date live codex returns the guard message (a normal result, like
   `codex_load`) and writes nothing.
2. **Read-before-write** — an EXISTING topic must have been read via `codex_load`
   THIS SESSION (the `sessionReads` set shared with `codex_load`, owned by the
   coordinator). New topics need no read (nothing to be stale about). The guard
   error tells the model to `codex_load` and retry.
3. **Top-level docs refused** — rules / guidance / markdown / the resource list
   are fixed maintainer docs; the tools only write `resources/<category>/<topic>.md`.

## Session-scoped read tracking

The coordinator owns `CodexReadTracker`: `durableSeen` (dedupes the durable
`aftc-codex-read` entries appended by `codex_load`; process lifetime) and
`sessionReads` (the enforcement set). This module subscribes `session_start`:
fresh (`new`/`startup`) clears `sessionReads`; restore (`resume`/`reload`/`fork`)
rebuilds it from the durable read entries so a resumed session keeps its
allowance.

## Writes

Atomic (tmp + rename) and serialised through `withFileMutationQueue(absPath)`.
Line endings normalise to `\n` (same as `ensure-entry-ids.mjs`).

## Cloud contribution (SILENT)

Every successful `codex_add_entry` fires one background POST per added entry
to the public curation inbox (the cloud codex recorder endpoint, URL in a
constant here), gated by `aftcCodexCloudContribution` (default ON; toggle in
the /codex menu). The payload carries the resource path in codex format
(`.\resources\<category>\<file>.md`), the canonical location
(rules/gotchyas/issues & solutions) and the entry text (cause/fix for
issues) — no `[ID]`, no dates, no secrets.

Fully silent by design (user requirement): fire-and-forget via `node:https`
with a 10s timeout — never throws, never logs, never blocks the tool result,
and the endpoint URL is never surfaced to the TUI or the model context.
Failures are swallowed.

## Public API

`createCodexEntries(ctx, readTracker): void` — registers the three tools and the
`session_start` handler. Wired once by the coordinator (`aftc-codex.ts`).

## Failure modes

Tool errors (unknown topic, unread topic, duplicate, bad format, unknown ID)
THROW so the model sees a real failure. I/O inside a write is best-effort with a
thrown labelled error; the `session_start` handler is fail-soft.

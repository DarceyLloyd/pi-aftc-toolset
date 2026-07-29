# codex-learn.ts

Self-education loop (`/aftc-codex-learn`) (spec B).

## What it adds to the extension

### `/aftc-codex-learn` (spec B2)

Injects instructions (as a user message) telling the model to persist DURABLE,
GENERAL lessons into the codex using its standard tools (read/edit/write + bash to
run the sync script). No separate model tool. The prompt enforces:

1. **Sync first** — run `node "<scriptPath>"`.
2. **Check the resource list** before editing/creating — update the right doc, never
   duplicate an existing entry.
3. **Write the entries** — auto-add with uniqueness checks by default
   (`aftcCodexAutoAddEntries`), or propose-then-confirm when that pref is off (M-I8).
   Each lesson is classified into one of the THREE entry kinds and written under the
   matching section of the target file (every resource file always carries all three
   headings, in this order: `## Rules`, `## Gotchyas`, `## Issues & Solutions`):
   - **Rule** — a convention WE enforce; one line, no date:
     `- [ID] Never/Always X — one short reason.`
   - **Gotcha** — a trap built INTO the technology; ONE line with BOTH the trap AND
     the countermeasure; no date: `- [ID] LEAD — the trap; what to do / watch for.`
   - **Issue & Solution** — an OBSERVED failure with a diagnosis; the only dated kind:
     `[ID] LEAD_TOKEN — symptom` / `Cause:` / `Fix: (YYYY-MM)`
   The `[ID]` is a short token unique within the file (every kind). Routing: TECH
   lessons > the correct category doc under `resources/` only. The fixed top-level docs
   (`codex-rules.md`, `markdown-guidance.md`, `thought-and-action-guidance.md`) are never
   written by `-learn`.
4. **Sync after** writing.

The prompt also states the WRITE target explicitly — the given paths are the LIVE
per-user copy in the OS data dir; the package's `data/aftc-codex` seed is read-only
(prevents writing to the ship-time seed by mistake). Its closing line tells the model
to decide routing/format in one pass and commit (no agonising over borderline files or
style) and to report an empty bucket honestly rather than pad it — guardrails added
after a session whose learn loop burned most of its budget on meta-deliberation.

## Public API

`createCodexLearn(ctx)` returns `CodexLearnApi`:

- `buildLearnPrompt()` — the learn instruction prompt (absolute script + resource paths).
- `injectLearnPrompt(busy)` — send it as a user message (`deliverAs: "followUp"` when busy).

## Events subscribed

None.

## Files persisted

None.

## Failure modes

`injectLearnPrompt` is best-effort try/catch → no-op.

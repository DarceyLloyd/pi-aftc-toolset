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
   Uses the canonical entry format (`[ID] LEAD_TOKEN — symptom` / `Cause:` /
   `Fix: (YYYY-MM)`; the `[ID]` is a short token unique within the file), routing
   thinking lessons → `thought-and-action-guidance.md` and tech gotchas → the correct
   category doc.
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

## History

This module previously also owned the optional "thought harvest" (recording the
model's thinking to a private `thought-log/`, pref `aftcCodexThoughtLog`). It was
removed in v1.13.2 — the pref is no longer read or written; any existing
`thought-log/` dir in the data dir is left untouched (delete manually if wanted).

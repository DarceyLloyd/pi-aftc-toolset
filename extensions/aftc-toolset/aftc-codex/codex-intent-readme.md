# codex-intent.ts

Planning/documentation intent detection (plan.md D14) — the OPTIONAL heuristic
layer. When the user's message reads like planning or documentation work, the
model gets a one-line suggestion to `codex_load("documentation-and-planning")`
first. The robust base layer is the D5 directive wording in the marker and
codex-rules.md; this module only nudges.

## How it works

- Listens to the pi `input` event (user input, before agent processing).
- Light word-boundary heuristic: plan/plans/planning/roadmap/spec/document/
  documentation/documenting/readme/docx. Bare "docs" is deliberately excluded
  (too noisy).
- On a match it sends a one-line custom message (`aftc-codex-intent`, rendered
  accent in the transcript) telling the model to load the topic, then continue.

## Safety rails (locked)

- Suggestion only, never an unconditional auto-load.
- Once per session at most; never when the topic was already loaded this
  session (the read tracker's session set).
- Only while the codex feature is live (enabled + prepped, not rules-only).
- `source: "extension"` input is ignored (no self-trigger loops).
- Agent busy -> `deliverAs: "steer"` (pi throws without a deliverAs mid-stream).
- Fail-soft everywhere; never throws.

# resume-readme.md

Feature module: hand work off between context windows with a handoff file.

## What it does

Two slash commands built around `./aftc-resume.md` (project root, i.e. the
session cwd):

- `/aftc-resume-save` — stops the current work and has the model write
  `aftc-resume.md` (goal, current state, decisions, knowledge learned, key
  files, tasks & progress, next steps, open questions). An existing
  `aftc-resume.md` is FIRST renamed to `aftc-resume-<last-modified>.md` so
  snapshots accumulate — nothing is ever overwritten. The command waits for
  the model to settle, then merges an extension-owned `## Resume metadata`
  block (project, saved timestamp, codex state, status) and verifies the
  file.
- `/aftc-resume` — run after `/new`. Tells the model to read the handoff,
  load the codex resources it lists (only when codex is enabled), read its
  key files plus BOTH docx docs (`docx/project_documentation.md` and
  `docx/project_map.md` — each existence-checked, and every listed file
  MUST be read) and AGENTS.md, then continue.

The `/new` itself is the USER's job — the toolset never starts a session on
its own.

## Division of labour (single-writer rule)

- The MODEL writes the handoff body with its own file tools, driven by the
  save instruction. It is told NOT to write a `## Resume metadata` section.
- The EXTENSION owns the `## Resume metadata` block and merges it in AFTER
  the agent settles (`ctx.waitForIdle()`, capped at 120 s), so it never
  races the model's write. Facts the model gets wrong (dates, cwd, exact
  codex list) live in that block.

## Codex integration

- A `tool_call` observe-hook records every `codex_load` topic in a
  session-scoped set (cleared on every `session_start` — pi keeps modules
  alive across `/new`).
- The save prompt embeds the tracked list when `aftcCodexEnabled` is true
  and asks the model to list what it loaded (auto-detect pins never pass
  through `codex_load`, so the model's own list covers those).
- The resume prompt only mentions codex loads when `aftcCodexEnabled` is
  true at resume time. **The flow never depends on codex being on** — the
  mandatory `## Key Files` section is the fallback.

## Delivery

Idle agent → `pi.sendUserMessage(text)` (new turn now); busy agent →
`{ deliverAs: "followUp" }` (queued until the current turn finishes). The
save command then `await ctx.waitForIdle()` (120 s cap) so it can verify
what landed on disk; the resume command is fire-and-forget — the model
takes over.

## Failure modes

- Model never writes the file (aborted finalize): the extension writes a
  minimal metadata-only handoff and warns — the resume flow still has a
  file to find.
- Timed-out wait: warns and does NOT touch the file (the model may still be
  writing).
- Empty/looks-empty handoff (< 150 bytes): warns so the user checks before
  resuming.
- No handoff file on `/aftc-resume`: warns and lists any
  `aftc-resume-*.md` snapshots present.

## State & events

- Closure state: the session-scoped codex-load set.
- Events: `session_start` (reset the set), `tool_call` (observe-only,
  never blocks).
- No background resources, timers (the wait cap is unref'd), processes or
  cross-module imports (config.ts / help-registry.ts / ui/* are shared
  utilities).

## Testing

`tests/aftc-resume-check/` — unit tests for snapshot naming/collisions,
the metadata merge, the prompt builders, and the no-file / minimal-file
paths (pure functions, no pi needed). The end-to-end command flow needs a
live pi session (manual): run `/aftc-resume-save`, `/new`, then
`/aftc-resume` and confirm the model reads the file and continues.

## Notes

- `aftc-resume.md` and its snapshots are transient work state — ignore
  them wherever the project is published: `.gitignore` (GitHub),
  `.npmignore` (npm), `.dockerignore` (Docker images). This package's own
  repo ships these rules in all three files.
- Command names stay in the `/aftc-resume-*` family (never a bare
  `/resume` — that is a pi built-in for switching sessions).

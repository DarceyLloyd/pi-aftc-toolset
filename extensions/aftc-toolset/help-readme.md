# help.ts

`/aftc-help` — a scrollable list of every slash command and keyboard
shortcut this extension registers, rendered from the **help registry**
(see `help-registry-readme.md`).

## What it does

Renders an AFTC UI `showViewer` takeover grouped by category, in the
canonical order from `HELP_CATEGORY_ORDER`:

- Command sections (General, Response, Interrupt, Navigation,
  Footer / cache / timing, Usage report, SSH, Replay, Keep it short,
  aftc-codex, Thinking, Audio notification, Providers) — built live
  from `getHelpEntries()`. Empty categories are skipped (eg Providers
  while that module is disconnected).
- **Skills** — static (`/skill:*` entries are not pi commands).
- **Shortcuts** — static (keyboard shortcuts are not pi commands;
  includes pi's built-in Ctrl+T).

Each entry renders as an accent command line (`/name [args]`) with a
description line beneath; aliases are appended by the renderer as
`(alias /x, /y)`.

## Registry-driven, not static

Earlier versions kept a hard-coded table here that drifted from the
actual `pi.registerCommand` calls (eg `/aftc-footer-report-timeframe`
was missing). Now `help.ts` holds NO command data — every module feeds
`help-registry.ts` next to its pi registration, and
`tests/help-registry-check/` fails the suite if the two drift apart in
either direction. See `docs/help-registry.md` for the create/edit/delete
checklist.

## Headless fallback

In RPC / `-p` mode where `ctx.hasUI` is false, the help rows are
printed to stdout with a `[aftc-toolset]` prefix instead of opening
the viewer. Never `console.log` from the TUI path — it interleaves
with pi's redraws and corrupts the screen.

## Public factory

```typescript
export function createHelpModule(pi: ExtensionAPI): HelpModule
```

Returns the module instance (unused by callers — the orchestrator
keeps the reference for symmetry with other modules).

## Commands registered (2)

- `/aftc-help` — show this command and shortcut list.
- `/tools` — scrollable list of every tool pi can call (built-in +
  extensions, grouped by source, active state shown).

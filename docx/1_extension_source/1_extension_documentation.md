# 1 - Extension source (extensions/aftc-toolset)

<!-- last-reviewed: 2026-08-05 22:05 -->

## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [1_extension_map.md](./1_extension_map.md)

## Purpose

The single pi extension that powers pi-aftc-toolset. Owns ALL runtime
behaviour: every slash command, model tool, shortcut, overlay and event hook
the package contributes to pi. Does NOT own shipped assets (2), tests (3),
the root README, or the pi host APIs it builds on (peer dependencies
`@earendil-works/pi-coding-agent` / `pi-ai` / `pi-tui` / `typebox`, developed
against pi 0.83.0).

Everything here is TypeScript executed by pi's jiti loader — no build step,
no `dist/`. The entry is `extensions/aftc-toolset/index.ts` (a default-export
factory receiving the `ExtensionAPI`).

## Public API & contracts

The package manifest (`package.json` at the repo root, 2.4) points pi at
`./extensions`, `./skills`, `./themes`. pi loads
`extensions/aftc-toolset/index.ts` and calls the default export once.

The extension registers, in total:

- ~70 slash commands (full table in the [sitemap](./1_tui_sitemap.md) and per-feature docs).
- 25 model tools: 20 `ssh_*` (1.6.1), 4 `codex_*` (1.7.4), 1 `run_script` (1.5.12).
- 3 global shortcuts: `alt+c`, `alt+n`, `alt+x` (1.5.1).
- TUI surfaces: one persistent widget (the footer, 1.4.2), one widget intro
  (1.5.13), and a family of full-screen overlays built on the AFTC UI toolkit
  (1.3.2) — all inventoried in [1_tui_sitemap.md](./1_tui_sitemap.md).
- Event hooks across: `session_start`, `session_shutdown`, `session_compact`,
  `before_agent_start`, `agent_start`, `agent_end`, `agent_settled`,
  `message_start`, `message_update`, `message_end`, `context`, `input`,
  `tool_call`, `tool_result`, `model_select`, `thinking_level_select`,
  `after_provider_response`.

## Internal architecture & data flow

Orchestrator pattern (AGENTS.md): `index.ts` instantiates every feature
module; **feature modules never import each other**. Cross-module data flows
through the orchestrator via structural interfaces declared in `types.ts`
(`TurnRecorder`, `FooterDataProvider`, `AllowanceProvider`):

```
index.ts
 |- migrateLegacyData() (paths.ts) — before anything reads the data dir
 |- aftcConsole.init(pi) (ui/aftc-console.ts)
 |- createAllowance(pi) ─────────────┐
 |- createUsageRecording(pi) ────────┤ (TurnRecorder)
 |- createCore(pi, recorder, allowance) → FooterDataProvider
 |        └─→ createFooterWidget(pi, footerData)
 |- createUsageModule / createHelpModule / createInstallModule / createKeys
 |- text intro (intros/intro-text.ts) wired directly (factory disconnected)
 |- createTheme / createSshModule / createResponseDivider / createStfu
 |- createDir / createCwd / createReplay / createKeepItShort
 |- createThinkParser / createNotify / createQuickOpenDir / createDebugLog
 |- createDocx / createAftcCodex / createRunScript
 \- providers/ DISABLED (pi ships native providers since 0.81)
```

Shared utilities any module may import: `paths.ts`, `config.ts`, `db.ts`,
`help-registry.ts`, `ui/aftc-console.ts`, `ui/aftc-ui.ts`,
`ui/terminal-screen.ts` (leaf — pi-tui import only).

## Configuration

Two classes of state:

1. **Live per-user files** in the persistent OS data dir (1.2): `config.json`
   (preferences), `ssh.json` (saved SSH connections), `turns.db` (usage),
   `report.html`, `debug.log`, `aftc-codex/` (live knowledge base).
2. **Shipped seed/assets** under `extensions/aftc-toolset/data/` (2.1) —
   replaced on every `pi update`; flow is one-way seed → live.

## Setup, seeding & first run

Fresh install: `/aftc-install` (1.5.3) installs `better-sqlite3` (npm) and
the SSH carrier Python env (uv). `config.json` is created with defaults on
first preference access; the codex live copy seeds on first enable (1.7.1).

## Testing

Every suite lives under `tests/` (3). Module-specific checks are named
`tests/<area>-check/`. TUI visuals are user-verified, never automated.

## Operational notes & known limitations

- Modules survive `/new` (pi keeps them loaded) — that is WHY config/ssh
  files are read fresh from disk on every access (1.2, 1.6.3).
- No error event exists in pi: failures are detected via `message_end`
  `stopReason` and acted on at `agent_settled`.
- The whole factory is wrapped in try/catch; orchestrator errors go to
  `aftcConsole.logError` (stdout + `<dataDir>/debug.log`).

## Related

- [1.1_orchestration.md](./1.1_orchestration.md) — entry & module layout
- [1.2_core_infrastructure_documentation.md](./1.2_core_infrastructure_documentation.md) — plumbing
- [1_tui_sitemap.md](./1_tui_sitemap.md) — every reachable TUI surface
- Packaging (2), Tests (3)

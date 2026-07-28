# extensions/aftc-toolset/providers/

LLM provider features for the toolset. Each provider integration is a
self-contained module (same rules as the parent folder: one feature per
file, a sibling `<name>-readme.md`, no cross-feature imports — config.ts,
paths.ts and ui/aftc-ui.ts are shared utilities, not features).

| File | What it does |
| --- | --- |
| `index.ts` | Folder entry. Exports `createProviders(pi)`; the only symbol the main orchestrator imports. Wire new provider modules here. |
| `qwencloud.ts` | Alibaba Qwen Cloud (DashScope) + Qwen Coding Plan providers via pi's native `/login`, live model catalogs with cache/seed fallbacks, and the `/qwencloud` management command. See `qwencloud-readme.md`. |

## Layout principle

- `../index.ts` calls `createProviders(pi)` — nothing else reaches into
  this folder.
- Provider modules register through pi's documented provider API
  (`pi.registerProvider`) so login/credentials stay pi-owned
  (`~/.pi/agent/auth.json`). Extension code never reads or writes
  auth.json.

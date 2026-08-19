# Contributing

Workflow, code rules and release discipline for pi-aftc-toolset. Load this
when making any change to the extension or preparing a release.

<!-- last-reviewed: 2026-08-10 19:30 -->

## References

- Master: [project_documentation.md](./project_documentation.md)
- Full project map: [project_map.md](./project_map.md)
- Map: [project_map.md](./project_map.md)

## Overview

Solo-maintainer npm package developed on Windows. No CI;
releases are scripted locally (2.4). The authoritative rules live in
`AGENTS.md` at the repo root — this doc summarises the workflow.

## Prerequisites

- pi (`@earendil-works/pi-coding-agent`, developed against 0.83.0)
  installed globally; the extension loads via jiti — no build step.
- Node.js (npm), Python 3.10+ and `uv` for the SSH carrier; WinRAR only
  for `backup.ps1`.
- `/aftc-install` inside pi installs the runtime deps (1.5.3).

## Code rules (binding)

- One feature per file; feature modules never import each other — wire via
  `index.ts` + `types.ts` structural interfaces (1.1).
- Every `.ts` module keeps a sibling `<name>-readme.md` current.
- Config files (`config.json`, `ssh.json`) are read fresh from disk on
  EVERY access — never cache (1.2, 1.6.3); never overwrite user settings —
  add missing keys via write-back migration only; new features disabled by
  default.
- Subprocesses: lazy start, no shell, argument arrays, cross-platform
  names, idle self-exit watchdog, teardown on `session_shutdown`.
- Console output only through `ui/aftc-console.ts` (1.3.1).
- Tools: `promptSnippet` + explicit `promptGuidelines`; truncate output and
  say when truncated; file-mutating tools through `withFileMutationQueue`;
  throw from `execute()` to report errors; strip leading `@` from paths.
- Shortcuts live ONLY in `keys.ts` (1.5.1); help entries next to every
  command registration.
- Never use '§' in code/docs; never name enable flags "master"
  (`featureNameEnabled` convention).

## Change workflow

1. Functionality first.
2. Read the area's doc (Documentation Index in the master) and the
   aftc-codex resource `tools/pi-extension.md` before touching pi APIs.
3. Implement + update the module readme in the same change.
4. Hands-on Windows verification (no automated test suites — see AGENTS.md).
5. Docs: update the affected docx docs + stamps in the same change (see
   Maintaining This Documentation in the master).
6. Changelog entry under `Updates v<major>.<minor>.x` (newest first).

## Release (2.4)

Version read from `package.json`; patch/minor/major rules; ship = run
`ship-it.bat` (commit `vX.X.X` → push → `gh release create vX.X.X`, no
notes). "Ship it" phrases trigger the full flow without re-asking.

## Structure-map discipline

New module = map node + master section + Documentation Index entry +
ID-prefixed deep doc, one commit. New UI surface = leaf doc + sitemap
entry in the same commit. Renames keep IDs; deletions reserve them.

## Examples

```powershell
.\shipit.ps1                                       # full release
```

## Troubleshooting

- jiti load errors → check `PI_CODING_AGENT_PATH` points at a
  real global pi install.

## Related

- [development.md](development.md) · [deployment.md](deployment.md) · [dependency_map.md](dependency_map.md)

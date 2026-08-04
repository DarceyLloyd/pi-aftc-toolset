# 3 - Skills

skills/ — 34 Agent Skills packages shipped for pi's on-demand skill loading.

<!-- last-reviewed: 2026-08-04 20:37 -->

## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [project_map.md](../project_map.md)

## Purpose

**Owns:** one folder per skill with a `SKILL.md` (frontmatter name/description + body): languages (typescript, python, go, csharp, php, pinescript, ...), web (html, css, scss, react, vue, angular, web-frontend), runtimes (nodejs, bun, deno, javascript-mjs, javascript-transpiled), ops (docker, devops, nginx, linux, tmux, git, ffmpeg, bash, ps1, bat), and project skills (`aftc-codex`, `ssh`, `cache-audit`, `bulk-read`, `markdown`).
**Does not own:** the codex knowledge base (1.7 — skills are prompts, codex is curated rules).
**Depends on:** pi's skill loader (1.1). **Dependents:** the model (via `/skill:<name>` or auto-trigger).

## Public API & contracts

Loaded with `/skill:<name>`; pi also surfaces them via the description trigger. Relative paths inside a SKILL.md resolve against the skill directory (eg `bulk-read/scripts/`).

## Internal architecture & data flow

Skills are static markdown (plus the odd bundled helper script) — no runtime code in the extension. Shipped via the package `pi` manifest (`"skills": ["./skills"]`).

## Configuration

None.

## Setup, seeding & first run

Nothing.

## Testing

Manual (prompt content); the `bulk-read` helper has `tests/bulk-read-check`.

## Operational notes & known limitations

- Skill helper artifacts default to the OS temp dir, never the extension data dir.

## Related

- 1.7 aftc-codex (the `aftc-codex` skill teaches the codex workflow)

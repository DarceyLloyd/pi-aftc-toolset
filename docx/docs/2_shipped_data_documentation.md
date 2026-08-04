# 2 - Shipped Data

extensions/aftc-toolset/data/ — package-shipped defaults and static assets.

<!-- last-reviewed: 2026-08-04 20:37 -->

## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [project_map.md](../project_map.md)

## Purpose

**Owns:** `extension-config.json` (shipped-only keys; today `codexVersion`), `aftc-codex/` (the codex SEED), `aftc-audio-notifications/` (MP3s by category: question, task-complete, error, aborted, startup, context-window/25|50|75), `aftc-intro/audio/` (intro MP3).
**Does not own:** the live user copies (the OS data dir, 1.2).
**Depends on:** nothing. **Dependents:** 1.7 (seed), 1.5 (notify reads MP3s in place), 1.9.

## Public API & contracts

Feature-folder rule (binding): every feature's shipped files live in their own clearly-named subfolder; never mix two features' files. `data/<feature>/` holds assets COPIED to the live dir (the codex seed) or read-only runtime assets (MP3s). A shipped reference asset that is only ever READ IN PLACE may live in the feature's code folder instead (the docx guide, 1.8.3).

## Internal architecture & data flow

One-way flow seed → live, copy-only; the seed never auto-overwrites live files. Audio assets are read directly from `data/` at runtime (never copied). Dev tooling (`*.py`, `*.bat`) is excluded from the npm tarball via `.npmignore`; verify with `npm pack --dry-run` before release. The codex seed must never contain generated files (`codex-resource-list.md`).

## Configuration

`extension-config.json` is read fresh from disk on every access (never copied to the live side).

## Setup, seeding & first run

First codex enable seeds the live copy (1.7.2).

## Testing

`tests/npm-package-check` (packaging), `codex-compat-check` (shipped version reads).

## Operational notes & known limitations

- After changing codex seed content: live→seed sync happens via 1.7.9's release tool, and `codexVersion` must be bumped in the same release (1.7.7).

## Related

- 1.7 aftc-codex, 6 Package & Distribution

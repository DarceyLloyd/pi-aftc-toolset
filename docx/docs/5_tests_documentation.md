# 5 - Tests

tests/ — the whole verification surface. Never published (gitignored + npmignored; solo-maintained project).

<!-- last-reviewed: 2026-08-04 20:37 -->

## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [project_map.md](../project_map.md)

## Purpose

**Owns:** every test suite and fixture, plus `tests/readme.md` (the suite table + philosophy).
**Does not own:** runtime code.
**Depends on:** pi's bundled jiti (harness), Docker (5.2). **Dependents:** the release process (6).

## Public API & contracts

One folder per suite: `tests/<name>-check/<name>-check.mjs` (plus fixtures/helpers). Every script registers a global watchdog near the top: `setTimeout(() => process.exit(2), N).unref()` — 20s pure-mock, 30s module-load + jiti, 60s SSH/carrier smoke, 600–1500s Docker integration. Paths resolve from the script location, never `process.cwd()`.

## Internal architecture & data flow

Plain Node ESM, no framework, no network, no TUI for ordinary suites. Extension TypeScript loads through pi's bundled jiti (discovered from the global pi install; `PI_CODING_AGENT_PATH` overrides; `NODE_PATH` covers pi's nested node_modules). Pi APIs are exercised through mock `ExtensionAPI`/`ctx`; overlays are driven headlessly via `handleInput`. Test the feature being changed; full suite only when requested. Visual UI is verified by the user, never automated.

## Configuration

`AFTC_TOOLSET_DATA_ROOT` points suites at temp data dirs; `PI_LINUX_INTEGRATION_MODEL` picks the live-prompt model for the Linux gate.

## Setup, seeding & first run

`node tests/<suite>/<suite>.mjs` per suite.

## Testing

Self-referential by nature — suites are the tests.

## Operational notes & known limitations

- Tests may contain sensitive information; never publish the folder.

## Related

- 5.1 Local Test Suites, 5.2 Docker Test Fixtures

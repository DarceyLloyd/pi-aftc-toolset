# 3 - Tests (tests/)

<!-- last-reviewed: 2026-08-05 22:05 -->

## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [3_tests_map.md](./3_tests_map.md)

## Purpose

~50 test suites, one folder per check: `tests/<test-name>/<test-name>.mjs`
plus its own README and fixtures/helpers. Plain Node ESM scripts — NO test
framework, no network for ordinary tests, no TUI. Extension TypeScript is
loaded through the SAME jiti runtime pi uses, resolved from the global
`@earendil-works/pi-coding-agent` install (`PI_CODING_AGENT_PATH`
overrides). Pi APIs are exercised through mock `ExtensionAPI`/`ctx`
objects; overlay components are driven headlessly via `handleInput`.
Paths resolve from the script location, never `process.cwd()`.

## Non-negotiables (AGENTS.md)

- EVERY test registers a global watchdog timeout near the top:
  `setTimeout(() => process.exit(2), N).unref()`. Timeouts by type:
  pure-mock/no I/O 20 s · module-load+jiti 30 s · SSH/carrier smoke 60 s ·
  Docker integration 600 s (`ssh-replacement`) / 1500 s (Linux gates).
- Every script must self-terminate; nothing blocks on stdin indefinitely.
- Every test must VERIFY behaviour — coverage theatre is pruned, not kept.
- TUI visuals, live provider behaviour and pi's own rendering are verified
  MANUALLY by the user — some modules deliberately have no test folder.
- Always ask the user before running `tests/docx` — never unprompted.

## Running

```powershell
node tests/ssh-module-check/ssh-module-check.mjs
```

Order of work: functionality first → Windows tests → Linux container last
(verification cycle: copy package into the container → `/aftc-install` →
Linux tests; fixes happen on Windows first). Full suite only when
requested.

## Suite classes

Local node checks (3.2) · Docker SSH fixture suites (3.3) · Docker-Compose
Linux gates (3.4) · docx fixture projects (3.5). Full table in the
sub-docs; `tests/readme.md` is the maintainer-facing index.

## Related

- Sub-map: [3_tests_map.md](./3_tests_map.md) · Contributing/test workflow: [contributing.md](../contributing.md) · Dev environment incl. Docker tooling: [development.md](../development.md)

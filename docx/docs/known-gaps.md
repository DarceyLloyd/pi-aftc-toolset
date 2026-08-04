# Known Gaps

Unchecked pre-launch items from the 2026-08-04 /docx generation run, each with a fix plan.

<!-- last-reviewed: 2026-08-04 20:37 -->

## References

- Master: [project_documentation.md](../project_documentation.md)
- Full project map: [project_map.md](../project_map.md)
- Map: [project_map.md](../project_map.md)

## Overview

One checklist item was consciously deviated from; everything else passed (link-audit: PASS, 451 checks across 63 files).

## Gaps

### 1. AGENTS.md exceeds the 200-line guide limit (276 lines)

- **Why:** the root AGENTS.md is a long-standing hand-maintained file (critical global rules, feature docs table, process rules). The docx guide requires preserving it verbatim except the managed block, which conflicts with trimming it to 200 lines.
- **Fix plan:** none required for correctness — the 200-line rule targets generated minimal AGENTS.md files. If the maintainer ever wants compliance, split feature/process detail into `docx/docs/` deep docs and leave AGENTS.md as pointer + critical rules. Owner: maintainer decision.

## Related

- [project_documentation.md](../project_documentation.md) (master, checklist source)

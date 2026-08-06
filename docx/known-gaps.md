# Known gaps

Pre-launch checklist items that could not be checked, with fix plans.

<!-- last-reviewed: 2026-08-05 22:05 -->

## References

- Master: [project_documentation.md](./project_documentation.md)
- Full project map: [project_map.md](./project_map.md)
- Map: [project_map.md](./project_map.md)

## AGENTS.md exceeds the 200-line pointer guideline

**Unchecked item:** the guide asks for AGENTS.md to stay under 200 lines
(pointer, not master). This project's pre-existing AGENTS.md is 303 lines
of critical maintainer rules (edit-tool lessons, config binding rules,
release discipline, test timeouts, …).

**Why it stays:** section 10 of the documentation guide makes the existing
AGENTS.md SACRED — the generation run may only insert/replace the managed
AFTC-DOCX block and update stale documentation references; every other
character is preserved verbatim. Truncating would destroy binding project
rules.

**Fix plan (maintainer decision, not automated):** if the pointer size
matters, move the rule bodies that duplicate deep docs into their docs
(eg the feature-documentation table already points into `docx/`, the
task-processing and shipping sections duplicate `docx/contributing.md`
and `docx/2_packaging/2.4_release.md`) and keep AGENTS.md as pointer +
the genuinely binding global rules. This is an editorial task for the
maintainer, deliberately not performed by the documentation run.

## Related

- [contributing.md](contributing.md) · [2_packaging/2.4_release.md](2_packaging/2.4_release.md)

---
name: research-first
description: Look-before-build - search registries, the existing repo, existing skills, and the web for prior art before implementing. Appends a Prior Art section to the relevant doc. Use before implementing non-trivial features, integrations, or third-party deps.
---

# Research First

> **HARD GATE** - Do NOT implement until prior art is searched. Minimum outcome: adopt, extend, compose, or build - with evidence.

## Process

1. Read `the project scope file`, `the project release plan + epic shards`, and the current task statement.
3. Check opensrc cache - if the task integrates an external library, run `bash the project's helper scripts` (or `npx opensrc search <pkg>`) to find locally-cached source. Read the `src/` directory for API shapes before writing any integration code.
4. For each candidate: note name, URL/path, fit (adopt | extend | compose | build).
5. Append `## Prior Art` to `requirements/SCOPE_LATEST.yaml` notes or the active epic story.

## opensrc Integration

`opensrc` is a local cache of 200+ open-source repos and npm/PyPI packages. Query it before building any external integration to avoid re-inventing documented API shapes.

```bash
# Check if a package is cached
npx opensrc search <package-name>

# Or use the bundled helper (checks all deps from package.json or requirements.txt)
bash the project's helper scripts [package.json|requirements.txt]
```

If opensrc finds a match, read its `src/` or source directory and append findings to the Prior Art section:

```
opensrc: found <pkg> v<version> - exports <key classes/functions>
```

If opensrc is not installed or the package is not cached, fall through to web docs normally.

## Outcome matrix

- Verdict / Action
  - adopt - Use as-is; link in plan; no new code
  - extend - Wrap or configure existing solution
  - compose - Chain existing skills/modules
  - build - New implementation - justify why others failed

## Verify

→ verify: `grep -c "Prior Art" the project scope file the project release plan + epic shards 2>/dev/null | awk '{s+=$1} END {if(s>0) print "OK"; else print "MISSING"}'`

---
name: assess-impact
description: Analyze the blast radius of a proposed change before any code is written. Maps dependents, affected features/stories, and test coverage. Use before non-trivial changes, refactors, or anything touching public APIs.
---

# Assess Impact

Find the blast radius of the proposed change before a single line is written.

## Modes

- Default: full impact analysis (dependents + affected stories + test coverage mapping)

## Process

### 1. Identify the target

Name the symbol, module, or file being changed. If the user hasn't specified, ask one question: "What exactly are you changing?"

### 2. Find dependents

```
grep -rn "[symbol-name]" . --include="*.ts" | grep -v node_modules
git log --oneline -10 -- [file-path]
```

→ verify: `grep -rn "[target]" . | wc -l`

### 3. Map to release plan stories

Read `the project release plan + epic capsule directories` (if it exists). For each dependent found in Step 2, identify which story owns that module. List stories that will be affected by the change.

→ verify: `grep -c "Story" the project release plan + epic capsule directories 2>/dev/null || echo "no release plan"`

### 4. List test coverage

Find tests that exercise the target:

```
grep -rn "[symbol-name]" . --include=".test." --include=".spec."
```

→ verify: `grep -rn "[target]" . --include=".test." | wc -l`

### 5. Classify risk

- Level / Condition
  - Low - ≤ 2 callers, all covered by tests
  - Medium - 3–10 callers, partial test coverage
  - High - > 10 callers, or shared API/interface, or no tests

```
## Target
[symbol or file being changed]

## Dependents ([count])
- [file]: [caller or usage]

## Affected Stories
- Story [X.Y]: [title]

## Test Coverage
- [test file]: covers [scenario]
- Gap: [untested behavior]

## Risk: Low / Medium / High
[One-sentence rationale]

## Recommended action
[Proceed / Add tests first / Discuss design]
```

## Risk score gating

- Fan-in (how many callers): 0–4 points
- Fan-out (how many dependencies the module itself uses): 0–3 points  
- Recent churn (git log --oneline -5 count): 0–3 points

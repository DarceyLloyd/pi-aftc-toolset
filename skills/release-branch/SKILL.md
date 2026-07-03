---
name: release-branch
description: Make the merge/PR/keep/discard decision for a feature branch, verify coverage gates, create the PR with gh, and clean up the worktree. Use when a feature is complete and ready to ship, or when the user asks to merge or open a PR.
---

# Release Branch

> **HARD GATE** - Do NOT merge or release if tests fail or if coverage gates are not met. If the branch is red, return to `develop-tdd` to fix regressions or add missing tests before proceeding.

Finalize a completed feature branch: verify coverage gates, integrate onto `main`, and clean up the worktree.

## Additional modes

- `--hotfix`: Emergency fix. Cherry-pick to main plus immediate tag. Skip PR in solo profile.
- `--squash-state`: Squashes all intermediate `chore(state):` commits on the feature branch into a single clean commit before merging. Use this to reduce noise in the main git repository history.

## Integrate mode

Read `the project state file` key `workflow_mode` first (`team-pr` | `solo-git`). Fall back to sniffing `profiles/solo-git.md` only when the key is absent.

- Mode / When / Ship path
  - solo-local - `workflow_mode: solo-git` (or `profiles/solo-git.md` present as fallback) / Auto-detect: if `the project's land-branch script` exists → use it; else → fallback (see Step 5)
  - team-pr - `workflow_mode: team-pr` (default) / `gh pr create` → `gh pr merge --squash`

If unsure and working alone, prefer solo-local.

> Auto-detect note: The solo-local path first checks if `the project's land-branch script` exists and is executable. If present, the script handles the full squash-merge workflow. If absent, the built-in fallback sequence runs instead.

## Process

### 1. Final verification

```bash
<full test command> && <typecheck command> && <lint command>
git log main...HEAD --oneline | grep -vE "^[a-f0-9]+ (feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?: .+$" && echo "❌ Non-conventional commits found" || echo "✅ Commits verified"
```

- [ ] All tests pass, no type errors, no lint violations, all commits follow Conventional Commits

### 2. Coverage check

- [ ] Overall coverage ≥ 80%; business logic coverage ≥ 95%

### 2a. Security gate

- [ ] No unresolved HIGH findings with confidence ≥ 8 (or all documented in `the project security exceptions file` with sign-off rationale)

### 3. Diff review

- [ ] All commits intentional, no secrets, CONVENTIONS.md compliance

### 4. Decision

Options: Release (solo-local) / Open PR / Keep branch / Discard

### 5. Solo-local integrate

Run `commit-message` to produce the squash commit subject. Then auto-detect the integration path:

Path A - `the project's land-branch script` exists (happy path):
```bash
bash the project's land-branch script <task-slug> "feat(scope): description"
```

Path B - `the project's land-branch script` missing (fallback):

Report which path was taken. Print exactly:
- `"used land-branch.sh"` if Path A
- `"used fallback merge (land-branch.sh not found)"` if Path B

### 6. Create PR (team-pr only)

### 7. Merge (team-pr only)

```bash
gh pr merge --squash --delete-branch
```

`semantic-release` auto-detects the commit, bumps SemVer, tags the repo, generates release notes.

### 7a. Archive completed epic capsule

```bash
```

### 7b. CI verification (solo-local and team-pr)

> **HARD GATE** - Do NOT declare success until CI completes. A push that fails CI is a regression, not a release.

After push (solo-local step 5 or team-pr step 7), run the CI polling script:

```bash
bash scripts/wait-for-ci.sh --timeout 600 --interval 30
```

The script auto-discovers workflow runs for the pushed commit and polls until completion.

- [ ] CI workflow passes after push (wait-for-ci.sh exit 0)
- [ ] `release.ci_verified: true` documented in state.yaml
- On failure: `handoff.next_skill = fix-bug` with the CI failure URL

### 8. Clean up worktree

```bash
git worktree prune
git worktree remove ../<branch-name> 2>/dev/null || true
git branch -d <branch-name>
```

### 8a. Cycle-time recording

After landing, record delivery metrics with the git-derived, additive script:

```bash
bash scripts/record-cycle-time.sh append \
  --story <story_id> --bcps <bcps> \
  --range "$(git merge-base main HEAD)..HEAD" \
```

This replaces the previous hand-arithmetic approach (story_end minus story_start).

### 9. Return to main

```bash
git checkout main && git status && pwd
```

Report: "Branch released. Integrate mode: <solo-local|team-pr>. cwd: $(pwd) on $(git branch --show-current)."

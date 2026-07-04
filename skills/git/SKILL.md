---
name: git
description: Git + GitHub CLI workflow for solo projects. Conventional Commits, branch naming, destructive-command safety rails, and the merge/PR/keep/discard decision. Use when committing, branching, merging, rebasing, pushing, opening a PR, running git status/log/diff, or using the gh CLI for issues/PRs/CI runs.
---

# Git

## Commit messages — Conventional Commits

`<type>(<scope>): <summary>`

- `type` required: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `perf`, `build`, `ci`, `style`, `revert`.
- `scope` optional short noun: `api`, `ui`, `footer`, etc.
- `summary` required: imperative, ≤72 chars, no trailing period, lowercase first word.
- Mark breaking changes with `!` after type/scope (`feat(api)!: ...`) or a `BREAKING CHANGE:` footer.
- Optional body after a blank line — explain the **why**, not the what.

Examples: `feat(api): add user auth middleware`, `fix(footer): correct cost calc`, `docs: document /cd picker`, `chore(deps): bump better-sqlite3`.

## Commit workflow

1. `git status` + `git diff` to see real changes.
2. Split unrelated diffs into separate commits (one per logical change).
3. Stage only intended files — never `git add .` blind.
4. `git commit -m "<subject>"` (add `-m "<body>"` if needed).
5. No `Signed-off-by` trailers. Do not push automatically — user pushes when ready.

## Branch naming

`feature/<slug>`, `fix/<slug>`, `chore/<slug>`.

## Safety rails (destructive commands)

Before running, treat these as gated — confirm or avoid:

- Blocked: `git push --force` / `--force-with-lease` to `main`/`master`, `git reset --hard`, `git clean -f`, `git branch -D`, `git checkout .`, `git restore .`.
- Never force-push to `main`/`master`. Use `--force-with-lease` on feature branches only.
- Never commit secrets, API keys, or `.env`. If staged by accident, rewrite history before pushing.
- Always review `git diff --staged` before committing. Pull with `--rebase` before pushing to avoid conflicts.

## GitHub CLI (`gh`)

Always pass `--repo owner/repo` when not inside a git repo, or use URLs directly.

```bash
gh pr checks 55 --repo owner/repo                      # CI status on a PR
gh pr list --state open --json number,title --jq '.[] | "\(.number): \(.title)"'
gh pr create --fill                                     # open a PR
gh pr merge --squash --delete-branch                    # merge + cleanup
gh run list --repo owner/repo --limit 10                # recent CI runs
gh run view <run-id> --repo owner/repo --log-failed     # failed step logs
gh issue list --repo owner/repo --json number,title
gh api repos/owner/repo/pulls/55 --jq '.title, .state'  # raw REST queries
```

## Ship decision (feature branch done)

Run final verification, then pick one path:

1. **Verify:** full test command + typecheck + lint all pass; all commits are Conventional Commits; no secrets in diff.
2. **Decide:**
   - **Release (solo):** rebase onto `main`, fast-forward merge, push. Tag if releasing.
   - **Open PR (team):** `gh pr create --fill`, then `gh pr merge --squash --delete-branch` once approved and CI is green.
   - **Keep:** leave the branch for later.
   - **Discard:** `git branch -D` only after confirming work is unneeded.
3. **Cleanup:** `git worktree prune`; remove the worktree and delete the local branch.
4. **Return:** `git checkout main && git status`.

Do not declare success until CI completes — a red push is a regression, not a release.

---
name: git-workflow
description: Git operations, commit messages (Conventional Commits), branching strategies, and PR workflows. Use when committing, branching, merging, rebasing, running git status/log/diff, or working with remote repositories.
---

# Git Workflow

## Commit message format (Conventional Commits)

`<type>(<scope>): <summary>`

- `type` REQUIRED. Common values:
  - `feat` - new user-visible feature
  - `fix` - bug fix
  - `docs` - documentation only
  - `refactor` - code change that neither fixes a bug nor adds a feature
  - `chore` - tooling, build, deps, no production code change
  - `test` - adding or fixing tests
  - `perf` - performance improvement
- `scope` OPTIONAL. Short noun in parentheses for the affected area (e.g. `api`, `parser`, `ui`).
- `summary` REQUIRED. Short, imperative, 72 chars or fewer, no trailing period, lowercase first word.

Body is OPTIONAL. Add a blank line after the subject, then short paragraphs explaining the **why** (not the what). Mark breaking changes with `!` after the type/scope (`feat(api)!: ...`) or a `BREAKING CHANGE:` footer.

### Examples

- `feat(api): add user auth middleware`
- `fix(footer): correct cost-per-minute calc when session has no model`
- `docs: document /cd picker keyboard shortcuts`
- `refactor(core): split prefix tracker into its own module`
- `chore(deps): bump better-sqlite3 to 12.11.1`

## Commit workflow

1. Run `git status` and `git diff` to see what's actually changing.
2. (Optional) Run `git log -n 50 --pretty=format:%s` to see recently used scopes and types.
3. If files in the diff are unrelated, split into separate commits (one per logical change).
4. Stage only the intended files. Never `git add .` without reviewing.
5. Run `git commit -m "<subject>"` (add `-m "<body>"` if needed).
6. Do NOT include `Signed-off-by` or other trailers.
7. Do NOT push automatically. The user pushes when ready.

## Branch naming

- `feature/<short-slug>` - new user-visible features
- `fix/<short-slug>` - bug fixes
- `chore/<short-slug>` - tooling, deps, refactors

Examples: `feature/cd-picker`, `fix/footer-truncation`, `chore/bump-sqlite`.

## Safety rules

- Use `.gitignore` for generated files and secrets.
- Never commit secrets, API keys, or `.env` files. If accidentally staged, rewrite history before pushing (`git filter-repo` or equivalent).
- Review diffs before committing (`git diff --staged`).
- Pull before pushing to avoid conflicts (`git pull --rebase`).
- Squash fixup commits before merging.
- Never force-push to `main` / `master`.

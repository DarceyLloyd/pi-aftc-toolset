# Git

## Rules

## Gotchyas

## Issues & Solutions

- [kC9nD2] git clean -fd (force-sync) - an untracked backup dir left inside the repo is silently deleted (observed: 18 GB backup wiped during a scripted `git reset --hard` + `git clean -fd` deploy)
  Cause: `git clean -fd` removes every untracked file/dir not matched by its `-e` excludes, and exclude patterns match exactly - `-e www/` protects only `www/`, not a sibling named `www.bak-pre-pull`. Without `-x` it KEEPS gitignored files (logs, `.old/`, `vendor/`), so the deletion looks deceptively partial.
  Fix: never stage backups/snapshots inside the repo around a clean or force-sync - move them outside the repo tree first (eg `/root/<name>`). Dry-run before any destructive clean: `git clean -nd` prints exactly what will be deleted; scripts wrapping `git clean -fd` should log that dry-run list immediately before the real clean. (2026-07)

- [cfcELV] Permission denied after a fresh Linux checkout/clone - the .sh was committed from Windows, which cannot record the Unix exec bit in git (file lands as mode 100644)
  Cause: Windows git runs with core.fileMode=false and cannot set the Unix executable bit from the filesystem, so .sh files committed on Windows are recorded as mode 100644; git only learns the exec bit via `git update-index --chmod=+x` or a commit made on Linux/macOS. Fresh clones/checkouts on Linux are then non-executable, and any script that invokes another script directly ("${DIR}/helper.sh") dies with Permission denied - with no hint that the exec bit, not the script content, is the problem.
  Fix: Audit with `git ls-files -s '*.sh' | awk '$1==100644 {print $4}'`, then `git update-index --chmod=+x <file>` per file and commit the mode-only change; verify on the Linux side with `ls -l`. Where a caller must tolerate a missing exec bit, invoke helpers via `bash helper.sh` instead of executing them directly. (2026-08)

- [eHwqUI] git add -A fails with 'unable to index file nul' / 'failed to insert into database' and nothing gets staged
  Cause: a file literally named `nul` exists in the working tree - created by a `>nul` redirect run under git-bash (MSYS), where `nul` is an ordinary filename, not the Windows null device; git refuses to index the reserved device name, the whole add aborts, and a script that ignores git add's exit code then commits nothing and half-ships.
  Fix: delete it (`rm -f ./nul` from git-bash) and run `git add -A` again; never use `>nul` outside cmd/PowerShell - redirect to `/dev/null` in bash - and make any ship script fail fast when `git add` returns non-zero. (2026-08)

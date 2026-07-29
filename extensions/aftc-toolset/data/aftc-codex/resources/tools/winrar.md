# WinRAR (Rar.exe CLI)

## Rules

## Gotchyas

## Issues & Solutions


- [0SAiuK] Backup script reports FAIL even though the archive was created fine
  Cause: Rar.exe exit code 1 means WARNING (eg a locked/unreadable file like mysql.sock: "The file cannot be accessed by the system"), not failure; only codes >1 are fatal.
  Fix: treat `-gt 1` as failure in scripts, and exclude unreadable runtime files with `-x*\mysql.sock` style patterns. (2026-07)

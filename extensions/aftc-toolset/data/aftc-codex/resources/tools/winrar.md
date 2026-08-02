# WinRAR (Rar.exe CLI)

## Rules

## Gotchyas

- [xR4wQ9] Rar.exe `-x` pattern WITHOUT a path separator matches folders of that name at ANY depth - `-xbuild` silently excludes `src\build` too (build scripts lost from the archive); anchor rooted exclusions with a separator (`-xbuild\*` excludes only the root build\ contents) and verify with `rar l archive.rar` that same-named deeper folders survived.

## Issues & Solutions


- [0SAiuK] Backup script reports FAIL even though the archive was created fine
  Cause: Rar.exe exit code 1 means WARNING (eg a locked/unreadable file like mysql.sock: "The file cannot be accessed by the system"), not failure; only codes >1 are fatal.
  Fix: treat `-gt 1` as failure in scripts, and exclude unreadable runtime files with `-x*\mysql.sock` style patterns. (2026-07)
- [rX6bN2] Rar.exe exit code 6 (file open error, many `Cannot open ... being used by another process`) when archiving a project whose Docker stack is running
  Cause: live containers hold host files locked so Windows processes cannot open them (mysqld locks `mysql_data\*.ibd` / `binlog.*`, Apache locks `logs\error.log`); Rar returns 6 (open error), NOT the benign 1 warning, and the archive is incomplete.
  Fix: treat 6 as genuinely fatal for a complete backup - stop the stack (`down.bat`) before archiving, then restart it after; keep the `> 1 = fail` threshold so warning-only runs (code 1) still pass (see [0SAiuK]). (2026-07)

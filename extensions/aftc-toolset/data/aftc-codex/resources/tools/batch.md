# Windows Batch (cmd / .bat)

## Rules

## Gotchyas

- [9XLNZC] Parsing a KEY=value line from a .env file with set /p + for /f keeps surrounding spaces ("KEY = value" yields " value" and a broken auth header downstream) - strip ALL spaces from the extracted value with %VAR: =% (keys/tokens never contain spaces).

## Issues & Solutions


- [uJ4kL0] `for /r <dir> %%F in (literalname.exe)` runs a path that does not exist (`'...\literalname.exe' is not recognized as an internal or external command`)
  Cause: with a *literal* file name (no wildcard) `for /r` does NOT test existence - it synthesizes `<dir>\literalname.exe` for every directory and tries to run it, so a missing file produces a bogus path instead of being skipped.
  Fix: to locate a built binary by name use `where /r <dir> name.exe` (returns only real matches), or give `for /r` a wildcard (`for /r <dir> %%F in (*.exe) do ...`) and filter. Capture the first hit with `for /f "delims=" %%F in ('where /r <dir> name.exe 2^>nul') do if not defined VAR set "VAR=%%F"`. (2026-07)

- [W8Pzla] Running a .bat from git-bash/MSYS fails weirdly at a bare `find` call (`find: '=': No such file or directory`) and downstream checks silently misfire
  Cause: the shell environment prepends its own bin dir to PATH, so `find` inside cmd resolves to Unix find instead of Windows find.exe, breaking batch `find`-based conditionals without a clear error
  Fix: run the .bat via powershell/cmd with a clean system PATH (rebuild Path from the Machine+User environment variables), or call `%SystemRoot%\System32\find.exe` fully qualified inside the batch (2026-08)

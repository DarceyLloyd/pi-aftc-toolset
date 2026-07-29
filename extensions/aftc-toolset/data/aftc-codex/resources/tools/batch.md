# Windows Batch (cmd / .bat)

## Rules

## Gotchyas

## Issues & Solutions


- [uJ4kL0] `for /r <dir> %%F in (literalname.exe)` runs a path that does not exist (`'...\literalname.exe' is not recognized as an internal or external command`)
  Cause: with a *literal* file name (no wildcard) `for /r` does NOT test existence - it synthesizes `<dir>\literalname.exe` for every directory and tries to run it, so a missing file produces a bogus path instead of being skipped.
  Fix: to locate a built binary by name use `where /r <dir> name.exe` (returns only real matches), or give `for /r` a wildcard (`for /r <dir> %%F in (*.exe) do ...`) and filter. Capture the first hit with `for /f "delims=" %%F in ('where /r <dir> name.exe 2^>nul') do if not defined VAR set "VAR=%%F"`. (2026-07)

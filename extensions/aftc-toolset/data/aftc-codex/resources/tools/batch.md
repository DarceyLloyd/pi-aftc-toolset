# Windows Batch (cmd / .bat)

## Rules

- [ejQcrN] A ship/release script should refuse to re-ship: before git add/commit/push, check whether the target release/tag already exists on the remote (eg gh release view vX) and if so warn and exit non-zero - an already-shipped version must not produce another commit.

- [bVmabj] A launcher .bat for a dev server/Gradio app should: run the child (powershell/python) attached to the SAME console (no `start`), so closing the window or Ctrl+C kills the whole process tree with no strays; and end with a `pause` after the child exits so a fast failure leaves the error visible instead of the window vanishing

## Gotchyas

- [9XLNZC] Parsing a KEY=value line from a .env file with set /p + for /f keeps surrounding spaces ("KEY = value" yields " value" and a broken auth header downstream) - strip ALL spaces from the extracted value with %VAR: =% (keys/tokens never contain spaces).

- [nT2LMy] Parentheses inside echo text within an if/else block break cmd's parser ('not was unexpected at this time') - keep parens out of echo lines that live inside parenthesized blocks, or restructure with labels/goto.

- [b6k8nu] for /f over a command containing quoted arguments mangles the command - use the usebackq backtick form: for /f "usebackq delims=" %%v in (`tool -p "literal 'quotes' inside"`) do ...; without usebackq the nested quotes and parens are mis-parsed.

- [m3TDJr] Invoking `cmd /c script.bat` from git-bash can open an interactive cmd prompt instead of running the script - the batch never executes; run it via PowerShell instead (cmd /c from pwsh) or with the full quoted path.

- [6egBkS] A && (block) || (block) in cmd runs the else-branch when the && block's LAST command fails, not only when A fails - end the && block with a guaranteed-success command (echo) or branch with explicit `if errorlevel` checks.

- [woIQEF] Batch files saved with LF-only line endings (the default for many editors and file-writing tools) mis-parse or fail oddly under cmd - always convert .bat/.cmd to CRLF after writing (eg `sed -i 's/$/\r/' file.bat`) and verify before assuming a syntax bug in the script itself

## Issues & Solutions


- [uJ4kL0] `for /r <dir> %%F in (literalname.exe)` runs a path that does not exist (`'...\literalname.exe' is not recognized as an internal or external command`)
  Cause: with a *literal* file name (no wildcard) `for /r` does NOT test existence - it synthesizes `<dir>\literalname.exe` for every directory and tries to run it, so a missing file produces a bogus path instead of being skipped.
  Fix: to locate a built binary by name use `where /r <dir> name.exe` (returns only real matches), or give `for /r` a wildcard (`for /r <dir> %%F in (*.exe) do ...`) and filter. Capture the first hit with `for /f "delims=" %%F in ('where /r <dir> name.exe 2^>nul') do if not defined VAR set "VAR=%%F"`. (2026-07)

- [W8Pzla] Running a .bat from git-bash/MSYS fails weirdly at a bare `find` call (`find: '=': No such file or directory`) and downstream checks silently misfire
  Cause: the shell environment prepends its own bin dir to PATH, so `find` inside cmd resolves to Unix find instead of Windows find.exe, breaking batch `find`-based conditionals without a clear error
  Fix: run the .bat via powershell/cmd with a clean system PATH (rebuild Path from the Machine+User environment variables), or call `%SystemRoot%\System32\find.exe` fully qualified inside the batch (2026-08)

- [3l1KWI] A UTF-8 .bat/.cmd containing non-ASCII characters (em-dashes, bullets) prints mojibake like 'OCo' or 'ÔÇö' under cmd
  Cause: cmd parses and echoes the batch file through the OEM codepage, so UTF-8 multibyte characters are mis-decoded (the same bytes also render wrong when Node stdout is piped into a type)
  Fix: keep batch files and everything they print pure ASCII; for colored output embed a literal ESC byte (0x1B) in a set line and use ANSI codes (ESC[92m etc., Windows Terminal / Win10+ console) - inject the ESC byte programmatically, never by hand (2026-08)

- [HgrxNA] Double-clicked .bat dies instantly with `\ was unexpected at this time` (or similar `X was unexpected`) when the script's directory path contains parentheses
  Cause: %VAR% expands at PARSE time, so a variable holding a path like `...\app (fixed)\` inside an if/for (...) block injects a literal `)` that closes the block early and breaks cmd's parser
  Fix: use `setlocal enabledelayedexpansion` and reference the variable as !VAR! everywhere - delayed expansion happens after parsing, so parentheses in the VALUE are harmless; also move path-bearing echoes out of blocks or use goto labels (2026-08)

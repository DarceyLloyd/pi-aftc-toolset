# PowerShell

## Rules

## Gotchyas

## Issues & Solutions


- `[Yan4fM] The '<' operator is reserved for future use`
  Cause: PowerShell has no stdin file/string redirect (`python x.py < $null` is a parse error).
  Fix: pipe instead: `echo "" | python x.py`, or use `cmd /c "python x.py < nul"`. (2026-07)
- `[tjbvrn] docker exec ... mysql -e "..."` one-liners get mangled by PowerShell quoting
  Cause: `$VAR` expansion, backtick escapes, and nested quotes break differently in PowerShell than in bash.
  Fix: write the SQL to a file, `docker cp` it in, then `docker exec <c> bash -c 'mysql --default-character-set=utf8mb4 -uroot -p"$MYSQL_ROOT_PASSWORD" db < /tmp/x.sql'`; or run the whole thing from a bash shell instead of PowerShell. (2026-07)
- `[vM9nP7] Add-Type`-compiled types (and in-process variables / `$env:` set inside the call) are gone in the next PowerShell tool invocation (`Unable to find type [Foo]`)
  Cause: each shell/PowerShell tool call runs in a FRESH process, so a C# type compiled with `Add-Type` (or a variable assigned) in call N does not exist in call N+1. A multi-step capture that defines a P/Invoke type in one call and uses it in the next fails.
  Fix: make the script self-contained - put the `Add-Type`/type definition AND the code that uses it in a SINGLE call. (Same applies to bash: in-process state does not persist between separate tool calls.) (2026-07)
- `[qW2eR5] docker run ... bash -c "...$(cmd)..."` runs `cmd` on the WINDOWS host, not in the container (`head: not recognized`, empty values)
  Cause: in PowerShell a double-quoted string expands `$(...)` locally before the argument is passed to docker.exe, so the command substitution runs on the host (and host-only tools like `head` error).
  Fix: don't put `$(...)`/`$var` you mean for the container inside a PowerShell double-quoted `bash -c` string. Either single-quote the whole `-c` argument in PowerShell (`bash -c '...'`, so PS passes it literally), or run the commands from a script file executed in the container. Plain commands without `$()` (e.g. `test -f /x && echo OK`) are fine either way. (2026-07)
- `[mL3qW7] curl.exe --data @file.json` throws `The splatting operator '@' cannot be used to reference variables in an expression. '@file' can be used only as an argument to a command. '@login' can be used only as an argument...`
  Cause: `@` is PowerShell's SPLATTING operator, so an unquoted `@file.json` (the curl `--data @file` = "read body from file" syntax) is parsed as a splat expression, not passed verbatim to curl.exe.
  Fix: quote it so PowerShell treats it as a literal argument: `curl.exe --data "@file.json"` (or `--data-binary`). Better still, skip curl in PowerShell and use `Invoke-RestMethod`/`Invoke-WebRequest -Body` which handle JSON and auth headers natively and avoid the whole shell-quoting minefield. (2026-07)
- [eD4sA8] `Missing closing '}' in statement block` / `The string is missing the terminator: "` parse errors on a .ps1 that looks perfectly fine in the editor
  Cause: the file is BOM-less UTF-8 containing a non-ASCII char (em-dash, smart quote); Windows PowerShell 5.1 (powershell.exe) decodes BOM-less .ps1 as ANSI/cp1252, where the em-dash's 0x94 byte becomes a literal `"` - inside a string it terminates the string early and cascades into bogus brace/terminator parse errors. pwsh 7 (UTF-8 default) runs the same file without complaint, so the bug is runtime-dependent.
  Fix: keep .ps1 files pure ASCII (replace em-dashes / smart quotes with `-` / `'`), or save as UTF-8 WITH BOM so 5.1 decodes correctly. (2026-07)
- `[kP7dW2] Push-Location` on a mapped-drive path fails `Cannot find path ... because it does not exist` in a spawned pwsh session while git-bash sees and reads the same drive fine
  Cause: the drive letter (subst / net use / third-party mount) is not visible in the spawned session's logon or elevation context - drive mappings are per-logon - even though the process inherited a CWD on that drive and can read files there via RELATIVE paths. Any call that re-resolves the drive-qualified path (Push-Location, some Get-ChildItem cases) then fails.
  Fix: write scripts to work purely from relative paths - use `(Get-Location).Path`, `.\` paths and `*` globs, and never `Push-Location` to a mapped-drive path. Relative-path scripts run fine in these half-visible sessions. (2026-07)

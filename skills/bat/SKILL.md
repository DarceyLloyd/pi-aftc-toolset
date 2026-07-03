---
name: bat
description: Windows Batch (.bat / .cmd) scripting, errorlevel handling, and CMD automation. Use when writing or editing Windows batch files, .bat or .cmd scripts, or CMD automation tasks.
---

# Bat

## Script Structure
- Start with `@echo off` to suppress command echoing
- Use `setlocal enabledelayedexpansion` for variable manipulation in loops
- End scripts with `exit /b %errorlevel%` or `exit /b 0`
- Use `REM` or `::` for comments (prefer `REM` for compatibility)

## Error Handling
- Check `%errorlevel%` after every command that can fail
- Use `if %errorlevel% neq 0` to detect failures
- Use `||` for simple error handling: `command || (echo FAILED & exit /b 1)`
- Use `&&` for success chaining: `command && echo OK`
- Never use `exit` without `/b` - it closes the CMD window

## Variable Best Practices
- Use `set "VAR=value"` with quotes to avoid trailing spaces
- Access variables with `%VAR%` (normal) or `!VAR!` (delayed expansion)
- Use `enabledelayedexpansion` for variables that change inside loops
- For arithmetic: `set /a "result=%a%+%b%"`
- Environment variables: `%USERPROFILE%`, `%TEMP%`, `%PATH%`, `%COMPUTERNAME%`

## File Operations
- Check existence: `if exist "file.txt" (echo yes) else (echo no)`
- Check nonexistence: `if not exist "file.txt" (echo missing)`
- Copy: `copy /Y "source" "dest"`
- Move: `move /Y "source" "dest"`
- Delete: `del /F /Q "file.txt"`
- Create directory: `if not exist "dir\" mkdir "dir"`
- Iterate files: `for %%f in (*.txt) do echo %%f`
- Recursive: `for /r %%f in (*) do echo %%f`

## String Manipulation
- Substring: `%VAR:~0,5%` (first 5 chars)
- Replace: `%VAR:old=new%`
- Trim quotes: `%~1` (removes surrounding quotes)
- File path parts: `%~dp0` (drive+path), `%~n0` (name), `%~x0` (extension)
- Length check: `if "%VAR%"=="" echo empty`

## Input/Output
- User input: `set /p "NAME=Enter name: "`
- Redirect output: `>file.txt` (overwrite), `>>file.txt` (append)
- Redirect errors: `2>error.txt`
- Combine: `>log.txt 2>&1`
- Suppress output: `>nul 2>&1`
- Pipe: `command1 | command2`
- Find in output: `command | findstr "pattern"`
- Count lines: `find /c /v "" file.txt`

## Common Patterns

### Argument Processing
```batch
if "%~1"=="" (echo Usage: %~n0 ^<arg^> & exit /b 1)
if /i "%~1"=="--help" (echo Help text & exit /b 0)
```

### Loop with Counter
```batch
set /a count=0
for %%f in (*.txt) do (
    set /a count+=1
    echo !count!: %%f
)
```

### Function (Label)
```batch
call :myfunction arg1 arg2
goto :eof

:myfunction
echo Arg1: %~1  Arg2: %~2
exit /b 0
```

### Menu System
```batch
:menu
echo 1. Option One
echo 2. Option Two
echo 3. Exit
set /p "choice=Choose: "
if "%choice%"=="1" goto :option1
if "%choice%"=="2" goto :option2
if "%choice%"=="3" exit /b 0
goto :menu
```

## Safety Rules
- Always quote file paths: `"C:\Program Files\app.exe"`
- Use `pushd`/`popd` for directory changes
- Check file existence before delete/copy
- Escape special chars with `^`: `^<`, `^>`, `^|`, `^&`, `^^`
- Test with `echo` before destructive operations
- Use `if exist` guards before file operations

## Smoke Test Pattern
```batch
@echo off
echo === Smoke Test ===
call script.bat arg1 arg2
if %errorlevel% neq 0 (echo FAILED & exit /b 1)
echo PASSED
exit /b 0
```

## Integration with AFTC
- Scripts go in their own template directories under `templates/bat/`
- Each template has README.md, .bat script, smoke-test.bat
- No cross-platform wrappers needed (.bat is Windows-native)
- The AFTC extension deploys templates when users request batch file tasks

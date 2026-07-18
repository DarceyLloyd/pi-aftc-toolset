@echo off
REM install.bat — bootstrap aftc_ssh_carrier via UV (Windows)
REM
REM Creates .venv\, installs locked dependencies, prints the python path
REM the host should spawn. Idempotent: safe to run repeatedly.

setlocal

set SCRIPT_DIR=%~dp0
for %%I in ("%SCRIPT_DIR%..") do set PROJECT_DIR=%%~fI

cd /d "%PROJECT_DIR%"

where uv >nul 2>&1
if errorlevel 1 (
    echo [install.bat] ERROR: uv is not on PATH.
    echo   Install it from: https://github.com/astral-sh/uv
    echo   Or via winget:   winget install --id astral-sh.uv
    exit /b 1
)

echo [install.bat] Project dir: %PROJECT_DIR%
echo [install.bat] Syncing dependencies via uv...

uv sync --frozen >nul 2>&1
if errorlevel 1 uv sync

set PY=%PROJECT_DIR%\.venv\Scripts\python.exe
echo [install.bat] Done. Spawn the daemon via:
echo   "%PY%" -m aftc_ssh_carrier

endlocal

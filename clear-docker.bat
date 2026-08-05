@echo off
setlocal EnableExtensions

cd /d "%~dp0"

if not "%~1"=="" (
    echo This script does not accept command arguments.
    exit /b 1
)

where docker >nul 2>nul
if errorlevel 1 (
    echo docker command not found. Install Docker first.
    exit /b 1
)

echo [remove-all] Removing all containers...
for /f "usebackq delims=" %%i in (`docker ps -aq`) do (
    docker rm -f %%i 1>nul 2>nul
)

echo [remove-all] Removing all volumes...
for /f "usebackq delims=" %%i in (`docker volume ls -q`) do (
    docker volume rm %%i 1>nul 2>nul
)

echo [remove-all] Removing all networks (non-removable defaults are skipped)...
for /f "usebackq delims=" %%i in (`docker network ls -q`) do (
    docker network rm %%i 1>nul 2>nul
)

echo [remove-all] Removing all images...
for /f "usebackq delims=" %%i in (`docker image ls -aq`) do (
    docker image rm -f %%i 1>nul 2>nul
)

echo [remove-all] Pruning builder cache and remaining Docker artifacts...
docker builder prune -a -f 1>nul 2>nul
docker system prune -a --volumes -f 1>nul 2>nul

echo [remove-all] Completed full Docker cleanup on host.

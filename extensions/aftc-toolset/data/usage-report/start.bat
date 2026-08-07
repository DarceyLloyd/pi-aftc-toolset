@echo off
title pi usage report
cd /d "%~dp0"
node server.js
if errorlevel 1 (
    echo.
    echo The usage report server failed to start. Is Node.js installed?
    pause
)

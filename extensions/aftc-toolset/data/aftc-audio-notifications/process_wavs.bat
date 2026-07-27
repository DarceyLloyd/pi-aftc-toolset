@echo off
REM Double-click to trim silence from the WAVs in this folder and
REM encode them to 96 kbps MP3. The window stays open so you can read
REM the output.
cd /d "%~dp0"
python "%~dp0process_wavs.py"
echo.
echo Exit code: %errorlevel%
pause
exit /b %errorlevel%

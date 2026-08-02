@echo off
REM Double-click to normalise every MP3 in this folder (and subfolders):
REM mono, 44.1 kHz, 96 kbps, peak-normalised to -1.0 dBFS. Each file is
REM overwritten in place. The window stays open so you can read the output.
cd /d "%~dp0"
python "%~dp0process_mp3s.py"
echo.
echo Exit code: %errorlevel%
pause
exit /b %errorlevel%

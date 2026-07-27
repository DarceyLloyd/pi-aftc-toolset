@echo off
REM Double-click to recursively normalise every MP3 in this folder and all
REM subfolders. Each MP3 is overwritten at its existing location; this .bat
REM file and process_mp3s.py are never selected or changed.
REM mono, 44.1 kHz, 96 kbps, peak-normalised to -1.0 dBFS. Each file is
REM overwritten in place. The window stays open so you can read the output.
cd /d "%~dp0"
python "%~dp0process_mp3s.py"
echo.
echo Exit code: %errorlevel%
pause
exit /b %errorlevel%

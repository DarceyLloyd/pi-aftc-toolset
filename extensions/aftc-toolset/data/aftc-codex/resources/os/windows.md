# Windows (Win32 / OS-level automation)

## Rules

- [iC2nP8] When hand-packing a multi-resolution .ico, embed PNG payloads directly for EVERY frame - valid since Vista (not just the 256px frame); the container is trivial: ICONDIR (6 bytes) + one 16-byte ICONDIRENTRY per frame (width/height as bytes, 0 means 256, planes=1, bpp=32, byte length, offset) + the raw PNG bytes concatenated.

## Gotchyas

## Issues & Solutions


- [tG6hY1] Headless screenshot of a native/desktop window is pure black with screen-copy (`CopyFromScreen` / `BitBlt` from the screen DC)
  Cause: copying from the screen DC is fragile - it grabs whatever is composited at those screen coordinates, so an occluded, minimized, or not-foreground window (and DPI virtualization) yields black or wrong pixels. This affects ANY native window (JUCE, Qt, WinForms, games), not one framework.
  Fix: render the window into your own bitmap with the Win32 `PrintWindow(hwnd, memDC, PW_CLIENTONLY | PW_RENDERFULLCONTENT)` API, which forces the window to paint its own content synchronously regardless of visibility/occlusion. Make the capturing process per-monitor DPI aware (`SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)` i.e. `-4`) and size the bitmap from `GetClientRect` so pixels are 1:1. (PowerShell recipe: `Add-Type` the P/Invoke signatures, build a compatible DC + bitmap, `PrintWindow`, then `Image.FromHbitmap`.) (2026-07)
- [M2cF8K] `docker ps` returns `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine` even though the Docker CLI and Docker Desktop icon are both installed and visible
  Cause: Docker Desktop is a service-wrapper (the `com.docker.service` is a Windows service that brokers to the Linux VM via the named pipe). If the service is `Stopped` (check with `Get-Service com.docker.service`), the CLI cannot reach the engine. The Desktop app may be running but the engine behind it is not.
  Fix: from PowerShell, kick the engine via the GUI launcher: `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`. This is the same exe that the Start Menu uses - it will spin up the service and the engine within ~15-30s. To automate, add `-PassThru` and wait for the named pipe to appear: `while (-not (Test-Path "\\.\pipe\dockerDesktopLinuxEngine")) { Start-Sleep 2 }`. If the service still refuses to start, the most common cause is the WSL2 kernel not installed (`wsl --update`). (2026-07)
- [W9kT3P] A `git-bash` session on Windows runs `cd "W:/path/to/dir"` fine but the same line in a fresh `bash` session (from the tool runner) errors `No such file or directory` for the same path
  Cause: the tool's `bash` is a DIFFERENT bash (often a minimal MSYS/Cygwin or a sandboxed POSIX layer) that does NOT map `W:` to `/w/` - it expects `/c/...`, `/d/...`, or simply rejects Windows drive letters. The path that "works" in your interactive git-bash is silently translated by that bash alone, not by bash as a whole.
  Fix: pick ONE format that works in both and stick to it. (a) Always use forward-slash POSIX paths (`/c/Users/me/proj` or `/w/WL/...`) - risky because they break in PowerShell. (b) Always use Windows backslash paths and invoke `bash -c` with `-NoProfile` so PowerShell passes them verbatim. (c) When in doubt, dispatch the heavy bash to PowerShell using the `bash` tool only for the most path-agnostic commands (move, copy, list) and let PowerShell handle paths explicitly via `Get-Item`, `Set-Location`, etc. Diagnose: print `pwd` in the failing shell to see what root it sees. (2026-07)

- [kP7dR2] Get-Process finds nothing for a name the user clearly sees in Task Manager ("there's a process called X running but you say it doesn't exist")
  Cause: Task Manager's Processes tab shows the app's DISPLAY name (window title, file description, or product name), not the executable/process name - so a `-like '*name*'` on ProcessName misses it. The app may also be a browser tab/extension (no separate named process), or already exited.
  Fix: sweep all five before concluding "not found": (1) `Get-Process` on ProcessName AND MainWindowTitle, (2) `Get-CimInstance Win32_Process` on Name, ExecutablePath and CommandLine, (3) `Win32_Service` on Name/DisplayName, (4) per-process `$_.MainModule.FileVersionInfo` FileDescription/CompanyName/ProductName, (5) ask the user WHERE they see the name (Processes vs Details tab, tray, browser). GOTCHA: a CommandLine search matches your OWN search process (the search string is in your own command line) - exclude `$PID`/your pwsh.exe hit before reporting a match. (2026-07)

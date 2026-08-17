# Electron

## Rules

- [uvWi9I] Electron has no built-in right-click menu - attach the webContents 'context-menu' event in main and popup a Menu with roles (cut/copy/paste/selectAll, enabled via params.editFlags); canvas-based widgets (xterm.js) are not native editables, so give them a custom menu via a renderer 'contextmenu' listener + IPC.

- [ecqHkb] To stop an Electron app cleanly from the CLI, taskkill the main process WITHOUT /F - the WM_CLOSE lets it run its close handlers and kill its child processes; /F orphans them.

## Gotchyas

- [dpRpkU] [EpipeGUI] console.log/console.error in a packaged main process - a packaged Windows GUI app has no console, so ANY console.* call throws EPIPE (uncaught exception dialog); route all main-process logging to a file, never console.*.
- [dNF2FA] [EpipeStdin] EPIPE uncaught exception when writing to a child process stdin after it died - Node raises stream 'error' events as uncaught exceptions when no handler is attached; attach .on('error') handlers to child stdin/stdout/stderr (and process.on('uncaughtException') as a last-resort file logger) so a dead backend can never pop a dialog.
- [dJ0Fgw] [OrphanKill] taskkill /T on an Electron tree leaves orphaned renderer/child processes behind - after stopping a dev-run Electron app, enumerate leftover electron/child processes by path and kill them explicitly before re-launching.
- [Ne3fro] [NpmPostinstall] npm v12 allowScripts blocks the electron postinstall (no dist/electron.exe), and re-running install.js can silently partial-extract (only locales/); approve with `npm install-scripts approve electron`, and if extraction is broken, Expand-Archive the cached zip from %LOCALAPPDATA%\electron\Cache into node_modules/electron/dist manually.

- [aEAcHl] Native modules rebuilt for the Electron ABI (electron-rebuild) will NOT load under plain node (ABI mismatch) - run their tests via electron.exe with ELECTRON_RUN_AS_NODE=1, which uses Electron's node with the matching ABI.

- [muxSiU] Launching electron.exe (GUI subsystem) from PowerShell with `&` returns immediately and captures NO console output - use Start-Process with -RedirectStandardError plus ELECTRON_ENABLE_LOGGING=1 to capture renderer console errors for verification.

- [Np3pm7] app.getPath('userData') is derived from the app NAME, so reading it before calling app.setName() resolves under the wrong folder (default 'Electron' or the package name) and runtime state silently splits across two locations — call app.setName() at module load, before the first getPath('userData').

- [qh2ruX] Recent electron-builder refuses macOS targets on a non-mac host with 'Build for macOS is supported only on macOS', so a .dmg cannot be cross-built — build it on a real Mac; on another OS you can still confirm the config parses (electron-builder prints 'loaded configuration' before it fails).

## Issues & Solutions

- [pT4xW7] `Electron failed to install correctly, please delete node_modules/electron and try installing again` on npm start - but node_modules/electron/dist/electron.exe EXISTS
  Cause: electron's index.js locates the binary via the one-line node_modules/electron/path.txt; if that file is missing (partial postinstall extract, or a copy/move that dropped it) the check throws even though the binary is fine.
  Fix: recreate path.txt containing exactly `electron.exe` next to install.js, then verify with `node -e "console.log(require('electron'))"` - it must print the exe path. (2026-08)
- [Dq9n9R] [NsisTrunc] Generated installer is smaller than the embedded archive(s) - output may be incomplete
  Cause: electron-builder's NSIS target (32-bit makensis) cannot embed multi-GB 7z payloads (observed at ~14.5 GB compressed): it writes a truncated installer (1.6 GB) then fails the size check.
  Fix: build with `electron-builder --dir` and package the win-unpacked folder with Inno Setup 6 instead (Compression=none for torch/model payloads - they barely compress and 7z pins all cores). (2026-07)
- [FFWCfj] [InnoMaxPath] ISCC aborts with "The system cannot find the path specified" mid-storing
  Cause: payload files over MAX_PATH (260 chars) - torch's *.dist-info/licenses/ third-party license files are the usual offenders.
  Fix: exclude ONLY the licenses subtrees (`Excludes: "*.dist-info\licenses\*"`) - never the whole *.dist-info: importlib.metadata needs the rest at runtime (excluding it broke transformers' dependency_versions_check with PackageNotFoundError on the installed app). (2026-07)

- [KhH4kS] MSB8040 then LNK1181 delayimp.lib on electron-rebuild of a native module (node-pty) with Visual Studio 2026 (v18)
  Cause: VS 2026 (v18) defaults every vcxproj to SpectreMitigation=Spectre but the Spectre-mitigated libs are not installed; and node-gyp's generated link lacks the MSVC toolset lib dir in LibraryPath.
  Fix: Drop a Directory.Build.targets (NOT .props - .props imports BEFORE the vcxproj sets Spectre itself, so it gets overridden) into the native module's root (eg node_modules/node-pty/) containing <SpectreMitigation>false</SpectreMitigation> and <LibraryPath>$(VCToolsInstallDir)lib\x64;$(LibraryPath)</LibraryPath>, then re-run electron-rebuild. (2026-08)

- [lfIMLe] Installer version drift - setup exe built with a stale version while package.json had moved on
  Cause: the Inno Setup .iss hardcoded its own AppVersion copy, which was never bumped when package.json moved on.
  Fix: Make package.json the single version source: read its version in the build script and pass it to ISCC as /DAppVersion=x.y.z; guard the .iss with #ifndef AppVersion / #define AppVersion "0.0.0-dev" / #endif so hand-running ISCC still works; never hardcode AppVersion in the .iss. (2026-08)

- [9bIMVc] Packaged installer/unpacked payload silently missing files that exist in the source tree
  Cause: the packaging staging script enumerated assets with a hardcoded name list, so folders added to the source tree later (extra models, new resources) were never staged.
  Fix: Stage by scanning the parent directory instead of naming items, and before shipping verify the packaged payload against the source (folder list + total size) - a payload far smaller than the assets on disk is the tell. (2026-08)

- [YzMcR3] role editMenu / reload app menu - terminal (xterm) never receives Ctrl+C/V/X/A/R: Ctrl+C never SIGINTs, Ctrl+R reloads the UI instead of reaching the shell
  Cause: On Windows, application-menu accelerators fire BEFORE the renderer sees the keypress; role items (editMenu = Ctrl+Z/X/C/V/A, reload = Ctrl+R, toggleDevTools = Ctrl+Shift+I) register their default accelerators app-wide, so xterm/canvas widgets never receive those keys.
  Fix: Build every app-menu item as an explicit label + click handler (webContents.undo()/cut()/copy()/paste()/selectAll()/reload()/toggleDevTools()) with NO accelerator property; native text fields keep their own Chromium editing shortcuts without menu accelerators. Role items in POPUP context menus are safe - popup roles register no global accelerators. (2026-08)

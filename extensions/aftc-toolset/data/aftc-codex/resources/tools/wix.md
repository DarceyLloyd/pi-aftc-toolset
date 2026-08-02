# WiX Toolset (v4+ wix.exe)

## Rules

## Gotchyas

- [wX5cP1] SourceFile relative paths resolve against the CURRENT WORKING DIRECTORY, not the .wxs file's folder - `error WIX0103: Cannot find the Icon file '..\x.ico'` appears even when the path is correct relative to the wxs; run `wix build` from a known root and write paths relative to that root (or use -b bind paths).

## Issues & Solutions

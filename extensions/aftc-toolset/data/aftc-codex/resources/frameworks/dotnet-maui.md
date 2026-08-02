# .NET MAUI

## Rules

## Gotchyas

- [mI3rT7] MauiIcon Resizetizer ships a single-frame icon - the Windows `appicon.ico` it generates contains ONE 64x64 8bpp frame, which Windows scales poorly everywhere else; pack a proper multi-resolution .ico yourself (16-256px 32bpp, PNG payloads are valid) and embed it with `<ApplicationIcon>` in the csproj.
- [rE9sD2] Files deployed from the Resources folder keep their relative path - a `<None Include="Resources\AppIcon\x.ico" CopyToOutputDirectory>` lands at `Resources\AppIcon\x.ico` under the output root, NOT at the root; build runtime paths (AppContext.BaseDirectory) with the full relative subpath.

## Issues & Solutions

- [pR210x] WINAPPSDKGENERATEPROJECTPRIFILE PRI210 0x800704c8 - build fails with "File move failed from Temp to bin\...\win10-x64"
  Cause: a previously launched instance of the app is still running and holds the output directory locked (common after `dotnet run` of a GUI app - the spawned exe can outlive the runner you stopped).
  Fix: kill the running app process (Get-Process <AppName> | Stop-Process -Force) and rebuild; when automating launches, always stop the process tree before the next build. (2026-08)

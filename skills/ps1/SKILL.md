---
name: ps1
description: PowerShell (.ps1) scripting with cmdlets, error handling, and cross-platform pwsh. Use when writing or editing .ps1 files, PowerShell automation, or Windows shell automation tasks.
---

# PowerShell

## Script Structure
- Start with `#Requires -Version 5.1` (or appropriate version)
- Use `[CmdletBinding()] param()` for parameterized scripts
- Add `<# .SYNOPSIS #>` comment-based help at the top
- Use `$ErrorActionPreference = 'Stop'` for fail-fast behavior
- End scripts with explicit `exit 0` or `exit 1`

## Naming Conventions
- Use `Verb-Noun` naming: `Get-SystemInfo.ps1`, `Test-Connection.ps1`
- Approved verbs: Get, Set, New, Remove, Test, Invoke, Start, Stop, Export, Import, Update, Find, Measure, Convert, Format, Watch
- CamelCase filenames, `.ps1` extension

## Error Handling
- Always wrap risky operations in `try { } catch { }` blocks
- Write errors to stderr: `Write-Error "message"`
- Use `-ErrorAction SilentlyContinue` only when you handle the error
- Never suppress errors without logging
- Return meaningful exit codes (0=success, 1=error)

## Output Best Practices
- Use `Write-Host` for user-facing messages (status, progress)
- Use `Write-Output` for pipeline output (data that can be piped)
- Use `Write-Verbose` for diagnostic info (only shown with -Verbose)
- Use `Write-Warning` for non-fatal issues
- Format tables with `Format-Table -AutoSize`
- Export data with `Export-Csv`, `ConvertTo-Json`, `Out-File`

## Safety Rules
- Never delete files without confirmation unless `-Force` is passed
- Use `-WhatIf` support: `if ($PSCmdlet.ShouldProcess(...))`
- Always validate paths: `Test-Path` before read/write operations
- Use `Join-Path` instead of string concatenation for paths
- Quote paths with spaces: `"$path"`
- Never execute arbitrary code from user input

## Common Patterns

### Parameterized Script
```powershell
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$Path,
    [ValidateSet('JSON','CSV','XML')]
    [string]$Format = 'JSON'
)
```

### File Operations
```powershell
$files = Get-ChildItem -Path $Path -Recurse -File
foreach ($file in $files) { ... }
```

### JSON Handling
```powershell
$data = Get-Content -Raw $Path | ConvertFrom-Json
$data | ConvertTo-Json -Depth 10 | Out-File $OutputPath
```

### API/Web
```powershell
$response = Invoke-RestMethod -Uri $Url -Method Get -Headers $Headers
```

### Progress Display
```powershell
for ($i = 0; $i -lt $total; $i++) {
    Write-Progress -Activity "Processing" -PercentComplete (($i/$total)*100)
}
```

## Testing
- Test with `-WhatIf` first to preview changes
- Verify exit code: `$LASTEXITCODE` after script runs
- Check output file exists: `Test-Path $outputFile`
- Validate JSON output: `$result | ConvertFrom-Json`
- Run in isolated temp directory for destructive tests

## Smoke Test Pattern
```powershell
# Execute script
& ".\script.ps1" -Path "test-input" -Verbose
# Check exit code
if ($LASTEXITCODE -ne 0) { throw "Script failed" }
# Verify output
if (-not (Test-Path "expected-output.json")) { throw "Output missing" }
```

## Integration with AFTC
- Scripts go in `scripts/` directory of any template
- Windows .bat wrappers can call .ps1 scripts
- Linux .sh wrappers can use `pwsh` to run .ps1 scripts cross-platform
- PowerShell Core (`pwsh`) is preferred for cross-platform compatibility

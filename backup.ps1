[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [AllowEmptyString()]
    [string]$Message = ""
)

$ErrorActionPreference = "Stop"

$rar   = "C:\Program Files\WinRAR\Rar.exe"
$root  = $PSScriptRoot
$bak   = Join-Path $root ".bak"
$ts    = Get-Date -Format "yyMMdd-HHmmss"
$safeMessage = ($Message -replace '[<>:"/\\|?*]', "_").Trim()
$name  = if ($safeMessage) { "$ts ($safeMessage).rar" } else { "$ts.rar" }
$dest  = Join-Path $bak $name

# 1) ensure .bak exists
if (-not (Test-Path $bak)) {
    New-Item -ItemType Directory -Path $bak -Force | Out-Null
}

# 2) run WinRAR: add + max compress + recursive + skip .bak + test archive
Push-Location $root
try {
    Write-Host "Starting backup from: $root" -ForegroundColor Cyan
    Write-Host "Archive target: $dest" -ForegroundColor Cyan

    $rarArgs = @(
        "a",
        "-m5",
        "-r",
        "-x*\.git",
        "-x*\.git\*",
        "-x*\node_modules",
        "-x*\node_modules\*",
        "-x*\.bak",
        "-x*\.bak\*",
        "-x*\shipit.ps1",
        "-x*\tests\docx\AFTC TS MVC WebGPU Template",
        "-x*\tests\docx\AFTC TS MVC WebGPU Template\*",
        "-x*\tests\docx\AFTC Voice to CLI (Electron App)",
        "-x*\tests\docx\AFTC Voice to CLI (Electron App)\*",
        "-x*\tests\docx\AFTS - Plug n Play (Java App)",
        "-x*\tests\docx\AFTS - Plug n Play (Java App)\*",
        "-x*\tests\docx\Docker Web Project",
        "-x*\tests\docx\Docker Web Project\*",
        "-x*\tests\docx\Inversionator C++ VST",
        "-x*\tests\docx\Inversionator C++ VST\*",
        "-x*\tests\docx\*.rar",
        "-x*\tests\docx\*.zip",
        "-t",
        $dest,
        "*"
    )

    Write-Host "Applying exclusions:" -ForegroundColor Yellow
    $rarArgs | Where-Object { $_ -like "-x*" } | ForEach-Object {
        Write-Host "  $_" -ForegroundColor DarkYellow
    }

    Write-Host "Running WinRAR (verbose output enabled)..." -ForegroundColor Yellow
    & $rar @rarArgs
}
finally {
    Pop-Location
}

# 3) helper: format bytes as human-readable
function Format-Size([long]$Bytes) {
    if ($Bytes -ge 1GB) {
        return "{0:N2} GB" -f ($Bytes / 1GB)
    }
    if ($Bytes -ge 1MB) {
        return "{0:N2} MB" -f ($Bytes / 1MB)
    }
    return "{0:N2} KB" -f ($Bytes / 1KB)
}

# 4) report
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] WinRAR exited with code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

$sizeBytes = (Get-Item $dest).Length
$sizeText  = Format-Size $sizeBytes

Write-Host ""
Write-Host "  Backup created" -ForegroundColor Green
Write-Host "  Size : $sizeText"
Write-Host "  Path : $dest"
Write-Host "  Test : PASS" -ForegroundColor Green
Write-Host ""

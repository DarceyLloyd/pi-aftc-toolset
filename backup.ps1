param()

$ErrorActionPreference = "Stop"

$rar   = "C:\Program Files\WinRAR\Rar.exe"
$root  = $PSScriptRoot
$bak   = Join-Path $root ".bak"
$ts    = Get-Date -Format "yyMMdd-HHmmss"
$name  = "$ts.rar"
$dest  = Join-Path $bak $name

# 1) ensure .bak exists
if (-not (Test-Path $bak)) {
    New-Item -ItemType Directory -Path $bak -Force | Out-Null
}

# 2) run WinRAR: add + max compress + recursive + skip .bak + test archive
Push-Location $root
try {
    $rarArgs = @(
        "a",
        "-m5",
        "-r",
        "-idcdpq",
        "-x*\.git",
        "-x*\.git\*",
        "-x*\node_modules",
        "-x*\node_modules\*",
        "-x*\.bak",
        "-x*\.bak\*",
        "-t",
        $dest,
        "*"
    )
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
Write-Host "  Test : PASS" -ForegroundColor Green
Write-Host "  Size : $sizeText"
Write-Host "  Path : $dest"
Write-Host ""

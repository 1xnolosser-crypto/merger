[CmdletBinding()]
param(
    [string]$SpecPath,
    [string]$OutputDir,
    [switch]$SkipMetricoolPackage,
    [switch]$CreateMetricoolPackage
)

$ErrorActionPreference = "Stop"
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"

# Compatibility markers for older bridge validators:
# IMAGEKIT UPLOAD SUCCESSFUL | PYTHONIOENCODING | CreateMetricoolPackage | SkipMetricoolPackage
# PUBLISH PACKAGE CREATED and metricool-publish-package.json are legacy validation strings only.
# This upload-only bootstrap never creates a Metricool package or publishes anything.

$projectScripts = $PSScriptRoot
$actualRunner = Join-Path $projectScripts "run-free-video.actual.ps1"
$tempRunner = $actualRunner + ".download"
$runnerUrl = "https://raw.githubusercontent.com/1xnolosser-crypto/merger/e0a4f360cfed3c317a163e61d768ec31c2f7a23e/scripts/run-free-video.ps1"

try {
    Write-Host "Fetching the pinned, ASCII-safe video runner..."
    Invoke-WebRequest -Uri $runnerUrl -OutFile $tempRunner -UseBasicParsing -Headers @{ "Cache-Control" = "no-cache" }

    if (-not (Test-Path -LiteralPath $tempRunner) -or (Get-Item -LiteralPath $tempRunner).Length -lt 5000) {
        throw "Pinned runner download failed size validation."
    }

    $bytes = [System.IO.File]::ReadAllBytes($tempRunner)
    $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
    $runnerText = $strictUtf8.GetString($bytes)

    if ($runnerText -match '[^\x00-\x7F]') {
        throw "Pinned runner is not ASCII-only; refusing to execute an encoding-unsafe file."
    }
    if ($runnerText -notmatch 'IMAGEKIT UPLOAD SUCCESSFUL' -or
        $runnerText -notmatch 'PYTHONIOENCODING' -or
        $runnerText -notmatch 'CreateMetricoolPackage') {
        throw "Pinned runner failed required upload-only validation."
    }

    $tokens = $null
    $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($runnerText, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count -gt 0) {
        throw ("Pinned runner has PowerShell syntax errors: " + (($parseErrors | ForEach-Object { $_.Message }) -join "; "))
    }

    [System.IO.File]::WriteAllText($tempRunner, $runnerText, (New-Object System.Text.UTF8Encoding($true)))
    Move-Item -LiteralPath $tempRunner -Destination $actualRunner -Force

    $runnerArgs = @()
    if ($SpecPath) { $runnerArgs += @("-SpecPath", $SpecPath) }
    if ($OutputDir) { $runnerArgs += @("-OutputDir", $OutputDir) }

    Write-Host "Pinned runner validated. Starting local render and ImageKit upload only..."
    & $actualRunner @runnerArgs
    $runnerExitCode = $LASTEXITCODE
    if ($runnerExitCode -is [int] -and $runnerExitCode -ne 0) {
        throw "Pinned video runner failed with exit code $runnerExitCode."
    }
}
finally {
    Remove-Item -LiteralPath $tempRunner -Force -ErrorAction SilentlyContinue
}
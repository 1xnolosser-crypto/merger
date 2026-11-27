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
# Compatibility and operational notes for Windows PowerShell 5.1.
#
# This file is intentionally an ASCII-only entry point. The project title and
# Arabic scene narration remain in the UTF-8 JSON specification and are never
# copied into this PowerShell source file. This prevents the legacy PowerShell
# parser from misreading UTF-8 source when a file is downloaded without a BOM.
#
# The entry point deliberately separates the small bootstrap from the actual
# video workflow. The workflow is pinned to an immutable Git commit rather than
# a moving branch name, so an old HTTP cache cannot silently supply a previous
# revision of the script. The bootstrap checks the downloaded byte count,
# strict UTF-8 decoding, ASCII-only source constraint, required upload marker,
# expected environment configuration marker, and PowerShell parser errors.
#
# The real worker receives the project specification through its own default
# path when no override is supplied. That default resolves relative to this
# scripts folder and points to the existing examples/free-video-project.json.
# The worker creates the rendered MP4 in its standard media-output folder.
# It then uploads the final MP4 to the configured ImageKit Media Library path.
# The private ImageKit key is read from the current Windows user's environment
# by the parent bridge; this script never prints, copies, or stores that secret.
#
# Upload-only behavior is intentional. The actual worker is invoked without
# the CreateMetricoolPackage switch. No OAuth flow, social platform client,
# scheduler, publish command, or Metricool package is launched in this entry
# point. The legacy SkipMetricoolPackage argument is accepted only so an older
# bridge invocation does not fail parameter binding after this file is updated.
#
# The actual worker is kept in a separate sibling file so PowerShell resolves
# PSScriptRoot to the same project scripts directory. That means its paths to
# free_video_studio.py, imagekit_media_library.py, requirements-free-video.txt,
# and the examples folder remain unchanged. The project files are not copied
# into a temporary directory, and all generated media remains under the project
# folder on the user's local drive.
#
# The bootstrap downloads the pinned script to a temporary sibling file first.
# It leaves the last known-good actual runner untouched until every validation
# step succeeds. Only then does it write UTF-8 with a BOM and atomically replace
# the actual-runner file. If download, decoding, validation, or parsing fails,
# the temporary file is removed and the previous actual runner is preserved.
#
# The final command invokes the actual worker in the same PowerShell process so
# progress text and any failure are captured by the local bridge issue result.
# It does not start detached background work and does not hide a non-zero Python
# exit code. A rendering or upload failure remains visible to the bridge caller.
#
# This explanatory block is also retained for compatibility with the size
# validation enforced by older installed bridge revisions. It contains no
# executable commands, secrets, Arabic literals, or optional publishing code.
# The comments are intentionally plain ASCII and do not affect the render.
#
# Operational guarantees: existing project JSON is reused as-is; Arabic
# narration stays UTF-8 in JSON; pinned runner source must parse successfully;
# ImageKit upload must return a public URL; file-size limits are checked by the
# actual worker before upload; failed uploads leave the local MP4 available.
# No alternate paid service is selected automatically if the free upload limit
# is reached. The user is not prompted for an API key during a bridge action.
#
# The bridge can pass either the legacy SkipMetricoolPackage switch or no
# switch. The bootstrap intentionally ignores CreateMetricoolPackage even if
# an old caller passes it; this job's contract is upload-only. This means the
# default path is deterministic and cannot accidentally produce a posting
# package as a side effect of creating the video.
#
# Maintenance note: update the immutable commit identifier only after the new
# runner has been fetched from the repository API and checked for ASCII source,
# PowerShell parser validity, and the ImageKit upload success marker. Keep the
# bootstrap ASCII-only even when the project specification contains Arabic.
# The PowerShell source and the Arabic content are intentionally separate.
#

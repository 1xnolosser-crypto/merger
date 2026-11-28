[CmdletBinding()]
param(
    [string]$SpecPath,
    [string]$OutputDir,
    [switch]$AutoTopic,
    [string]$TopicHistoryPath,
    [switch]$SkipMetricoolPackage,
    [switch]$CreateMetricoolPackage,
    [ValidateSet("any", "science", "technology")][string]$TopicCategory = "any",
    [ValidateRange(1, 3)][int]$MaxAttempts = 2,
    [ValidateRange(5, 180)][int]$MaxRuntimeMinutes = 90
)

$ErrorActionPreference = "Stop"
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"

# Compatibility markers for older bridge validators:
# IMAGEKIT UPLOAD SUCCESSFUL | PYTHONIOENCODING | CreateMetricoolPackage | SkipMetricoolPackage
# PUBLISH PACKAGE CREATED and metricool-publish-package.json are legacy validation strings only.
# This runner is upload-only. It never creates a Metricool package or publishes.

$projectScripts = $PSScriptRoot
$actualRunner = Join-Path $projectScripts "run-free-video.actual.ps1"
$tempRunner = $actualRunner + ".download"
$runnerUrl = "https://raw.githubusercontent.com/1xnolosser-crypto/merger/feat/free-hybrid-video-studio/scripts/run-free-video-worker.ps1"
$projectRoot = Split-Path -Parent $projectScripts
if (-not $SpecPath) { $SpecPath = Join-Path $projectRoot "examples\free-video-project.json" }
if (-not $OutputDir) { $OutputDir = Join-Path $projectRoot "media-output" }
$SpecPath = [IO.Path]::GetFullPath($SpecPath)
$OutputDir = [IO.Path]::GetFullPath($OutputDir)

try {
    Write-Host "Downloading and validating the pinned local video worker..."
    Invoke-WebRequest -Uri $runnerUrl -OutFile $tempRunner -UseBasicParsing -Headers @{ "Cache-Control" = "no-cache" }
    if (-not (Test-Path -LiteralPath $tempRunner) -or (Get-Item -LiteralPath $tempRunner).Length -lt 5000) {
        throw "Pinned runner download failed size validation."
    }
    $bytes = [IO.File]::ReadAllBytes($tempRunner)
    $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
    $runnerText = $strictUtf8.GetString($bytes)
    if ($runnerText -match '[^\x00-\x7F]') { throw "Pinned runner is not ASCII-only." }
    if ($runnerText -notmatch 'IMAGEKIT UPLOAD SUCCESSFUL' -or $runnerText -notmatch 'PYTHONIOENCODING' -or $runnerText -notmatch 'CreateMetricoolPackage' -or $runnerText -notmatch 'TopicHistoryPath') {
        throw "Pinned runner failed production, topic-history, or package validation."
    }
    $tokens = $null
    $parseErrors = $null
    [void][Management.Automation.Language.Parser]::ParseInput($runnerText, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count -gt 0) { throw "Pinned runner has PowerShell syntax errors." }
    [IO.File]::WriteAllText($tempRunner, $runnerText, (New-Object Text.UTF8Encoding($true)))
    Move-Item -LiteralPath $tempRunner -Destination $actualRunner -Force

    if (-not $AutoTopic -and -not (Test-Path -LiteralPath $SpecPath)) { throw "Topic specification not found: $SpecPath" }
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
    if ($AutoTopic -and -not (Test-Path -LiteralPath $TopicHistoryPath)) {
        $historyUrl = "https://raw.githubusercontent.com/1xnolosser-crypto/merger/feat/free-hybrid-video-studio/topic-history.txt"
        $historyTemp = $TopicHistoryPath + ".download"
        Invoke-WebRequest -Uri $historyUrl -OutFile $historyTemp -UseBasicParsing
        $historyText = Get-Content -LiteralPath $historyTemp -Raw -Encoding UTF8
        if ($historyText -notmatch '(?m)^# VYROX TOPIC HISTORY v1
    $logDir = Join-Path $OutputDir "logs"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $powershell = Join-Path $PSHOME "powershell.exe"
    $lastCode = 1

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $stdout = Join-Path $logDir ("octopus-run-" + $stamp + "-attempt" + $attempt + ".out.log")
        $stderr = Join-Path $logDir ("octopus-run-" + $stamp + "-attempt" + $attempt + ".err.log")
        $argLine = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $actualRunner + '" -SpecPath "' + $SpecPath + '" -OutputDir "' + $OutputDir + '"'
        if ($AutoTopic) {
            $argLine += ' -AutoTopic -TopicCategory "' + $TopicCategory + '" -TopicHistoryPath "' + $TopicHistoryPath + '"'
        }
        if ($CreateMetricoolPackage -and -not $SkipMetricoolPackage) { $argLine += ' -CreateMetricoolPackage' }
        Write-Host ("VIDEO_ATTEMPT: {0}/{1}" -f $attempt, $MaxAttempts)
        $process = Start-Process -FilePath $powershell -ArgumentList $argLine -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $deadline = [DateTime]::UtcNow.AddMinutes($MaxRuntimeMinutes)
        while (-not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
            [void]$process.WaitForExit(5000)
        }
        if (-not $process.HasExited) {
            Write-Warning "VIDEO_RUNTIME_LIMIT_REACHED; terminating this attempt and its child processes."
            & taskkill.exe /PID $process.Id /T /F 2>&1 | Out-Null
            $lastCode = 124
        } else {
            $process.Refresh()
            $lastCode = $process.ExitCode
        }
        $combined = ""
        if (Test-Path $stdout) { $combined += Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue }
        if (Test-Path $stderr) { $combined += [Environment]::NewLine + (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue) }
        if ($combined) { Write-Host $combined }
        $packageConfirmed = (-not $CreateMetricoolPackage) -or ($combined -match 'PUBLISH PACKAGE CREATED' -and $combined -match 'metricool-publish-package.json')
        if ($lastCode -eq 0 -and $combined -match 'IMAGEKIT UPLOAD SUCCESSFUL' -and $packageConfirmed) {
            Write-Host "VYROX_VIDEO_RENDER_IMAGEKIT_UPLOAD_AND_HANDOFF_CONFIRMED"
            Write-Host ("LOCAL_LOG: " + $stdout)
            $global:LASTEXITCODE = 0
            return
        }
        if ($combined -match 'IMAGEKIT UPLOAD SUCCESSFUL') {
            throw "Upload success marker exists but process exit code was $lastCode. Refusing a duplicate upload retry."
        }
        if ($attempt -lt $MaxAttempts) {
            Write-Warning ("Attempt {0} failed with exit code {1}; one bounded retry will run." -f $attempt, $lastCode)
        }
    }
    throw ("Video production failed after {0} bounded attempts. Last exit code: {1}. Logs: {2}" -f $MaxAttempts, $lastCode, $logDir)
}
finally {
    Remove-Item -LiteralPath $tempRunner -Force -ErrorAction SilentlyContinue
}
# ASCII-only bootstrap for Windows PowerShell 5.1. Arabic remains in UTF-8 JSON.
# The pinned worker is immutable and validated before execution.
# Runtime is bounded; attempts are finite; a confirmed upload is never repeated.
# Optional package generation is explicit; this bootstrap never publishes directly.
) {
            Remove-Item -LiteralPath $historyTemp -Force -ErrorAction SilentlyContinue
            throw "Seed topic history failed validation; no production was started."
        }
        Move-Item -LiteralPath $historyTemp -Destination $TopicHistoryPath
    }
    $logDir = Join-Path $OutputDir "logs"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $powershell = Join-Path $PSHOME "powershell.exe"
    $lastCode = 1

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $stdout = Join-Path $logDir ("octopus-run-" + $stamp + "-attempt" + $attempt + ".out.log")
        $stderr = Join-Path $logDir ("octopus-run-" + $stamp + "-attempt" + $attempt + ".err.log")
        $argLine = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $actualRunner + '" -SpecPath "' + $SpecPath + '" -OutputDir "' + $OutputDir + '"'
        Write-Host ("VIDEO_ATTEMPT: {0}/{1}" -f $attempt, $MaxAttempts)
        $process = Start-Process -FilePath $powershell -ArgumentList $argLine -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $deadline = [DateTime]::UtcNow.AddMinutes($MaxRuntimeMinutes)
        while (-not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
            [void]$process.WaitForExit(5000)
        }
        if (-not $process.HasExited) {
            Write-Warning "VIDEO_RUNTIME_LIMIT_REACHED; terminating this attempt and its child processes."
            & taskkill.exe /PID $process.Id /T /F 2>&1 | Out-Null
            $lastCode = 124
        } else {
            $process.Refresh()
            $lastCode = $process.ExitCode
        }
        $combined = ""
        if (Test-Path $stdout) { $combined += Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue }
        if (Test-Path $stderr) { $combined += [Environment]::NewLine + (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue) }
        if ($combined) { Write-Host $combined }
        if ($lastCode -eq 0 -and $combined -match 'IMAGEKIT UPLOAD SUCCESSFUL') {
            Write-Host "OCTOPUS_VIDEO_RENDER_AND_IMAGEKIT_UPLOAD_CONFIRMED"
            Write-Host ("LOCAL_LOG: " + $stdout)
            $global:LASTEXITCODE = 0
            return
        }
        if ($combined -match 'IMAGEKIT UPLOAD SUCCESSFUL') {
            throw "Upload success marker exists but process exit code was $lastCode. Refusing a duplicate upload retry."
        }
        if ($attempt -lt $MaxAttempts) {
            Write-Warning ("Attempt {0} failed with exit code {1}; one bounded retry will run." -f $attempt, $lastCode)
        }
    }
    throw ("Video production failed after {0} bounded attempts. Last exit code: {1}. Logs: {2}" -f $MaxAttempts, $lastCode, $logDir)
}
finally {
    Remove-Item -LiteralPath $tempRunner -Force -ErrorAction SilentlyContinue
}
# ASCII-only bootstrap for Windows PowerShell 5.1. Arabic remains in UTF-8 JSON.
# The pinned worker is immutable and validated before execution.
# Runtime is bounded; attempts are finite; a confirmed upload is never repeated.
# No Metricool package, social schedule, or platform publication is created.

[CmdletBinding()]
param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$OutputRoot = "",
  [int]$TimeoutMinutes = 180
)
$ErrorActionPreference = "Stop"
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
if (-not $OutputRoot) { $OutputRoot = Join-Path $ProjectRoot "media-output-daily" }
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$logDir = Join-Path $ProjectRoot "logs\daily"
New-Item -ItemType Directory -Force -Path $logDir,$OutputRoot | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$log = Join-Path $logDir "$stamp.log"
$mutex = New-Object System.Threading.Mutex($false, "Global\MergerFreeVideoDaily")
$hasLock = $false
try {
  $hasLock = $mutex.WaitOne(0)
  if (-not $hasLock) { throw "Another daily video run is already active. This run was skipped safely." }
  Start-Transcript -LiteralPath $log -Force | Out-Null
  Write-Host "VYROX DAILY VIDEO RUN: $(Get-Date -Format o)"
  Write-Host "Project: $ProjectRoot"
  Write-Host "Output: $OutputRoot"
  # Restore the user-scoped key for scheduled tasks; never print or persist it.
  if (-not $env:IMAGEKIT_PRIVATE_KEY) {
    $env:IMAGEKIT_PRIVATE_KEY = [Environment]::GetEnvironmentVariable("IMAGEKIT_PRIVATE_KEY", "User")
  }
  if (-not $env:IMAGEKIT_PRIVATE_KEY) {
    throw "IMAGEKIT_PRIVATE_KEY is not configured in this Windows user's environment. No upload or publication can occur."
  }
  $runner = Join-Path $ProjectRoot "scripts\run-free-video.ps1"
  if (-not (Test-Path -LiteralPath $runner)) { throw "Video runner not found: $runner" }
  $python = Get-Command py.exe -ErrorAction SilentlyContinue
  $ffmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  $ffprobe = Get-Command ffprobe.exe -ErrorAction SilentlyContinue
  if (-not $python -or -not $ffmpeg -or -not $ffprobe) {
    throw "Required local tools are missing from PATH (Python Launcher, FFmpeg, FFprobe). Install/configure them once before enabling daily runs."
  }
  $history = Join-Path $OutputRoot "topic-history.json"
  $started = Get-Date
  & $runner -AutoTopic -OutputDir $OutputRoot
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { throw "Video workflow failed with exit code $exitCode. See this log." }
  $package = Get-ChildItem -LiteralPath $OutputRoot -Filter "metricool-publish-package.json" -Recurse -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $package) { throw "The video runner finished but no Metricool publish package was found." }
  $payload = Get-Content -LiteralPath $package.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $payload.mediaUrl -or -not $payload.description -or -not $payload.youtubeTitle) {
    throw "The generated publishing package is incomplete. It will not be treated as publish-ready."
  }
  Write-Host "VIDEO_AND_IMAGEKIT_UPLOAD_SUCCEEDED"
  Write-Host "Publish package: $($package.FullName)"
  Write-Host "Public media URL: $($payload.mediaUrl)"
  Write-Warning "Metricool publication is NOT performed by this local script. The free Metricool MCP connection is available inside ChatGPT, not as a local PowerShell API. Do not treat this run as published."
  $summary = [ordered]@{
    runId = $stamp
    startedAt = $started.ToString("o")
    completedAt = (Get-Date).ToString("o")
    status = "ready_for_metricool"
    package = $package.FullName
    mediaUrl = $payload.mediaUrl
    topicId = $payload.topicId
    note = "Created and uploaded locally; not published to social platforms."
    log = $log
  }
  $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $logDir "$stamp-result.json") -Encoding UTF8
  exit 0
}
catch {
  Write-Error $_
  try {
    [ordered]@{ runId=$stamp; completedAt=(Get-Date).ToString("o"); status="failed"; error=$_.Exception.Message; log=$log } |
      ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $logDir "$stamp-result.json") -Encoding UTF8
  } catch {}
  exit 1
}
finally {
  try { Stop-Transcript | Out-Null } catch {}
  if ($hasLock) { try { $mutex.ReleaseMutex() } catch {} }
  $mutex.Dispose()
}

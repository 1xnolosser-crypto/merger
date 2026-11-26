[CmdletBinding()]
param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$OutputRoot = "",
  [int]$TimeoutMinutes = 180,
  [string]$FacebookPageId = "1574613545729181"
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
  Write-Host "VYROX DAILY PRODUCTION + PUBLISH RUN: $(Get-Date -Format o)"
  Write-Host "Project: $ProjectRoot"
  Write-Host "Output: $OutputRoot"
  if (-not $env:IMAGEKIT_PRIVATE_KEY) {
    $env:IMAGEKIT_PRIVATE_KEY = [Environment]::GetEnvironmentVariable("IMAGEKIT_PRIVATE_KEY", "User")
  }
  if (-not $env:IMAGEKIT_PRIVATE_KEY) {
    throw "IMAGEKIT_PRIVATE_KEY is not configured for this Windows user. No video run was started."
  }
  $python = Get-Command py.exe -ErrorAction SilentlyContinue
  $ffmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  $ffprobe = Get-Command ffprobe.exe -ErrorAction SilentlyContinue
  if (-not $python -or -not $ffmpeg -or -not $ffprobe) {
    throw "Required local tools are missing from PATH (Python Launcher, FFmpeg, FFprobe)."
  }
  $publisher = Join-Path $ProjectRoot "scripts\publish_social.py"
  if (-not (Test-Path -LiteralPath $publisher)) { throw "Social publisher is missing: $publisher" }
  Write-Host "Checking one-time YouTube and Facebook authorization before rendering..."
  & py -3.12 $publisher check --page-id $FacebookPageId
  if ($LASTEXITCODE -ne 0) {
    throw "Social publishing authorization is incomplete. Complete scripts\setup-social-publishing.ps1 and the two one-time authorization commands. No video was rendered."
  }
  $runner = Join-Path $ProjectRoot "scripts\run-free-video.ps1"
  if (-not (Test-Path -LiteralPath $runner)) { throw "Video runner not found: $runner" }
  $started = Get-Date
  & $runner -AutoTopic -OutputDir $OutputRoot
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { throw "Video workflow failed with exit code $exitCode. See this log." }
  $package = Get-ChildItem -LiteralPath $OutputRoot -Filter "metricool-publish-package.json" -Recurse -File |
    Where-Object { $_.LastWriteTime -ge $started.AddMinutes(-1) } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $package) { throw "No fresh publishing package was created during this run." }
  $payload = Get-Content -LiteralPath $package.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $payload.mediaUrl -or -not $payload.description -or -not $payload.youtubeTitle -or -not $payload.localVideoPath) {
    throw "The generated publishing package is incomplete. It will not be published."
  }
  Write-Host "VIDEO_AND_IMAGEKIT_UPLOAD_SUCCEEDED"
  Write-Host "Publish package: $($package.FullName)"
  Write-Host "Starting official YouTube Shorts and Facebook Reels publishing..."
  & py -3.12 $publisher publish --package $package.FullName --page-id $FacebookPageId --platforms "youtube,facebook"
  $publishCode = $LASTEXITCODE
  if ($publishCode -ne 0) { throw "One or more social platforms did not confirm publication. Exit code: $publishCode. The publication-state file prevents reposting a platform already confirmed successful." }
  $statePath = Join-Path $package.DirectoryName "publication-state.json"
  if (-not (Test-Path -LiteralPath $statePath)) { throw "Publisher returned success but publication-state.json is missing." }
  $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($state.status -ne "published") { throw "Publication state is not fully confirmed: $($state.status)" }
  $summary = [ordered]@{
    runId = $stamp
    startedAt = $started.ToString("o")
    completedAt = (Get-Date).ToString("o")
    status = "published"
    topicId = $payload.topicId
    title = $payload.title
    package = $package.FullName
    mediaUrl = $payload.mediaUrl
    youtubeUrl = $state.platforms.youtube.url
    facebookUrl = $state.platforms.facebook.url
    log = $log
  }
  $summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $logDir "$stamp-result.json") -Encoding UTF8
  Write-Host "VYROX_DAILY_RUN_PUBLISHED_SUCCESSFULLY" -ForegroundColor Green
  Write-Host ("YouTube: " + $state.platforms.youtube.url)
  Write-Host ("Facebook: " + $state.platforms.facebook.url)
  exit 0
}
catch {
  Write-Error $_
  try {
    [ordered]@{ runId=$stamp; completedAt=(Get-Date).ToString("o"); status="failed"; error=$_.Exception.Message; log=$log } |
      ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $logDir "$stamp-result.json") -Encoding UTF8
  } catch {}
  exit 1
}
finally {
  try { Stop-Transcript | Out-Null } catch {}
  if ($hasLock) { try { $mutex.ReleaseMutex() } catch {} }
  $mutex.Dispose()
}

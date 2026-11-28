[CmdletBinding()]
param(
  [string]$SpecPath = (Join-Path $PSScriptRoot "..\examples\free-video-project.json"),
  [string]$OutputDir = (Join-Path $PSScriptRoot "..\media-output"),
  [switch]$AutoTopic,
  [ValidateSet("any", "science", "technology")][string]$TopicCategory = "any",
  [string]$TopicHistoryPath = (Join-Path $PSScriptRoot "..\topic-history.txt"),
  [switch]$CreateMetricoolPackage
)

$ErrorActionPreference = "Stop"
# Force UTF-8 for Arabic output on Windows PowerShell 5.1.
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"
$repoRoot = Split-Path -Parent $PSScriptRoot
$worker = Join-Path $PSScriptRoot "free_video_studio.py"
$requirements = Join-Path $repoRoot "requirements-free-video.txt"
$SpecPath = [IO.Path]::GetFullPath($SpecPath)
$OutputDir = [IO.Path]::GetFullPath($OutputDir)

try {
  chcp 65001 | Out-Null
  [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  $OutputEncoding = [Console]::OutputEncoding
} catch {}

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
  throw "Python Launcher (py.exe) was not found. Install Python 3.12 and enable the Python Launcher."
}
& py -3.12 --version
if ($LASTEXITCODE -ne 0) {
  throw "Python 3.12 is required. This script deliberately avoids the newer experimental Python runtimes."
}

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue) -or
    -not (Get-Command ffprobe -ErrorAction SilentlyContinue)) {
  throw "FFmpeg and FFprobe must be installed and available on PATH."
}
if ($AutoTopic) {
  $planner = Join-Path $PSScriptRoot "topic_seo_planner.py"
  # Self-heal an incomplete local installation by restoring the planner from
  # the same pinned project branch. Validate UTF-8 and required CLI markers
  # before replacing/creating the local file; never overwrite a valid planner.
  if (-not (Test-Path -LiteralPath $planner)) {
    $plannerUrl = "https://raw.githubusercontent.com/1xnolosser-crypto/merger/feat/free-hybrid-video-studio/scripts/topic_seo_planner.py"
    $plannerTemp = $planner + ".download"
    try {
      Invoke-WebRequest -Uri $plannerUrl -OutFile $plannerTemp -UseBasicParsing -Headers @{ "Cache-Control" = "no-cache" }
      if (-not (Test-Path -LiteralPath $plannerTemp) -or (Get-Item -LiteralPath $plannerTemp).Length -lt 3000) {
        throw "Topic planner download failed size validation."
      }
      $plannerBytes = [IO.File]::ReadAllBytes($plannerTemp)
      $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
      $plannerText = $strictUtf8.GetString($plannerBytes)
      if ($plannerText -notmatch 'CATALOG' -or $plannerText -notmatch 'topic-history.txt' -or $plannerText -notmatch 'selectedTopic') {
        throw "Downloaded topic planner failed content validation."
      }
      $null = & py -3.12 -m py_compile $plannerTemp 2>&1
      if ($LASTEXITCODE -ne 0) { throw "Downloaded topic planner failed Python syntax validation." }
      Move-Item -LiteralPath $plannerTemp -Destination $planner -Force
      Write-Host "Restored missing topic SEO planner from the project repository." -ForegroundColor Green
    } finally {
      Remove-Item -LiteralPath $plannerTemp -Force -ErrorAction SilentlyContinue
    }
  }
  $SpecPath = Join-Path $OutputDir "auto-topic-project.json"
  Write-Host "Selecting a fresh Arabic Shorts topic and preparing SEO metadata..." -ForegroundColor Cyan
  $TopicHistoryPath = [IO.Path]::GetFullPath($TopicHistoryPath)
  & py -3.12 $planner --output $SpecPath --category $TopicCategory --history $TopicHistoryPath
  if ($LASTEXITCODE -ne 0) {
    throw "Automatic topic selection failed. No video generation was started."
  }
}
if (-not (Test-Path -LiteralPath $SpecPath)) {
  throw "Video specification not found: $SpecPath"
}

# Detect the package without importing it. The check always exits cleanly
# when edge-tts is absent, which is important for Windows PowerShell 5.1.
$edgeCheckOutput = & py -3.12 -c "import importlib.util; print('EDGE_TTS_PRESENT' if importlib.util.find_spec('edge_tts') else 'EDGE_TTS_MISSING')" 2>&1
$edgeCheckCode = $LASTEXITCODE
$edgeCheckText = ($edgeCheckOutput | Out-String).Trim()

if ($edgeCheckCode -ne 0) {
  throw "Python could not run the dependency check. Verify Python 3.12 installation."
}

if ($edgeCheckText -notmatch "EDGE_TTS_PRESENT") {
  Write-Host "Installing the free Edge TTS helper (no API key or subscription)..." -ForegroundColor Cyan

  # Windows PowerShell 5.1 can convert native stderr warnings into terminating
  # NativeCommandError records when ErrorActionPreference is Stop. Redirect both
  # streams to files with Start-Process, then inspect the real process exit code.
  $pipOut = Join-Path $env:TEMP ("merger-pip-out-" + [guid]::NewGuid().ToString("N") + ".txt")
  $pipErr = Join-Path $env:TEMP ("merger-pip-err-" + [guid]::NewGuid().ToString("N") + ".txt")
  try {
    $pipArgs = "-3.12 -m pip install --user -r `"$requirements`""
    $pipProcess = Start-Process -FilePath "py.exe" -ArgumentList $pipArgs -Wait -PassThru -NoNewWindow -RedirectStandardOutput $pipOut -RedirectStandardError $pipErr

    if (Test-Path $pipOut) {
      Get-Content -LiteralPath $pipOut | ForEach-Object { Write-Host ([string]$_) }
    }
    if (Test-Path $pipErr) {
      Get-Content -LiteralPath $pipErr | ForEach-Object { Write-Host ([string]$_) }
    }
    if ($pipProcess.ExitCode -ne 0) {
      throw "pip installation failed with exit code $($pipProcess.ExitCode)."
    }
  }
  finally {
    Remove-Item -LiteralPath $pipOut,$pipErr -Force -ErrorAction SilentlyContinue
  }

  $verifyOutput = & py -3.12 -c "import importlib.util; print('EDGE_TTS_READY' if importlib.util.find_spec('edge_tts') else 'EDGE_TTS_MISSING')" 2>&1
  $verifyCode = $LASTEXITCODE
  $verifyText = ($verifyOutput | Out-String).Trim()
  if ($verifyCode -ne 0 -or $verifyText -notmatch "EDGE_TTS_READY") {
    throw "edge-tts installation could not be verified."
  }
  Write-Host "edge-tts is ready." -ForegroundColor Green
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Write-Host "Starting the free local video studio..." -ForegroundColor Green
& py -3.12 $worker --spec $SpecPath --output $OutputDir
if ($LASTEXITCODE -ne 0) {
  throw "Video generation stopped with exit code $LASTEXITCODE."
}

# Keep the rendered MP4 local. No external video hosting or transformation service is used.
$finalVideo = Get-ChildItem -LiteralPath $OutputDir -Recurse -File |
  Where-Object { $_.Name -match '-(shorts|video)\.mp4$' } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $finalVideo) {
  throw "Video was rendered but the final local MP4 could not be located."
}
Write-Host "LOCAL VIDEO READY" -ForegroundColor Green
Write-Host ("Local MP4: " + $finalVideo.FullName)
Write-Host ("File size: " + [math]::Round($finalVideo.Length / 1MB, 2) + " MB")

# Build a deterministic SEO/social handoff package only when explicitly requested.
if ($CreateMetricoolPackage) {
$spec = Get-Content -LiteralPath $SpecPath -Raw -Encoding UTF8 | ConvertFrom-Json
$title = [string]$spec.title
$narration = @($spec.scenes | ForEach-Object { ([string]$_.narration).Trim() }) -join " "
$slug = ($title -replace "[^\p{L}\p{Nd}]+", "_").Trim([char[]]"_")
$seo = $spec.seo
$hashtags = if ($seo -and $seo.hashtags) { @($seo.hashtags) } else { @("#$($slug)", "#Science", "#Facts", "#Shorts", "#VYROX") }
$captionLead = if ($seo -and $seo.descriptionLead) { [string]$seo.descriptionLead } else { $narration }
$caption = "$title`n`n$captionLead`n`n$narration`n`nFollow VYROX for more short videos.`n`n$($hashtags -join " ")"
$seoTitle = if ($seo -and $seo.youtubeTitle) { [string]$seo.youtubeTitle } else { "$title | Short Science Facts #Shorts" }
$seoTags = if ($seo -and $seo.tags) { @($seo.tags) } else { @($title, "Science", "Education", "Nature", "VYROX") }
$attribution = Join-Path $finalVideo.DirectoryName "video-description-and-attribution.txt"
$attributionText = if (Test-Path -LiteralPath $attribution) { Get-Content -LiteralPath $attribution -Raw -Encoding UTF8 } else { "" }
$package = [ordered]@{
  schemaVersion = 1
  status = "ready_for_direct_scheduling"
  generatedAt = (Get-Date).ToString("o")
  title = $title
  youtubeTitle = $seoTitle
  description = ($caption + "`n`n" + $attributionText)
  caption = $caption
  hashtags = $hashtags
  tags = $seoTags
  primaryKeyword = if ($seo) { [string]$seo.primaryKeyword } else { $title }
  relatedKeywords = if ($seo) { @($seo.relatedKeywords) } else { @() }
  topicId = if ($spec.topicId) { [string]$spec.topicId } else { "" }
  editorial = if ($spec.editorial) { $spec.editorial } else { $null }
  localVideoPath = $finalVideo.FullName
  fileSizeBytes = [long]$finalVideo.Length
  attributionFile = $attribution
  platforms = @("youtube_short", "facebook_reel")
  publication = @{ timezone = "Africa/Cairo"; requiresDirectPlatformScheduling = $true }
}
$packagePath = Join-Path $finalVideo.DirectoryName "metricool-publish-package.json"
$package | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $packagePath -Encoding UTF8
Write-Host "PUBLISH PACKAGE CREATED" -ForegroundColor Green
Write-Host ("Metricool package: " + $packagePath)
Write-Host "The package contains the local MP4 path, SEO title, caption, hashtags, tags and image attribution."
}

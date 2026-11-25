[CmdletBinding()]
param(
  [string]$SpecPath = (Join-Path $PSScriptRoot "..\examples\free-video-project.json"),
  [string]$OutputDir = (Join-Path $PSScriptRoot "..\media-output")
)

$ErrorActionPreference = "Stop"
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

# Upload the newly rendered final MP4 directly into the ImageKit Media Library.
# The private key is requested once and stored only in the current Windows user's
# environment variables by setup-imagekit.ps1; it is never committed to the repo.
$finalVideo = Get-ChildItem -LiteralPath $OutputDir -Recurse -File |
  Where-Object { $_.Name -match '-(shorts|video)\.mp4$' } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $finalVideo) {
  throw "Video was rendered but the final MP4 could not be located for ImageKit upload."
}

if (-not $env:IMAGEKIT_PRIVATE_KEY) {
  $setupScript = Join-Path $PSScriptRoot "setup-imagekit.ps1"
  & $setupScript
  if (-not $env:IMAGEKIT_PRIVATE_KEY) {
    $env:IMAGEKIT_PRIVATE_KEY = [Environment]::GetEnvironmentVariable("IMAGEKIT_PRIVATE_KEY", "User")
  }
}
if (-not $env:IMAGEKIT_PRIVATE_KEY) {
  throw "ImageKit key setup did not complete. The video remains safely in the local output folder."
}

$imageKitClient = Join-Path $PSScriptRoot "imagekit_media_library.py"
Write-Host "Uploading final video to the ImageKit Media Library..." -ForegroundColor Cyan
$uploadJson = & py -3.12 $imageKitClient upload $finalVideo.FullName --folder "/VYROX/Shorts" --tag "VYROX" --tag "Shorts" --tag "Arabic"
if ($LASTEXITCODE -ne 0) {
  throw "ImageKit upload failed. The local video was preserved at: $($finalVideo.FullName)"
}
$uploadResult = ($uploadJson -join [Environment]::NewLine) | ConvertFrom-Json
if (-not $uploadResult.url) {
  throw "ImageKit returned a response without a public file URL. Review the upload response."
}
Write-Host "IMAGEKIT UPLOAD SUCCESSFUL" -ForegroundColor Green
Write-Host ("Media Library URL: " + $uploadResult.url)
Write-Host ("ImageKit File ID: " + $uploadResult.fileId)

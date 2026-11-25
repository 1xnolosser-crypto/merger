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
  $installOutput = & py -3.12 -m pip install --user -r $requirements 2>&1
  $installCode = $LASTEXITCODE
  $installOutput | ForEach-Object { Write-Host ([string]$_) }
  if ($installCode -ne 0) { throw "Could not install edge-tts. See pip output above." }

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

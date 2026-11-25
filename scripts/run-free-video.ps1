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

# Capture stderr as text so PowerShell's Stop preference does not abort
# on the expected first-run ModuleNotFoundError from the import check.
$edgeCheckOutput = & py -3.12 -c "import edge_tts" 2>&1
$edgeCheckCode = $LASTEXITCODE

if ($edgeCheckCode -ne 0) {
  Write-Host "Installing the free Edge TTS helper (no API key or subscription)..." -ForegroundColor Cyan
  $installOutput = & py -3.12 -m pip install --user -r $requirements 2>&1
  $installCode = $LASTEXITCODE
  $installOutput | ForEach-Object { Write-Host ([string]$_) }
  if ($installCode -ne 0) { throw "Could not install edge-tts. See pip output above." }

  $verifyOutput = & py -3.12 -c "import edge_tts; print('edge-tts ready')" 2>&1
  $verifyCode = $LASTEXITCODE
  $verifyOutput | ForEach-Object { Write-Host ([string]$_) }
  if ($verifyCode -ne 0) { throw "edge-tts installation could not be verified." }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Write-Host "Starting the free local video studio..." -ForegroundColor Green
& py -3.12 $worker --spec $SpecPath --output $OutputDir
if ($LASTEXITCODE -ne 0) {
  throw "Video generation stopped with exit code $LASTEXITCODE."
}

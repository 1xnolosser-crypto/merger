[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$BaseUrl,
  [string]$OutputDir = (Join-Path $PSScriptRoot '..\renders'),
  [string]$FfmpegPath = 'ffmpeg',
  [switch]$Once,
  [int]$PollSeconds = 8
)
$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$Token = [Environment]::GetEnvironmentVariable('STUDIO_WORKER_TOKEN', 'Process')
if (-not $Token) { $Token = Read-Host 'Paste STUDIO_WORKER_TOKEN (input is not saved)' }
if ([string]::IsNullOrWhiteSpace($Token) -or $Token.Length -lt 32) { throw 'STUDIO_WORKER_TOKEN must be at least 32 characters.' }

function Invoke-StudioApi([string]$Path, [object]$Body) {
  $json = $Body | ConvertTo-Json -Depth 20 -Compress
  return Invoke-RestMethod -Uri ($BaseUrl + $Path) -Method Post -Headers @{ Authorization = "Bearer $Token" } -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 60
}
function Invoke-FFmpeg([string[]]$Arguments) {
  & $FfmpegPath @Arguments
  if ($LASTEXITCODE -ne 0) { throw "FFmpeg exited with code $LASTEXITCODE" }
}
function Escape-FilterPath([string]$Path) {
  $p = [IO.Path]::GetFullPath($Path).Replace('\','/')
  return $p.Replace(':','\:').Replace("'", "\'")
}
function Render-StudioJob($Job) {
  $p = $Job.params
  $jobId = [string]$Job.task_id
  $safeId = ($jobId -replace '[^A-Za-z0-9_-]', '')
  $jobDir = Join-Path $OutputDir $safeId
  New-Item -ItemType Directory -Force -Path $jobDir | Out-Null
  $isShort = $p.format -eq 'shorts'
  $base = if ($p.resolution -eq '1080p') { 1080 } else { 720 }
  $width = if ($isShort) { $base } else { [int]($base * 16 / 9) }
  $height = if ($isShort) { [int]($base * 16 / 9) } else { $base }
  $concatFile = Join-Path $jobDir 'concat.txt'
  $segmentCount = $p.scenes.Count
  [IO.File]::WriteAllText($concatFile, '', [Text.UTF8Encoding]::new($false))
  for ($i = 0; $i -lt $segmentCount; $i++) {
    $scene = $p.scenes[$i]
    $duration = [int]$scene.durationSeconds
    $segment = Join-Path $jobDir (('scene-{0:D3}.mp4' -f ($i + 1)))
    $textFile = Join-Path $jobDir (('scene-{0:D3}.txt' -f ($i + 1)))
    [IO.File]::WriteAllText($textFile, [string]$scene.text, [Text.UTF8Encoding]::new($false))
    $textPath = Escape-FilterPath $textFile
    $draw = "drawtext=font='Arial':textfile='$textPath':fontcolor=white:fontsize=48:line_spacing=14:box=1:boxcolor=black@0.48:boxborderw=26:x=(w-text_w)/2:y=h*0.72"
    $imagePath = [string]$scene.imagePath
    if ($imagePath -and (Test-Path -LiteralPath $imagePath -PathType Leaf)) {
      $vf = "scale=\${width}:\${height}:force_original_aspect_ratio=increase,crop=\${width}:\${height},setsar=1,\${draw}"
      Invoke-FFmpeg @('-y','-hide_banner','-loglevel','error','-loop','1','-framerate','30','-i',$imagePath,'-vf',$vf,'-t',([string]$duration),'-r','30','-an','-c:v','libx264','-preset','ultrafast','-crf','23','-pix_fmt','yuv420p',$segment)
    } else {
      $color = if ($isShort) { '0x101827' } else { '0x111827' }
      $vf = $draw
      Invoke-FFmpeg @('-y','-hide_banner','-loglevel','error','-f','lavfi','-i',"color=c=\${color}:s=\${width}x\${height}:r=30:d=\${duration}",'-vf',$vf,'-t',([string]$duration),'-an','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p',$segment)
    }
    $escapedSegment = $segment.Replace('\','/').Replace("'","'\'")
    [IO.File]::AppendAllText($concatFile, "file '$escapedSegment'`n", [Text.UTF8Encoding]::new($false))
    $progress = [Math]::Min(85, 10 + [int](75 * (($i + 1) / $segmentCount)))
    try { Invoke-StudioApi '/api/studio/worker/progress' @{ task_id=$jobId; progress=$progress } | Out-Null } catch { Write-Warning "Progress update failed: $($_.Exception.Message)" }
    Write-Host ("Rendered scene {0}/{1}" -f ($i + 1), $segmentCount)
  }
  $baseVideo = Join-Path $jobDir 'assembled-video.mp4'
  Invoke-FFmpeg @('-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',$concatFile,'-c','copy','-movflags','+faststart',$baseVideo)
  $outputName = if ($p.format -eq 'shorts') { 'shorts.mp4' } else { 'long-video.mp4' }
  $outputPath = Join-Path $jobDir $outputName
  $narration = [string]$p.narrationPath
  if ($narration) {
    if (-not (Test-Path -LiteralPath $narration -PathType Leaf)) { throw "Narration file not found: $narration" }
    Invoke-FFmpeg @('-y','-hide_banner','-loglevel','error','-i',$baseVideo,'-i',$narration,'-map','0:v:0','-map','1:a:0','-c:v','copy','-af','apad','-c:a','aac','-b:a','160k','-shortest','-movflags','+faststart',$outputPath)
  } else {
    Copy-Item -LiteralPath $baseVideo -Destination $outputPath -Force
    Write-Warning 'No narrationPath was supplied; this is a silent visual draft.'
  }
  if (-not (Test-Path -LiteralPath $outputPath) -or (Get-Item -LiteralPath $outputPath).Length -lt 1024) { throw 'Rendered file is missing or unexpectedly small.' }
  return (Get-Item -LiteralPath $outputPath).FullName
}
Write-Host 'Merger local studio worker started. No paid provider is called.' -ForegroundColor Green
Write-Host "Output folder: $([IO.Path]::GetFullPath($OutputDir))"
while ($true) {
  try {
    $claim = Invoke-StudioApi '/api/studio/worker/claim' @{}
    if (-not $claim.job) {
      if ($Once) { break }
      Start-Sleep -Seconds $PollSeconds
      continue
    }
    $job = $claim.job
    Write-Host "Claimed $($job.task_id): $($job.params.title)"
    try {
      $path = Render-StudioJob $job
      Invoke-StudioApi '/api/studio/worker/complete' @{ task_id=$job.task_id; status='succeeded'; local_path=$path } | Out-Null
      Write-Host "Completed: $path" -ForegroundColor Green
    } catch {
      $message = $_.Exception.Message
      Write-Error "Render failed for $($job.task_id): $message"
      try { Invoke-StudioApi '/api/studio/worker/complete' @{ task_id=$job.task_id; status='failed'; error=$message } | Out-Null } catch { Write-Error "Could not report failure: $($_.Exception.Message)" }
    }
    if ($Once) { break }
  } catch {
    Write-Warning "Worker request failed: $($_.Exception.Message)"
    if ($Once) { throw }
    Start-Sleep -Seconds ([Math]::Max(5,$PollSeconds))
  }
}

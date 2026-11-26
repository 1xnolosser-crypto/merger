[CmdletBinding()]
param(
  [ValidatePattern("^([01]\d|2[0-3]):[0-5]\d$")]
  [string]$DailyTime = "10:00",
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = "Stop"
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$runner = Join-Path $ProjectRoot "scripts\run-daily-vyrox.ps1"
if (-not (Test-Path -LiteralPath $runner)) { throw "Daily runner not found: $runner" }
$py = Get-Command py.exe -ErrorAction SilentlyContinue
$ffmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
$ffprobe = Get-Command ffprobe.exe -ErrorAction SilentlyContinue
if (-not $py -or -not $ffmpeg -or -not $ffprobe) { throw "Install Python 3.12 launcher, FFmpeg and FFprobe and ensure they are on PATH before registering the task." }
$key = [Environment]::GetEnvironmentVariable("IMAGEKIT_PRIVATE_KEY", "User")
if (-not $key) { throw "ImageKit key is missing from the current Windows user's environment. Run scripts\setup-imagekit.ps1 once, then rerun this installer." }
$publisher = Join-Path $ProjectRoot "scripts\publish_social.py"
if (-not (Test-Path -LiteralPath $publisher)) { throw "Social publisher is missing. Run the VYROX social publishing installer first." }
& py -3.12 $publisher check --page-id "1574613545729181"
if ($LASTEXITCODE -ne 0) { throw "YouTube and Facebook credentials are not ready. Complete the one-time authorization steps before enabling daily publication." }
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -ProjectRoot `"$ProjectRoot`""
$trigger = New-ScheduledTaskTrigger -Daily -At ([DateTime]::ParseExact($DailyTime, "HH:mm", [Globalization.CultureInfo]::InvariantCulture))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "VYROX Daily Video Production" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Creates a fresh VYROX short, uploads it to ImageKit, then publishes to YouTube Shorts and Facebook Reels through official APIs." -Force | Out-Null
Write-Host "Scheduled task installed for every day at $DailyTime (local Windows time)." -ForegroundColor Green
Write-Host "The Windows account must be signed in and the PC awake/online. Sleep/hibernation and network/service outages can delay or fail a run."
Write-Host "Task Scheduler runs local production, ImageKit upload, and confirmed official API publication to both configured social platforms."
Write-Host "Run once now with: Start-ScheduledTask -TaskName 'VYROX Daily Video Production'"

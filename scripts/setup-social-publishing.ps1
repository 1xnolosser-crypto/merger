[CmdletBinding()]
param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = "Stop"
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$requirements = Join-Path $ProjectRoot "requirements-social-publishing.txt"
$secrets = Join-Path $ProjectRoot "secrets"
New-Item -ItemType Directory -Force -Path $secrets | Out-Null
Write-Host "Installing the free official API client libraries for Python 3.12..." -ForegroundColor Cyan
& py -3.12 -m pip install --user -r $requirements
if ($LASTEXITCODE -ne 0) { throw "Social publishing dependency installation failed." }
# Restrict local OAuth files to the current Windows account.
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $secrets /inheritance:r /grant:r "$($account):(OI)(CI)F" "SYSTEM:(OI)(CI)F" | Out-Null
Write-Host "Social publishing libraries installed; local secrets folder created." -ForegroundColor Green
Write-Host "Next: place your Google OAuth Desktop client JSON at:"
Write-Host "  $secrets\youtube-client-secrets.json"
Write-Host "Then run:"
Write-Host "  py -3.12 scripts\publish_social.py authorize-youtube"
Write-Host "  py -3.12 scripts\publish_social.py configure-facebook"
Write-Host "Secrets are not written to the Git repository."

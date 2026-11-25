[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$existing = [Environment]::GetEnvironmentVariable("IMAGEKIT_PRIVATE_KEY", "User")
if ($existing -and $existing.StartsWith("private_")) {
  Write-Host "ImageKit private key is already configured for this Windows user." -ForegroundColor Green
  exit 0
}
Write-Host "Paste the ImageKit PRIVATE key when prompted. It will be entered securely and stored only in your Windows user environment, not in project files or GitHub." -ForegroundColor Cyan
$secure = Read-Host "ImageKit private API key" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  if (-not $plain.StartsWith("private_")) { throw "The key must start with private_. No value was saved." }
  [Environment]::SetEnvironmentVariable("IMAGEKIT_PRIVATE_KEY", $plain, "User")
  $env:IMAGEKIT_PRIVATE_KEY = $plain
  Write-Host "Saved securely in the current Windows user's environment." -ForegroundColor Green
}
finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  $plain = $null
}

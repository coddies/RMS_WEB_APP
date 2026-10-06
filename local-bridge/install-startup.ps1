param(
  [string]$NodePath = "node.exe"
)

$ErrorActionPreference = "Stop"
$bridgeDir = $PSScriptRoot
$serverPath = Join-Path $bridgeDir "server.mjs"
$configPath = Join-Path $bridgeDir ".env"

if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Create local-bridge/.env from .env.example and set the bridge token, Supabase settings, tenant slug, and printer first."
}

$resolvedNode = (Get-Command $NodePath -ErrorAction Stop).Source
$nodeVersion = & $resolvedNode --version
if ($nodeVersion -notmatch '^v?(\d+)\.' -or [int]$Matches[1] -lt 22) {
  throw "The local bridge requires Node.js 22 or newer for its built-in SQLite support. Found: $nodeVersion"
}
$action = New-ScheduledTaskAction -Execute $resolvedNode -Argument ('"' + $serverPath + '"') -WorkingDirectory $bridgeDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "RMS Local Bridge" -Action $action -Trigger $trigger -Settings $settings -Description "Starts the restaurant's local SQLite and printer bridge at sign-in." -Force | Out-Null
Start-ScheduledTask -TaskName "RMS Local Bridge"
Write-Host "RMS Local Bridge is registered to start at sign-in and has been started."

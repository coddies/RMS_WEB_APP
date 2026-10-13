param(
  [string]$InnoSetupCompilerPath = $env:INNO_SETUP_ISCC,
  [string]$NodeVersion = '24.18.0',
  [string]$WinSWVersion = '2.12.0'
)

$ErrorActionPreference = 'Stop'
$installerDir = $PSScriptRoot
$bridgeDir = Split-Path -Parent $installerDir
$projectRoot = Split-Path -Parent $bridgeDir
$toolsDir = Join-Path $installerDir 'build-tools'
$payloadDir = Join-Path $installerDir 'payload'
$runtimeDir = Join-Path $payloadDir 'runtime'
$serviceDir = Join-Path $payloadDir 'service'
$distDir = Join-Path $installerDir 'dist'
$issFile = Join-Path $installerDir 'RMSLocalBridge.iss'

$envFile = Join-Path $projectRoot '.env.local'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'Project .env.local is required to bake the public Supabase settings into the installer.' }
$projectEnv = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $value = $Matches[2].Trim().Trim('"').Trim("'")
    $projectEnv[$Matches[1]] = $value
  }
}
$supabaseUrl = $projectEnv['NEXT_PUBLIC_SUPABASE_URL']
$publishableKey = $projectEnv['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']
if (-not $publishableKey) { $publishableKey = $projectEnv['NEXT_PUBLIC_SUPABASE_ANON_KEY'] }
$webAppUrl = $projectEnv['RMS_WEB_APP_URL']
if (-not $webAppUrl) { $webAppUrl = $env:RMS_BUILD_WEB_APP_URL }
$parsedSupabaseUrl = $null
if (-not [Uri]::TryCreate($supabaseUrl, [UriKind]::Absolute, [ref]$parsedSupabaseUrl) -or $parsedSupabaseUrl.Scheme -ne 'https') { throw 'NEXT_PUBLIC_SUPABASE_URL must be an HTTPS URL.' }
if (-not $publishableKey -or $publishableKey.Length -lt 20 -or $publishableKey -match '[\r\n"]') { throw 'A valid public anon/publishable key is required in the project .env.local.' }
$parsedWebUrl = $null
if (-not [Uri]::TryCreate($webAppUrl, [UriKind]::Absolute, [ref]$parsedWebUrl) -or $parsedWebUrl.Scheme -ne 'https' -or $parsedWebUrl.IsLoopback) { throw 'Set RMS_WEB_APP_URL to the deployed HTTPS Vercel app URL in .env.local (or RMS_BUILD_WEB_APP_URL before building).' }
$env:RMS_BUILD_SUPABASE_URL = $supabaseUrl.TrimEnd('/')
$env:RMS_BUILD_SUPABASE_PUBLISHABLE_KEY = $publishableKey
$env:RMS_BUILD_WEB_APP_URL = $parsedWebUrl.AbsoluteUri.TrimEnd('/')

New-Item -ItemType Directory -Force -Path $toolsDir, $runtimeDir, $serviceDir, $distDir | Out-Null

# ── Build native counter host (RMSCounter.exe) ────────────────────────────────
# The .exe is a compiled C# launcher that runs the WPF UI without showing a
# PowerShell or console window. Build it fresh so the installer always bundles
# the latest version.
$desktopAppDir   = Join-Path $bridgeDir 'desktop-app'
$counterExeSrc   = Join-Path $desktopAppDir 'dist\RMSCounter.exe'
$counterIcoSrc   = Join-Path $desktopAppDir 'dist\RMSCounter.ico'
$buildLocalApp   = Join-Path $desktopAppDir 'build-local-app.ps1'
Write-Host 'Building native counter host (RMSCounter.exe)...'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $buildLocalApp
if ($LASTEXITCODE -ne 0) { throw 'Failed to compile RMSCounter.exe. Ensure .NET Framework 4.x is installed.' }
if (-not (Test-Path -LiteralPath $counterExeSrc)) { throw "build-local-app.ps1 completed but RMSCounter.exe was not found at: $counterExeSrc" }
Write-Host "Counter host ready: $counterExeSrc"
# ─────────────────────────────────────────────────────────────────────────────

if (-not $InnoSetupCompilerPath) {
  $InnoSetupCompilerPath = (Get-Command 'ISCC.exe' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
}
if (-not $InnoSetupCompilerPath -or -not (Test-Path -LiteralPath $InnoSetupCompilerPath)) {
  $toolsCandidate = Join-Path $toolsDir 'innosetup\ISCC.exe'
  if (Test-Path -LiteralPath $toolsCandidate) { $InnoSetupCompilerPath = $toolsCandidate }
}
if (-not $InnoSetupCompilerPath -or -not (Test-Path -LiteralPath $InnoSetupCompilerPath)) {
  $candidate = Join-Path $env:LOCALAPPDATA 'Programs\Antigravity IDE\resources\app\node_modules\innosetup\bin\ISCC.exe'
  if (Test-Path -LiteralPath $candidate) { $InnoSetupCompilerPath = $candidate }
}
if (-not $InnoSetupCompilerPath -or -not (Test-Path -LiteralPath $InnoSetupCompilerPath)) {
  throw 'Inno Setup compiler not found. Install Inno Setup on a non-C: drive and pass -InnoSetupCompilerPath "<drive>:\path\ISCC.exe".'
}

$nodeZip = Join-Path $toolsDir "node-v$NodeVersion-win-x64.zip"
$nodeHashList = Join-Path $toolsDir "node-v$NodeVersion-SHASUMS256.txt"
$nodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
$hashUrl = "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt"
if (-not (Test-Path -LiteralPath $nodeZip)) { Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip }
if (-not (Test-Path -LiteralPath $nodeHashList)) { Invoke-WebRequest -Uri $hashUrl -OutFile $nodeHashList }
$expectedNodeHash = ((Get-Content -LiteralPath $nodeHashList) | Where-Object { $_ -match "\snode-v$([regex]::Escape($NodeVersion))-win-x64\.zip$" } | Select-Object -First 1) -replace '\s.*$', ''
if (-not $expectedNodeHash) { throw "Official Node.js SHA256 entry not found for $nodeZip." }
$actualNodeHash = (Get-FileHash -LiteralPath $nodeZip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualNodeHash -ne $expectedNodeHash.ToLowerInvariant()) { throw 'The downloaded Node.js archive does not match its official SHA256 checksum.' }

$extractDir = Join-Path $toolsDir "node-v$NodeVersion-extracted"
if (Test-Path -LiteralPath $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force }
Expand-Archive -LiteralPath $nodeZip -DestinationPath $extractDir -Force
$nodeSourceDir = Join-Path $extractDir "node-v$NodeVersion-win-x64"
Copy-Item -LiteralPath (Join-Path $nodeSourceDir 'node.exe') -Destination (Join-Path $runtimeDir 'node.exe') -Force
Copy-Item -LiteralPath (Join-Path $nodeSourceDir 'LICENSE') -Destination (Join-Path $runtimeDir 'LICENSE') -Force

$winSwExe = Join-Path $toolsDir "WinSW-x64-v$WinSWVersion.exe"
$winSwUrl = "https://github.com/winsw/winsw/releases/download/v$WinSWVersion/WinSW-x64.exe"
$winSwExpectedHash = '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da'
if (-not (Test-Path -LiteralPath $winSwExe)) { Invoke-WebRequest -Uri $winSwUrl -OutFile $winSwExe }
$winSwActualHash = (Get-FileHash -LiteralPath $winSwExe -Algorithm SHA256).Hash.ToLowerInvariant()
if ($winSwActualHash -ne $winSwExpectedHash) { throw 'WinSW binary checksum mismatch; refusing to package it.' }
Copy-Item -LiteralPath $winSwExe -Destination (Join-Path $serviceDir 'RMSLocalBridge.exe') -Force

$winswLicense = @'
WinSW is distributed under the MIT License.
Copyright (c) 2013-2024 Winsw contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
'@
Set-Content -LiteralPath (Join-Path $serviceDir 'WinSW-LICENSE.txt') -Value $winswLicense -Encoding utf8

$arguments = @(
  "/DSourceRoot=$bridgeDir"
  "/DPayloadDir=$payloadDir"
  "/DOutputDir=$distDir"
  $issFile
)
& $InnoSetupCompilerPath @arguments
$env:RMS_BUILD_SUPABASE_URL = $null
$env:RMS_BUILD_SUPABASE_PUBLISHABLE_KEY = $null
$env:RMS_BUILD_WEB_APP_URL = $null
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compiler failed with exit code $LASTEXITCODE." }

$installer = Join-Path $distDir 'RMSLocalBridgeSetup-1.1.5.exe'
if (-not (Test-Path -LiteralPath $installer)) { throw 'Compiler returned success but the installer executable was not created.' }
Copy-Item -LiteralPath $installer -Destination (Join-Path $distDir 'RMSLocalBridgeSetup.exe') -Force
Write-Host "Created installable package: $installer"

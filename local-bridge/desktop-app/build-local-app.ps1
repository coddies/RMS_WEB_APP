$ErrorActionPreference = 'Stop'
$appDir = $PSScriptRoot
$bridgeDir = Split-Path -Parent $appDir
$outputDir = Join-Path $appDir 'dist'
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
$powershellAssembly = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\System.Management.Automation.dll'
if (-not (Test-Path -LiteralPath $powershellAssembly)) {
  $gacAssembly = Get-ChildItem -Path (Join-Path $env:WINDIR 'Microsoft.NET\assembly\GAC_MSIL\System.Management.Automation') -Filter 'System.Management.Automation.dll' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($gacAssembly) { $powershellAssembly = $gacAssembly.FullName }
}
if (-not (Test-Path -LiteralPath $powershellAssembly)) {
  $runtimeAssembly = Join-Path $PSHOME 'System.Management.Automation.dll'
  if (Test-Path -LiteralPath $runtimeAssembly) { $powershellAssembly = $runtimeAssembly }
}
$iconPath = Join-Path $appDir 'RMSCounter.ico'

if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework C# compiler is required.' }
if (-not (Test-Path -LiteralPath $powershellAssembly)) { throw 'Windows PowerShell 5.1 runtime assembly was not found.' }
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

if (-not (Test-Path -LiteralPath $iconPath)) {
  Add-Type -AssemblyName System.Drawing
  $bitmap = New-Object System.Drawing.Bitmap 64, 64
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(13, 13, 13))
  $redBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 38, 38))
  $graphics.FillEllipse($redBrush, 3, 3, 58, 58)
  $font = New-Object System.Drawing.Font('Segoe UI', 36, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $graphics.DrawString('R', $font, $brush, 13, 7)
  $handle = $bitmap.GetHicon()
  $icon = [System.Drawing.Icon]::FromHandle($handle)
  $stream = [System.IO.File]::Create($iconPath)
  try { $icon.Save($stream) } finally { $stream.Dispose(); $icon.Dispose(); $bitmap.Dispose(); $graphics.Dispose(); $font.Dispose(); $brush.Dispose(); $redBrush.Dispose() }
}

$references = @(
  (Join-Path $framework 'System.dll'),
  (Join-Path $framework 'System.Core.dll'),
  (Join-Path $framework 'System.Security.dll'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\WPF\WindowsBase.dll'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\WPF\PresentationCore.dll'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\WPF\PresentationFramework.dll'),
  (Join-Path $framework 'System.Xaml.dll'),
  $powershellAssembly
)
foreach ($reference in $references) { if (-not (Test-Path -LiteralPath $reference)) { throw "Required .NET assembly was not found: $reference" } }

$exe = Join-Path $outputDir 'RMSCounter.exe'
$args = @('/nologo', '/target:winexe', '/platform:anycpu', "/out:$exe", "/win32icon:$iconPath")
foreach ($reference in $references) { $args += "/reference:$reference" }
$args += (Join-Path $appDir 'RMSCounterHost.cs')
& $compiler @args
if ($LASTEXITCODE -ne 0) { throw "C# compile failed with exit code $LASTEXITCODE." }
Copy-Item -LiteralPath (Join-Path $bridgeDir 'counter-app.ps1') -Destination (Join-Path $outputDir 'counter-app.ps1') -Force
Copy-Item -LiteralPath $iconPath -Destination (Join-Path $outputDir 'RMSCounter.ico') -Force
Write-Host "Created Windows desktop app: $exe"

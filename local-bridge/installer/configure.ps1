param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir,
  [Parameter(Mandatory = $true)]
  [string]$SupabaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$PublishableKey,
  [Parameter(Mandatory = $true)]
  [string]$WebAppUrl
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function New-Label($text, $x, $y, $width = 430) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $text
  $label.Location = New-Object System.Drawing.Point($x, $y)
  $label.Size = New-Object System.Drawing.Size($width, 20)
  return $label
}

function New-TextBox($x, $y, $width = 430, $password = $false) {
  $box = New-Object System.Windows.Forms.TextBox
  $box.Location = New-Object System.Drawing.Point($x, $y)
  $box.Size = New-Object System.Drawing.Size($width, 24)
  $box.UseSystemPasswordChar = $password
  return $box
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'RMS Local Bridge Setup'
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ClientSize = New-Object System.Drawing.Size(480, 245)

$form.Controls.Add((New-Label 'Restaurant Pairing Key' 20 20))
$pairingKeyBox = New-TextBox 20 45 430 $true
$configPath = Join-Path $InstallDir '.env'
if (Test-Path -LiteralPath $configPath) {
  $existingPairingKey = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^RMS_LICENSE_KEY=((?:rms_[a-f0-9]{64}|[A-Z0-9\-_@]{10}))$' } | Select-Object -First 1
  if ($existingPairingKey -match '^RMS_LICENSE_KEY=(.+)$') { $pairingKeyBox.Text = $Matches[1] }
}
$form.Controls.Add($pairingKeyBox)

$help = New-Label 'Get this one-time key from your RMS administrator. Setup verifies it and registers this counter PC.' 20 83 440
$help.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($help)

$errorLabel = New-Label '' 20 120 440
$errorLabel.Size = New-Object System.Drawing.Size(440, 60)
$errorLabel.ForeColor = [System.Drawing.Color]::Firebrick
$form.Controls.Add($errorLabel)

$saveButton = New-Object System.Windows.Forms.Button
$saveButton.Text = 'Verify and install'
$saveButton.Location = New-Object System.Drawing.Point(326, 195)
$saveButton.Size = New-Object System.Drawing.Size(134, 32)
$form.Controls.Add($saveButton)
$form.AcceptButton = $saveButton

$saveButton.Add_Click({
  $saveButton.Enabled = $false
  $errorLabel.Text = ''
  try {
    $supabaseUrl = $SupabaseUrl.Trim().TrimEnd('/')
    $anonKey = $PublishableKey.Trim()
    $licenseKey = $pairingKeyBox.Text.Trim()
    $parsedUrl = $null
    if (-not [Uri]::TryCreate($supabaseUrl, [UriKind]::Absolute, [ref]$parsedUrl) -or $parsedUrl.Scheme -ne 'https') {
      throw 'The installer does not contain a valid HTTPS Supabase project URL.'
    }
    if ($anonKey -match '[\r\n]' -or $anonKey.Length -lt 20) {
      throw 'The installer does not contain a valid public anon/publishable key.'
    }
    $parsedWebUrl = $null
    if (-not [Uri]::TryCreate($WebAppUrl.Trim().TrimEnd('/'), [UriKind]::Absolute, [ref]$parsedWebUrl) -or $parsedWebUrl.Scheme -ne 'https') {
      throw 'The installer does not contain a valid HTTPS Vercel production URL.'
    }
    if ($licenseKey -notmatch '^rms_[a-f0-9]{64}$' -and $licenseKey -notmatch '^[A-Z0-9\-_@]{10}$') {
      throw 'Enter the complete 10-character or legacy restaurant Pairing Key supplied by your RMS administrator.'
    }

    $fingerprintSource = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid
    if (-not $fingerprintSource) { throw 'This PC did not provide a Windows machine fingerprint.' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $fingerprint = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($fingerprintSource)))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }

    $pairUri = "$supabaseUrl/rest/v1/rpc/rms_pair_local_bridge"
    $pairResult = Invoke-RestMethod -Method Post -Uri $pairUri -Headers @{
      apikey = $anonKey
      Authorization = "Bearer $anonKey"
      'Content-Type' = 'application/json'
    } -Body (@{ p_license_key = $licenseKey; p_fingerprint = $fingerprint } | ConvertTo-Json -Compress) -TimeoutSec 12
    $tenantSlug = [string]$pairResult
    if ($tenantSlug -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') {
      throw 'This Pairing Key was rejected or did not return a valid restaurant identity.'
    }

    $bridgeToken = ''
    $sessionEncryptionKey = ''
    if (Test-Path -LiteralPath $configPath) {
      $existingToken = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^BRIDGE_TOKEN=(.+)$' } | Select-Object -First 1
      if ($existingToken -match '^BRIDGE_TOKEN=(.{32,})$') { $bridgeToken = $Matches[1] }
      $existingSessionKey = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^BRIDGE_SESSION_ENCRYPTION_KEY=([a-f0-9]{64})$' } | Select-Object -First 1
      if ($existingSessionKey -match '^BRIDGE_SESSION_ENCRYPTION_KEY=(.+)$') { $sessionEncryptionKey = $Matches[1] }
    }
    if (-not $bridgeToken) {
      $randomBytes = New-Object byte[] 32
      $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
      try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
      $bridgeToken = [BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
    }
    if (-not $sessionEncryptionKey) {
      $randomBytes = New-Object byte[] 32
      $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
      try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
      $sessionEncryptionKey = [BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
    }
    $lines = @(
      'BRIDGE_HOST=127.0.0.1'
      'BRIDGE_PORT=8765'
      "BRIDGE_TOKEN=$bridgeToken"
      "BRIDGE_SESSION_ENCRYPTION_KEY=$sessionEncryptionKey"
      'BRIDGE_DATABASE=data/restaurant.sqlite'
      "RMS_SUPABASE_URL=$supabaseUrl"
      "RMS_SUPABASE_ANON_KEY=$anonKey"
      "RMS_WEB_APP_URL=$($parsedWebUrl.AbsoluteUri.TrimEnd('/'))"
      "RMS_LICENSE_KEY=$licenseKey"
      "RMS_MACHINE_FINGERPRINT=$fingerprint"
      "RMS_TENANT_SLUG=$tenantSlug"
      'PRINTER_HOST='
      'PRINTER_PORT=9100'
      'PRINTER_NAME='
    )
    [System.IO.File]::WriteAllLines($configPath, $lines, (New-Object System.Text.UTF8Encoding($false)))
    $counterConfig = @{
      web_app_url = $parsedWebUrl.AbsoluteUri.TrimEnd('/')
      supabase_url = $supabaseUrl
      publishable_key = $anonKey
    } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText((Join-Path $InstallDir 'counter-config.json'), $counterConfig, (New-Object System.Text.UTF8Encoding($false)))

    $dataPath = Join-Path $InstallDir 'data'
    $logsPath = Join-Path $InstallDir 'logs'
    New-Item -ItemType Directory -Path $dataPath, $logsPath -Force | Out-Null
    $icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
    & $icacls $dataPath '/inheritance:r' '/grant:r' 'NT AUTHORITY\LOCAL SERVICE:(OI)(CI)M' 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\SYSTEM:(OI)(CI)F' '/T' '/C' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not grant the Windows service access to its local database folder.' }
    & $icacls $logsPath '/inheritance:r' '/grant:r' 'NT AUTHORITY\LOCAL SERVICE:(OI)(CI)M' 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\SYSTEM:(OI)(CI)F' '/T' '/C' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not grant the Windows service access to its log folder.' }
    & $icacls $configPath '/inheritance:r' '/grant:r' 'NT AUTHORITY\LOCAL SERVICE:R' 'BUILTIN\Administrators:F' 'NT AUTHORITY\SYSTEM:F' 'BUILTIN\Users:R' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not protect the bridge configuration file.' }

    $form.Tag = $bridgeToken
    $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Close()
  } catch {
    $errorLabel.Text = $_.Exception.Message
    $saveButton.Enabled = $true
  }
})

$form.Add_Shown({ $pairingKeyBox.Focus() })
if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }

[System.Windows.Forms.MessageBox]::Show(
  "Restaurant '$tenantSlug' verified and this PC registered.`r`n`r`nLocal Counter connection token:`r`n$($form.Tag)`r`n`r`nCopy this generated token into the dashboard's Local Counter pairing field. The restaurant Pairing Key is stored in the protected service configuration.",
  'RMS Local Bridge configured',
  [System.Windows.Forms.MessageBoxButtons]::OK,
  [System.Windows.Forms.MessageBoxIcon]::Information
) | Out-Null

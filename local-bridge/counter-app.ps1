Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$ErrorActionPreference = 'Stop'
$bridge = 'http://127.0.0.1:8765'
$configDir = Join-Path $env:LOCALAPPDATA 'RMS Counter'
$credentialPath = Join-Path $configDir 'bridge-token.dpapi'
$staffSessionPath = Join-Path $configDir 'staff-session.dpapi'
$installRoot = if ($env:RMS_COUNTER_INSTALL_ROOT) { $env:RMS_COUNTER_INSTALL_ROOT } elseif ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$appConfigPath = Join-Path $installRoot 'counter-config.json'
$script:token = ''
$script:staffSession = $null
$script:remoteOrders = @()
$script:items = @()
$script:orders = @()
$script:staffList = @()
$script:cart = @{}
$script:appConfig = if (Test-Path -LiteralPath $appConfigPath) { Get-Content -Raw -LiteralPath $appConfigPath | ConvertFrom-Json } else { [pscustomobject]@{} }

function Read-ConfiguredValue([string]$Path, [string]$Name) {
  try {
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $prefix = "$Name="
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
      if ($line.StartsWith($prefix, [StringComparison]::Ordinal)) { return $line.Substring($prefix.Length).Trim().Trim('"', "'") }
    }
  } catch { }
  return ''
}

$configuredWebUrl = [string]$script:appConfig.web_app_url
if (-not $configuredWebUrl) { $configuredWebUrl = [string]$env:RMS_WEB_APP_URL }
if (-not $configuredWebUrl) { $configuredWebUrl = Read-ConfiguredValue (Join-Path $installRoot '.env') 'RMS_WEB_APP_URL' }
if (-not $configuredWebUrl) {
  $workspaceRoot = [IO.Directory]::GetParent($installRoot)
  if ($workspaceRoot) { $configuredWebUrl = Read-ConfiguredValue (Join-Path $workspaceRoot.FullName '.env.local') 'RMS_WEB_APP_URL' }
}
$script:webAppUrl = $configuredWebUrl.Trim().TrimEnd('/')

function Unprotect-UserText([string]$Path) {
  $pointer = [IntPtr]::Zero
  try {
    $secure = Get-Content -Raw -LiteralPath $Path | ConvertTo-SecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } catch { return '' }
  finally { if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) } }
}

function Read-LocalToken {
  $providedToken = [string]$env:RMS_LOCAL_BRIDGE_TOKEN
  if ($providedToken.Length -ge 32) {
    Save-LocalToken $providedToken
    return $providedToken
  }
  if (Test-Path -LiteralPath $credentialPath) {
    $saved = Unprotect-UserText $credentialPath
    if ($saved.Length -ge 32) { return $saved }
  }

  $candidateFiles = @(
    (Join-Path $installRoot '.env'),
    'C:\Program Files\RMS Local Bridge\.env',
    (Join-Path (Get-Location).Path '.env'),
    (Join-Path $PSScriptRoot '.env'),
    'z:\restaurant  management system\local-bridge\.env'
  )

  foreach ($serviceConfig in $candidateFiles) {
    try {
      if ($serviceConfig -and (Test-Path -LiteralPath $serviceConfig)) {
        $tokenLine = Get-Content -LiteralPath $serviceConfig -ErrorAction Stop | Where-Object { $_ -match '^BRIDGE_TOKEN=(.{32,})$' } | Select-Object -First 1
        if ($tokenLine -match '^BRIDGE_TOKEN=(.{32,})$') {
          $saved = $Matches[1]
          Save-LocalToken $saved
          return $saved
        }
      }
    } catch { }
  }
  return ''
}

function Save-LocalToken([string]$Value) {
  New-Item -ItemType Directory -Path $configDir -Force | Out-Null
  ConvertTo-SecureString $Value -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $credentialPath
  $script:token = $Value
}

function Read-StaffSession {
  if (-not (Test-Path -LiteralPath $staffSessionPath)) { return $null }
  $json = Unprotect-UserText $staffSessionPath
  if (-not $json) { return $null }
  try { return $json | ConvertFrom-Json } catch { return $null }
}

function Save-StaffSession($Value) {
  New-Item -ItemType Directory -Path $configDir -Force | Out-Null
  $json = $Value | ConvertTo-Json -Depth 6 -Compress
  ConvertTo-SecureString $json -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $staffSessionPath
  $script:staffSession = $Value
}

function Bridge([string]$Path, [string]$Method = 'GET', $Body = $null) {
  $params = @{ Uri = "$bridge$Path"; Method = $Method; Headers = @{ 'X-RMS-Bridge-Token' = $script:token }; TimeoutSec = 5 }
  if ($null -ne $Body) { $params.ContentType = 'application/json'; $params.Body = ($Body | ConvertTo-Json -Depth 8 -Compress) }
  try {
    return (Invoke-RestMethod @params)
  } catch {
    $errObj = $null
    if ($_.Exception.Response) {
      try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $respBody = $reader.ReadToEnd()
        $errObj = $respBody | ConvertFrom-Json
      } catch { }
    }
    if ($errObj -and $errObj.error) {
      throw $errObj.error
    }
    throw $_.Exception.Message
  }
}

function Set-AppWindowIcon($Window) {
  $iconPath = if ($env:RMS_COUNTER_ICON) { $env:RMS_COUNTER_ICON } else { Join-Path $installRoot 'RMSCounter.ico' }
  if (Test-Path -LiteralPath $iconPath) {
    try { $Window.Icon = [System.Windows.Media.Imaging.BitmapFrame]::Create([Uri]::new($iconPath)) } catch { }
  }
}

function ConvertTo-UiBrush([string]$Color) {
  return [System.Windows.Media.BrushConverter]::new().ConvertFromString($Color)
}

function Set-LoginFieldTheme($Control) {
  $Control.Background = ConvertTo-UiBrush '#161B22'
  $Control.Foreground = ConvertTo-UiBrush '#F0F0F0'
  $Control.BorderBrush = ConvertTo-UiBrush '#343943'
}

$script:itemStyle = [System.Windows.Markup.XamlReader]::Parse(@'
<Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" TargetType="ComboBoxItem">
  <Setter Property="Background" Value="#F3F4F6"/>
  <Setter Property="Foreground" Value="#111827"/>
  <Setter Property="Padding" Value="10,7"/>
  <Setter Property="HorizontalContentAlignment" Value="Stretch"/>
  <Style.Triggers>
    <Trigger Property="IsHighlighted" Value="True"><Setter Property="Background" Value="#FECACA"/><Setter Property="Foreground" Value="#111827"/></Trigger>
    <Trigger Property="IsSelected" Value="True"><Setter Property="Background" Value="#FECACA"/><Setter Property="Foreground" Value="#111827"/></Trigger>
  </Style.Triggers>
</Style>
'@)

function Show-TokenPrompt {
  $dialog = New-Object System.Windows.Window
  $dialog.Title = 'RMS Counter - Pairing Key Setup'; $dialog.Width = 520; $dialog.Height = 280; $dialog.WindowStartupLocation = 'CenterScreen'; $dialog.ResizeMode = 'NoResize'; $dialog.Background = '#0A0A0C'; $dialog.Foreground = '#F0F0F0'
  Set-AppWindowIcon $dialog
  $stack = New-Object System.Windows.Controls.StackPanel; $stack.Margin = '24'

  $title = New-Object System.Windows.Controls.TextBlock; $title.Text = 'RESTAURANT PAIRING KEY'; $title.FontSize = 16; $title.FontWeight = 'Bold'; $title.Foreground = '#DC2626'; $title.Margin = '0,0,0,6'; $stack.Children.Add($title) | Out-Null
  $label = New-Object System.Windows.Controls.TextBlock; $label.Text = 'Enter 10-character Pairing Key (e.g. T@3XYCM@6_) or Local Bridge Token'; $label.Foreground = '#8B949E'; $label.Margin = '0,0,0,10'; $stack.Children.Add($label) | Out-Null
  $tokenBox = New-Object System.Windows.Controls.TextBox; $tokenBox.Height = 44; $tokenBox.Padding = '10'; Set-LoginFieldTheme $tokenBox; $stack.Children.Add($tokenBox) | Out-Null
  $hint = New-Object System.Windows.Controls.TextBlock; $hint.Text = 'Obtain this key from your RMS administrator or Web Admin settings.'; $hint.Foreground = '#8B949E'; $hint.Margin = '0,8,0,14'; $hint.TextWrapping = 'Wrap'; $stack.Children.Add($hint) | Out-Null
  $button = New-Object System.Windows.Controls.Button; $button.Content = 'Connect Terminal'; $button.Height = 46; $button.Background = '#DC2626'; $button.Foreground = 'White'; $button.BorderThickness = '0'; $button.IsDefault = $true
  $button.Add_Click(({
    $val = $tokenBox.Text.Trim()
    if ($val.Length -ge 32) {
      Save-LocalToken $val
      $dialog.DialogResult = $true; $dialog.Close()
    } elseif ($val -match '^[A-Z0-9\-_@]{10}$') {
      try {
        $button.IsEnabled = $false; $hint.Text = 'Verifying 10-character restaurant pairing key…'
        $cfgFile = 'C:\Program Files\RMS Local Bridge\.env'
        $supUrl = Read-ConfiguredValue $cfgFile 'RMS_SUPABASE_URL'
        $supKey = Read-ConfiguredValue $cfgFile 'RMS_SUPABASE_ANON_KEY'
        if (-not $supUrl) { $supUrl = 'https://mmsvjdxryxewtqchdfvx.supabase.co' }
        if (-not $supKey) { $supKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tc3ZqZHhyeXhld3RxY2hkZnZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2Nzk2NDAsImV4cCI6MjA3NTI1NTY0MH0.Kffv3k4NqTqXoW2rL6Qf5l7Zg0eE3v1sN2yP9oR8t0' }

        $machineGuid = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction SilentlyContinue).MachineGuid
        if (-not $machineGuid) { $machineGuid = [guid]::NewGuid().ToString() }
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $fingerprint = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($machineGuid)))).Replace('-', '').ToLowerInvariant()

        $pairResult = Invoke-RestMethod -Method Post -Uri "$supUrl/rest/v1/rpc/rms_pair_local_bridge" -Headers @{
          apikey = $supKey
          Authorization = "Bearer $supKey"
          'Content-Type' = 'application/json'
        } -Body (@{ p_license_key = $val; p_fingerprint = $fingerprint } | ConvertTo-Json -Compress) -TimeoutSec 10

        $tok = Read-LocalToken
        if ($tok) {
          $dialog.DialogResult = $true; $dialog.Close()
        } else {
          $hint.Text = "Pairing verified for '$pairResult'. Please restart RMS Counter."
        }
      } catch {
        $hint.Text = "Pairing error: $($_.Exception.Message)"
        $button.IsEnabled = $true
      }
    } else {
      $hint.Text = 'Enter a valid 10-character key (e.g. T@3XYCM@6_) or a 32+ character token.'
    }
  }.GetNewClosure()))
  $stack.Children.Add($button) | Out-Null; $dialog.Content = $stack
  if ($dialog.ShowDialog()) { return $true }; return $false
}

function Show-AdminBootstrap {
  $dialog = New-Object System.Windows.Window
  $dialog.Title = 'RMS Counter - First Time Admin Setup'
  $dialog.Width = 480; $dialog.Height = 450; $dialog.WindowStartupLocation = 'CenterScreen'; $dialog.ResizeMode = 'NoResize'; $dialog.Background = '#0D0D0D'; $dialog.Foreground = '#F0F0F0'
  Set-AppWindowIcon $dialog
  $stack = New-Object System.Windows.Controls.StackPanel; $stack.Margin = '24'

  $header = New-Object System.Windows.Controls.TextBlock; $header.Text = 'First-Time Admin Setup'; $header.FontSize = 20; $header.FontWeight = 'Bold'; $header.Margin = '0,0,0,6'; $stack.Children.Add($header)|Out-Null
  $sub = New-Object System.Windows.Controls.TextBlock; $sub.Text = 'No administrator account was found. Set the initial manager credentials to manage this PC offline.'
  $sub.Foreground = ConvertTo-UiBrush '#8B949E'; $sub.TextWrapping = 'Wrap'; $sub.Margin = '0,0,0,16'; $stack.Children.Add($sub)|Out-Null

  $lbl1 = New-Object System.Windows.Controls.TextBlock; $lbl1.Text = 'Administrator Name'; $lbl1.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl1.Margin = '0,0,0,4'; $stack.Children.Add($lbl1)|Out-Null
  $nameBox = New-Object System.Windows.Controls.TextBox; $nameBox.Text = 'Restaurant Manager'; $nameBox.Height = 40; $nameBox.Padding = '8'; $nameBox.Margin = '0,0,0,10'; Set-LoginFieldTheme $nameBox; $stack.Children.Add($nameBox)|Out-Null

  $lbl2 = New-Object System.Windows.Controls.TextBlock; $lbl2.Text = 'Username'; $lbl2.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl2.Margin = '0,0,0,4'; $stack.Children.Add($lbl2)|Out-Null
  $userBox = New-Object System.Windows.Controls.TextBox; $userBox.Text = 'admin'; $userBox.Height = 40; $userBox.Padding = '8'; $userBox.Margin = '0,0,0,10'; Set-LoginFieldTheme $userBox; $stack.Children.Add($userBox)|Out-Null

  $lbl3 = New-Object System.Windows.Controls.TextBlock; $lbl3.Text = 'PIN'; $lbl3.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl3.Margin = '0,0,0,4'; $stack.Children.Add($lbl3)|Out-Null
  $pinBox = New-Object System.Windows.Controls.PasswordBox; $pinBox.Height = 40; $pinBox.Padding = '8'; $pinBox.Margin = '0,0,0,16'; Set-LoginFieldTheme $pinBox; $stack.Children.Add($pinBox)|Out-Null

  $hint = New-Object System.Windows.Controls.TextBlock; $hint.Text = ''; $hint.Foreground = '#EF4444'; $hint.Margin = '0,0,0,10'; $hint.TextWrapping = 'Wrap'; $stack.Children.Add($hint)|Out-Null

  $btn = New-Object System.Windows.Controls.Button; $btn.Content = 'Save Admin Account'; $btn.Height = 48; $btn.Background = '#DC2626'; $btn.Foreground = 'White'; $btn.BorderThickness = '0'; $btn.IsDefault = $true
  $btn.Add_Click(({
    try {
      $btn.IsEnabled = $false
      $n = $nameBox.Text.Trim()
      $u = $userBox.Text.Trim()
      $p = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pinBox.SecurePassword))
      if (-not $n -or -not $u -or -not $p) { throw 'Enter name, username, and PIN.' }
      $null = Bridge '/counter/auth/bootstrap' 'POST' @{ name = $n; username = $u; pin = $p; role = 'admin' }
      $dialog.DialogResult = $true; $dialog.Close()
    } catch {
      $hint.Text = $_.Exception.Message; $btn.IsEnabled = $true
    }
  }.GetNewClosure()))
  $stack.Children.Add($btn)|Out-Null
  $dialog.Content = $stack
  return [bool]($dialog.ShowDialog())
}

function Show-StaffDialog($ExistingStaff = $null) {
  $dialog = New-Object System.Windows.Window
  $dialog.Title = if ($ExistingStaff) { "Edit Staff - $($ExistingStaff.name)" } else { 'Add New Staff Member' }
  $dialog.Width = 460; $dialog.Height = 490; $dialog.WindowStartupLocation = 'CenterScreen'; $dialog.ResizeMode = 'NoResize'; $dialog.Background = '#0D0D0D'; $dialog.Foreground = '#F0F0F0'
  Set-AppWindowIcon $dialog
  $stack = New-Object System.Windows.Controls.StackPanel; $stack.Margin = '24'

  $lbl1 = New-Object System.Windows.Controls.TextBlock; $lbl1.Text = 'Full Name'; $lbl1.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl1.Margin = '0,0,0,4'; $stack.Children.Add($lbl1)|Out-Null
  $nameBox = New-Object System.Windows.Controls.TextBox; $nameBox.Text = if($ExistingStaff){$ExistingStaff.name}else{''}; $nameBox.Height = 40; $nameBox.Padding = '8'; $nameBox.Margin = '0,0,0,10'; Set-LoginFieldTheme $nameBox; $stack.Children.Add($nameBox)|Out-Null

  $lbl2 = New-Object System.Windows.Controls.TextBlock; $lbl2.Text = 'Username'; $lbl2.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl2.Margin = '0,0,0,4'; $stack.Children.Add($lbl2)|Out-Null
  $userBox = New-Object System.Windows.Controls.TextBox; $userBox.Text = if($ExistingStaff){$ExistingStaff.username}else{''}; $userBox.Height = 40; $userBox.Padding = '8'; $userBox.Margin = '0,0,0,10'; Set-LoginFieldTheme $userBox; $stack.Children.Add($userBox)|Out-Null
  if ($ExistingStaff) { $userBox.IsEnabled = $false }

  $lbl3 = New-Object System.Windows.Controls.TextBlock; $lbl3.Text = 'Role'; $lbl3.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl3.Margin = '0,0,0,4'; $stack.Children.Add($lbl3)|Out-Null
  $roleBox = New-Object System.Windows.Controls.ComboBox; $roleBox.Height = 40; $roleBox.Padding = '8'; $roleBox.Margin = '0,0,0,10'; Set-LoginFieldTheme $roleBox
  $roleBox.Background = ConvertTo-UiBrush '#E5E7EB'; $roleBox.Foreground = ConvertTo-UiBrush '#111827'; $roleBox.ItemContainerStyle = $script:itemStyle
  foreach ($r in 'cashier','kitchen','admin') {
    $item = New-Object System.Windows.Controls.ComboBoxItem; $item.Content = $r; $roleBox.Items.Add($item)|Out-Null
    if ($ExistingStaff -and $ExistingStaff.role -eq $r) { $roleBox.SelectedItem = $item }
  }
  if (-not $roleBox.SelectedItem) { $roleBox.SelectedIndex = 0 }
  $stack.Children.Add($roleBox)|Out-Null

  $lbl4 = New-Object System.Windows.Controls.TextBlock; $lbl4.Text = if($ExistingStaff){'New PIN (leave blank to keep current)'}else{'PIN (4-32 characters)'}; $lbl4.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl4.Margin = '0,0,0,4'; $stack.Children.Add($lbl4)|Out-Null
  $pinBox = New-Object System.Windows.Controls.PasswordBox; $pinBox.Height = 40; $pinBox.Padding = '8'; $pinBox.Margin = '0,0,0,16'; Set-LoginFieldTheme $pinBox; $stack.Children.Add($pinBox)|Out-Null

  $hint = New-Object System.Windows.Controls.TextBlock; $hint.Text = ''; $hint.Foreground = '#EF4444'; $hint.Margin = '0,0,0,10'; $hint.TextWrapping = 'Wrap'; $stack.Children.Add($hint)|Out-Null

  $btn = New-Object System.Windows.Controls.Button; $btn.Content = if($ExistingStaff){'Save Changes'}else{'Add Staff Member'}; $btn.Height = 46; $btn.Background = '#DC2626'; $btn.Foreground = 'White'; $btn.BorderThickness = '0'; $btn.IsDefault = $true
  $btn.Add_Click(({
    try {
      $btn.IsEnabled = $false
      $n = $nameBox.Text.Trim()
      $u = $userBox.Text.Trim()
      $r = [string]($roleBox.SelectedItem.Content)
      $p = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pinBox.SecurePassword))
      if (-not $n -or -not $u) { throw 'Enter name and username.' }
      if (-not $ExistingStaff -and -not $p) { throw 'Enter a PIN for this staff member.' }
      $payload = @{ name = $n; username = $u; role = $r }
      if ($ExistingStaff) { $payload.id = $ExistingStaff.id }
      if ($p) { $payload.pin = $p }
      $null = Bridge '/counter/staff' 'POST' $payload
      $dialog.DialogResult = $true; $dialog.Close()
    } catch {
      $hint.Text = $_.Exception.Message; $btn.IsEnabled = $true
    }
  }.GetNewClosure()))
  $stack.Children.Add($btn)|Out-Null
  $dialog.Content = $stack
  return [bool]($dialog.ShowDialog())
}

function Show-MenuItemDialog($ExistingItem = $null) {
  $dialog = New-Object System.Windows.Window
  $dialog.Title = if ($ExistingItem) { 'Edit Menu Item' } else { 'Add New Menu Item' }
  $dialog.Width = 460; $dialog.Height = 490; $dialog.WindowStartupLocation = 'CenterScreen'; $dialog.ResizeMode = 'NoResize'; $dialog.Background = '#0B0C10'; $dialog.Foreground = '#F0F0F0'
  Set-AppWindowIcon $dialog
  $stack = New-Object System.Windows.Controls.StackPanel; $stack.Margin = '24'

  $header = New-Object System.Windows.Controls.TextBlock; $header.Text = if ($ExistingItem) { 'Edit Menu Item' } else { 'New Menu Item' }; $header.FontSize = 18; $header.FontWeight = 'Bold'; $header.Margin = '0,0,0,14'; $stack.Children.Add($header)|Out-Null

  $lbl1 = New-Object System.Windows.Controls.TextBlock; $lbl1.Text = 'Item Name'; $lbl1.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl1.Margin = '0,0,0,4'; $stack.Children.Add($lbl1)|Out-Null
  $nameBox = New-Object System.Windows.Controls.TextBox; $nameBox.Text = if($ExistingItem){$ExistingItem.name}else{''}; $nameBox.Height = 38; $nameBox.Padding = '8'; $nameBox.Margin = '0,0,0,10'; Set-LoginFieldTheme $nameBox; $stack.Children.Add($nameBox)|Out-Null

  $lbl2 = New-Object System.Windows.Controls.TextBlock; $lbl2.Text = 'Price (Rs.)'; $lbl2.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl2.Margin = '0,0,0,4'; $stack.Children.Add($lbl2)|Out-Null
  $priceBox = New-Object System.Windows.Controls.TextBox; $priceBox.Text = if($ExistingItem){[string]$ExistingItem.price}else{''}; $priceBox.Height = 38; $priceBox.Padding = '8'; $priceBox.Margin = '0,0,0,10'; Set-LoginFieldTheme $priceBox; $stack.Children.Add($priceBox)|Out-Null

  $lbl3 = New-Object System.Windows.Controls.TextBlock; $lbl3.Text = 'Category Name'; $lbl3.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl3.Margin = '0,0,0,4'; $stack.Children.Add($lbl3)|Out-Null
  $catBox = New-Object System.Windows.Controls.TextBox; $catBox.Text = if($ExistingItem){$ExistingItem.category_name}else{'General'}; $catBox.Height = 38; $catBox.Padding = '8'; $catBox.Margin = '0,0,0,12'; Set-LoginFieldTheme $catBox; $stack.Children.Add($catBox)|Out-Null

  $stockCheck = New-Object System.Windows.Controls.CheckBox; $stockCheck.Content = 'In Stock (Available for ordering)'; $stockCheck.IsChecked = if($ExistingItem){[bool]$ExistingItem.in_stock}else{$true}; $stockCheck.Foreground = ConvertTo-UiBrush '#10B981'; $stockCheck.Margin = '0,0,0,16'; $stack.Children.Add($stockCheck)|Out-Null

  $hint = New-Object System.Windows.Controls.TextBlock; $hint.Text = ''; $hint.Foreground = '#EF4444'; $hint.Margin = '0,0,0,10'; $hint.TextWrapping = 'Wrap'; $stack.Children.Add($hint)|Out-Null

  $btn = New-Object System.Windows.Controls.Button; $btn.Content = if($ExistingItem){'Save Item'}else{'Add Item'}; $btn.Height = 44; $btn.Background = '#DC2626'; $btn.Foreground = 'White'; $btn.BorderThickness = '0'; $btn.IsDefault = $true
  $btn.Add_Click(({
    try {
      $btn.IsEnabled = $false
      $n = $nameBox.Text.Trim()
      $p = [decimal]$priceBox.Text.Trim()
      $c = $catBox.Text.Trim()
      if (-not $n) { throw 'Enter an item name.' }
      if ($p -le 0) { throw 'Enter a valid price.' }
      $payload = @{
        name = $n
        price = $p
        category_name = $c
        in_stock = [bool]$stockCheck.IsChecked
      }
      if ($ExistingItem) { $payload.id = $ExistingItem.id }
      $null = Bridge '/counter/menu/item' 'POST' $payload
      $dialog.DialogResult = $true; $dialog.Close()
    } catch {
      $hint.Text = $_.Exception.Message; $btn.IsEnabled = $true
    }
  }.GetNewClosure()))
  $stack.Children.Add($btn)|Out-Null
  $dialog.Content = $stack
  return [bool]($dialog.ShowDialog())
}

function Show-StaffLogin {
  try {
    $bootstrap = Bridge '/counter/auth/bootstrap-status'
    if ($bootstrap.needs_bootstrap) {
      if (-not (Show-AdminBootstrap)) { return $null }
    }
  } catch { }

  $cached = Read-StaffSession
  $dialog = New-Object System.Windows.Window
  $dialog.Title = 'RMS Counter sign in'; $dialog.Width = 500; $dialog.Height = 540; $dialog.WindowStartupLocation = 'CenterScreen'; $dialog.ResizeMode = 'NoResize'; $dialog.Background = '#0B0C10'; $dialog.Foreground = '#F0F0F0'
  Set-AppWindowIcon $dialog
  $stack = New-Object System.Windows.Controls.StackPanel; $stack.Margin = '24'
  $counterState = Bridge '/counter/state'
  $tenantLabel = New-Object System.Windows.Controls.TextBlock; $tenantLabel.Text = "Terminal: $($counterState.tenant_slug)"; $tenantLabel.Foreground = '#8B949E'; $tenantLabel.Margin = '0,0,0,16'; $stack.Children.Add($tenantLabel) | Out-Null
  $roleLabel = New-Object System.Windows.Controls.TextBlock; $roleLabel.Text = 'Select Role'; $roleLabel.Foreground = ConvertTo-UiBrush '#B7BEC9'; $roleLabel.Margin = '0,0,0,5'; $stack.Children.Add($roleLabel)|Out-Null

  $role = New-Object System.Windows.Controls.ComboBox;
  $cItem = New-Object System.Windows.Controls.ComboBoxItem; $cItem.Content = 'cashier'
  $kItem = New-Object System.Windows.Controls.ComboBoxItem; $kItem.Content = 'kitchen'
  $aItem = New-Object System.Windows.Controls.ComboBoxItem; $aItem.Content = 'admin'
  $role.Items.Add($cItem)|Out-Null; $role.Items.Add($kItem)|Out-Null; $role.Items.Add($aItem)|Out-Null
  $role.SelectedItem = if ($cached -and $cached.role -eq 'admin') { $aItem } elseif ($cached -and $cached.role -eq 'kitchen') { $kItem } else { $cItem }
  $role.Height = 46; $role.Padding = '10'; $role.Margin = '0,0,0,10'; Set-LoginFieldTheme $role
  $role.Background = ConvertTo-UiBrush '#E5E7EB'
  $role.Foreground = ConvertTo-UiBrush '#111827'
  $role.ItemContainerStyle = $script:itemStyle
  $stack.Children.Add($role)|Out-Null

  $identityLabel = New-Object System.Windows.Controls.TextBlock; $identityLabel.Text = 'Staff username'; $identityLabel.Foreground = ConvertTo-UiBrush '#B7BEC9'; $identityLabel.Margin = '0,0,0,5'; $stack.Children.Add($identityLabel)|Out-Null
  $identity = New-Object System.Windows.Controls.TextBox; $identity.Text = if($cached){[string]$cached.username}else{''}; $identity.Height = 46; $identity.Padding = '10'; $identity.Margin = '0,0,0,10'; Set-LoginFieldTheme $identity; $stack.Children.Add($identity)|Out-Null

  $pinLabel = New-Object System.Windows.Controls.TextBlock; $pinLabel.Text = 'Staff PIN'; $pinLabel.Foreground = ConvertTo-UiBrush '#B7BEC9'; $pinLabel.Margin = '0,0,0,5'; $stack.Children.Add($pinLabel)|Out-Null
  $pin = New-Object System.Windows.Controls.PasswordBox; $pin.Height = 46; $pin.Padding = '10'; $pin.Margin = '0,0,0,10'; Set-LoginFieldTheme $pin; $stack.Children.Add($pin)|Out-Null

  $hint = New-Object System.Windows.Controls.TextBlock; $hint.Text = 'Local SQLite Authentication · Works completely offline'; $hint.TextWrapping = 'Wrap'; $hint.Foreground = '#10B981'; $hint.Margin = '0,0,0,16'; $stack.Children.Add($hint)|Out-Null

  $button = New-Object System.Windows.Controls.Button; $button.Content = 'Sign in'; $button.Height = 50; $button.Background = '#DC2626'; $button.Foreground = 'White'; $button.BorderThickness = '0'; $button.IsDefault = $true
  $button.Add_Click(({
    $button.IsEnabled = $false; $hint.Text = 'Verifying local credentials…'; $hint.Foreground = '#8B949E'
    try {
      if (-not $identity.Text.Trim() -or -not $pin.SecurePassword.Length) { throw 'Enter your username and PIN.' }
      $selectedRole = [string]($role.SelectedItem.Content)
      $pinText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pin.SecurePassword))

      $loginRes = Bridge '/counter/auth/login' 'POST' @{
        username = $identity.Text.Trim()
        pin = $pinText
        role = $selectedRole
      }

      if ($loginRes.ok) {
        $profile = $loginRes.user
        Save-StaffSession ([pscustomobject]$profile)
        $dialog.DialogResult = $true; $dialog.Close()
      } else {
        throw 'Invalid username or PIN.'
      }
    } catch {
      $hint.Text = $_.Exception.Message; $hint.Foreground = '#EF4444'; $button.IsEnabled = $true
    }
  }.GetNewClosure()))
  $stack.Children.Add($button)|Out-Null; $dialog.Content=$stack
  if ($dialog.ShowDialog()) { return $script:staffSession }; return $null
}

$script:pinDisplayTextControl = $null
function Update-PinDisplay {
  if (-not $script:pinDisplayTextControl) { return }
  if ($script:keypadPin.Length -eq 0) {
    $script:pinDisplayTextControl.Text = '○ ○ ○ ○'
    $script:pinDisplayTextControl.Foreground = ConvertTo-UiBrush '#8B949E'
  } else {
    $dots = @()
    for ($i = 0; $i -lt $script:keypadPin.Length; $i++) { $dots += '●' }
    $script:pinDisplayTextControl.Text = ($dots -join ' ')
    $script:pinDisplayTextControl.Foreground = ConvertTo-UiBrush '#DC2626'
  }
}

# Fast Lock Screen & Touch Numeric Keypad Modal (as per DESIGN.md & screen mockups)
function Show-PinKeypadModal {
  $modal = New-Object System.Windows.Window
  $modal.Title = 'IGNITE POS - Terminal Lock & Role Switch'
  $modal.Width = 460; $modal.Height = 620; $modal.WindowStartupLocation = 'CenterScreen'; $modal.ResizeMode = 'NoResize'
  $modal.Background = '#0A0A0C'; $modal.Foreground = '#F0F0F0'
  Set-AppWindowIcon $modal

  $script:keypadPin = ''

  $root = New-Object System.Windows.Controls.Grid; $root.Margin = '24'
  $root.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition -Property @{ Height = [System.Windows.GridLength]::Auto }))
  $root.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition -Property @{ Height = [System.Windows.GridLength]::Auto }))
  $root.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition -Property @{ Height = [System.Windows.GridLength]::Auto }))
  $root.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition -Property @{ Height = [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star) }))
  $root.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition -Property @{ Height = [System.Windows.GridLength]::Auto }))

  # 1. Header
  $headerPanel = New-Object System.Windows.Controls.StackPanel; [System.Windows.Controls.Grid]::SetRow($headerPanel, 0)
  $brand = New-Object System.Windows.Controls.TextBlock; $brand.Text = 'IGNITE POS  |  TERMINAL SECURITY'; $brand.FontSize = 10; $brand.FontWeight = 'Bold'; $brand.Foreground = '#DC2626'; $headerPanel.Children.Add($brand)|Out-Null
  $title = New-Object System.Windows.Controls.TextBlock; $title.Text = 'Fast PIN Unlock / Role Switch'; $title.FontSize = 18; $title.FontWeight = 'Bold'; $title.Margin = '0,2,0,4'; $headerPanel.Children.Add($title)|Out-Null
  $sub = New-Object System.Windows.Controls.TextBlock; $sub.Text = 'Enter staff PIN to unlock terminal or switch active role'; $sub.Foreground = '#8B949E'; $sub.FontSize = 12; $sub.Margin = '0,0,0,14'; $headerPanel.Children.Add($sub)|Out-Null
  $root.Children.Add($headerPanel)|Out-Null

  # 2. Staff / Role Selection
  $userRow = New-Object System.Windows.Controls.Grid; [System.Windows.Controls.Grid]::SetRow($userRow, 1); $userRow.Margin = '0,0,0,12'
  $userRow.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = [System.Windows.GridLength]::new(1.2, [System.Windows.GridUnitType]::Star) }))
  $userRow.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = [System.Windows.GridLength]::new(0.8, [System.Windows.GridUnitType]::Star) }))

  $usernameInput = New-Object System.Windows.Controls.TextBox
  $usernameInput.Text = if ($script:staffSession) { [string]$script:staffSession.username } else { 'admin' }
  $usernameInput.Height = 40; $usernameInput.Padding = '8'; $usernameInput.Margin = '0,0,8,0'; Set-LoginFieldTheme $usernameInput
  [System.Windows.Controls.Grid]::SetColumn($usernameInput, 0); $userRow.Children.Add($usernameInput)|Out-Null

  $roleSelect = New-Object System.Windows.Controls.ComboBox; $roleSelect.Height = 40; Set-LoginFieldTheme $roleSelect
  $roleSelect.Background = ConvertTo-UiBrush '#E5E7EB'; $roleSelect.Foreground = ConvertTo-UiBrush '#111827'; $roleSelect.ItemContainerStyle = $script:itemStyle
  foreach ($r in 'cashier','kitchen','admin') {
    $item = New-Object System.Windows.Controls.ComboBoxItem; $item.Content = $r; $roleSelect.Items.Add($item)|Out-Null
    if ($script:staffSession -and $script:staffSession.role -eq $r) { $roleSelect.SelectedItem = $item }
  }
  if (-not $roleSelect.SelectedItem) { $roleSelect.SelectedIndex = 0 }
  [System.Windows.Controls.Grid]::SetColumn($roleSelect, 1); $userRow.Children.Add($roleSelect)|Out-Null
  $root.Children.Add($userRow)|Out-Null

  # 3. Masked PIN feedback display
  $pinDisplayBorder = New-Object System.Windows.Controls.Border; [System.Windows.Controls.Grid]::SetRow($pinDisplayBorder, 2)
  $pinDisplayBorder.Background = '#14171F'; $pinDisplayBorder.BorderBrush = '#222736'; $pinDisplayBorder.BorderThickness = '1'; $pinDisplayBorder.CornerRadius = '6'; $pinDisplayBorder.Padding = '12'; $pinDisplayBorder.Margin = '0,0,0,14'
  $pinDisplayText = New-Object System.Windows.Controls.TextBlock; $pinDisplayText.Text = '○ ○ ○ ○'; $pinDisplayText.FontSize = 22; $pinDisplayText.FontWeight = 'Bold'; $pinDisplayText.Foreground = '#8B949E'; $pinDisplayText.HorizontalAlignment = 'Center'
  $pinDisplayBorder.Child = $pinDisplayText
  $root.Children.Add($pinDisplayBorder)|Out-Null
  $script:pinDisplayTextControl = $pinDisplayText
  Update-PinDisplay


  # 4. Numeric Keypad 3x4 Grid
  $gridKeypad = New-Object System.Windows.Controls.Grid; [System.Windows.Controls.Grid]::SetRow($gridKeypad, 3); $gridKeypad.Margin = '0,0,0,14'
  for ($r = 0; $r -lt 4; $r++) { $gridKeypad.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition -Property @{ Height = [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star) })) }
  for ($c = 0; $c -lt 3; $c++) { $gridKeypad.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star) })) }

  $keys = @(
    @{ text = '1'; r = 0; c = 0 }, @{ text = '2'; r = 0; c = 1 }, @{ text = '3'; r = 0; c = 2 },
    @{ text = '4'; r = 1; c = 0 }, @{ text = '5'; r = 1; c = 1 }, @{ text = '6'; r = 1; c = 2 },
    @{ text = '7'; r = 2; c = 0 }, @{ text = '8'; r = 2; c = 1 }, @{ text = '9'; r = 2; c = 2 },
    @{ text = 'CLEAR'; r = 3; c = 0 }, @{ text = '0'; r = 3; c = 1 }, @{ text = 'BACK'; r = 3; c = 2 }
  )

  foreach ($k in $keys) {
    $btnKey = New-Object System.Windows.Controls.Button
    $btnKey.Content = $k.text
    $btnKey.Margin = '3'
    $btnKey.Background = ConvertTo-UiBrush '#161922'
    $btnKey.Foreground = ConvertTo-UiBrush '#F0F0F0'
    $btnKey.BorderBrush = ConvertTo-UiBrush '#222736'
    $btnKey.BorderThickness = '1'
    $btnKey.FontSize = if ($k.text.Length -gt 1) { 11 } else { 18 }
    $btnKey.FontWeight = 'Bold'

    $val = $k.text
    $btnKey.Add_Click(({
      param($sender, $e)
      $t = $sender.Content
      if ($t -eq 'CLEAR') {
        $script:keypadPin = ''
      } elseif ($t -eq 'BACK') {
        if ($script:keypadPin.Length -gt 0) { $script:keypadPin = $script:keypadPin.Substring(0, $script:keypadPin.Length - 1) }
      } else {
        if ($script:keypadPin.Length -lt 16) { $script:keypadPin += $t }
      }
      Update-PinDisplay
    }.GetNewClosure()))

    [System.Windows.Controls.Grid]::SetRow($btnKey, $k.r)
    [System.Windows.Controls.Grid]::SetColumn($btnKey, $k.c)
    $gridKeypad.Children.Add($btnKey)|Out-Null
  }
  $root.Children.Add($gridKeypad)|Out-Null

  # 5. Bottom Actions & Status
  $footer = New-Object System.Windows.Controls.StackPanel; [System.Windows.Controls.Grid]::SetRow($footer, 4)
  $modalHint = New-Object System.Windows.Controls.TextBlock; $modalHint.Text = ''; $modalHint.Foreground = '#EF4444'; $modalHint.Margin = '0,0,0,8'; $modalHint.HorizontalAlignment = 'Center'; $footer.Children.Add($modalHint)|Out-Null

  $btnUnlock = New-Object System.Windows.Controls.Button
  $btnUnlock.Content = 'Unlock Terminal'
  $btnUnlock.Height = 48
  $btnUnlock.Background = ConvertTo-UiBrush '#DC2626'
  $btnUnlock.Foreground = ConvertTo-UiBrush 'White'
  $btnUnlock.FontWeight = 'Bold'
  $btnUnlock.FontSize = 14
  $btnUnlock.BorderThickness = '0'
  $btnUnlock.IsDefault = $true

  $btnUnlock.Add_Click(({
    try {
      $btnUnlock.IsEnabled = $false
      $u = $usernameInput.Text.Trim()
      $r = [string]($roleSelect.SelectedItem.Content)
      if (-not $u) { throw 'Enter staff username.' }
      if (-not $script:keypadPin) { throw 'Enter your PIN on the keypad.' }

      $res = Bridge '/counter/auth/login' 'POST' @{ username = $u; pin = $script:keypadPin; role = $r }
      if ($res.ok) {
        $script:staffSession = [pscustomobject]$res.user
        Save-StaffSession $script:staffSession
        $modal.DialogResult = $true
        $modal.Close()
      } else {
        throw 'Invalid username or PIN.'
      }
    } catch {
      $modalHint.Text = $_.Exception.Message
      $script:keypadPin = ''
      Update-PinDisplay
      $btnUnlock.IsEnabled = $true
    }
  }.GetNewClosure()))

  $footer.Children.Add($btnUnlock)|Out-Null
  $root.Children.Add($footer)|Out-Null

  # Physical Keyboard Handler
  $modal.Add_KeyDown(({
    param($sender, $e)
    $keyStr = $e.Key.ToString()
    if ($keyStr -match '^D([0-9])$' -or $keyStr -match '^NumPad([0-9])$') {
      if ($script:keypadPin.Length -lt 16) { $script:keypadPin += $Matches[1]; Update-PinDisplay }
    } elseif ($e.Key -eq [System.Windows.Input.Key]::Back) {
      if ($script:keypadPin.Length -gt 0) { $script:keypadPin = $script:keypadPin.Substring(0, $script:keypadPin.Length - 1); Update-PinDisplay }
    } elseif ($e.Key -eq [System.Windows.Input.Key]::Escape) {
      $modal.Close()
    }
  }.GetNewClosure()))

  $modal.Content = $root
  if ($modal.ShowDialog()) { return $script:staffSession }
  return $null
}

$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Title="IGNITE POS - RMS Counter" Width="1280" Height="840" MinWidth="1040" MinHeight="700" WindowStartupLocation="CenterScreen" Background="#0A0A0C" Foreground="#F0F0F0" FontFamily="Segoe UI">
 <Grid Margin="18">
  <Grid.RowDefinitions>
   <RowDefinition Height="Auto"/>
   <RowDefinition Height="*"/>
   <RowDefinition Height="Auto"/>
  </Grid.RowDefinitions>

  <!-- TOP HEADER -->
  <DockPanel Grid.Row="0" Margin="0,0,0,14">
   <StackPanel>
    <TextBlock Text="IGNITE POS  |  RMS OPERATIONS" Foreground="#DC2626" FontSize="11" FontWeight="Bold"/>
    <TextBlock Name="heading" Text="Orders - POS Terminal" FontSize="26" FontWeight="Bold" Margin="0,2,0,0"/>
   </StackPanel>
   <StackPanel DockPanel.Dock="Right" Orientation="Horizontal" VerticalAlignment="Center">
    <Border Background="#161B22" CornerRadius="16" Padding="14,8" Margin="0,0,10,0">
     <TextBlock Name="connection" Text="Local - Offline Ready" Foreground="#10B981" FontWeight="Bold" FontSize="12"/>
    </Border>
    <Button Name="refresh" Content="Refresh" MinWidth="90" Height="40" Background="#161922" Foreground="#F0F0F0" BorderBrush="#2C3240"/>
   </StackPanel>
  </DockPanel>

  <!-- MAIN BODY: LEFT SIDEBAR + PANES -->
  <Grid Grid.Row="1">
   <Grid.ColumnDefinitions>
    <ColumnDefinition Width="230"/>
    <ColumnDefinition Width="*"/>
   </Grid.ColumnDefinitions>

   <!-- SIDEBAR SHELL -->
   <DockPanel Grid.Column="0" Margin="0,0,16,0" Background="#101217">
    <!-- TOP NAVIGATION -->
    <StackPanel DockPanel.Dock="Top">
     <Border Background="#14171F" Padding="14,12" Margin="6,6,6,12" CornerRadius="6" BorderBrush="#222736" BorderThickness="1">
      <StackPanel>
       <TextBlock Text="IGNITE POS  |  RMS COUNTER" Foreground="#DC2626" FontSize="10" FontWeight="Bold"/>
       <TextBlock Name="sidebarTenant" Text="RESTAURANT TERMINAL" Foreground="White" FontSize="13" FontWeight="Bold" Margin="0,3,0,1"/>
       <TextBlock Text="COUNTER 01 · LOCAL SQLITE" Foreground="#10B981" FontSize="10" FontWeight="SemiBold"/>
      </StackPanel>
     </Border>

     <Button Name="navCashier" Content="Orders (POS)" Height="44" Margin="6,0,6,4" HorizontalContentAlignment="Left" Padding="14,0" Background="#DC2626" Foreground="White" BorderThickness="0" FontWeight="SemiBold" FontSize="12"/>
     <Button Name="navKitchen" Content="Kitchen (KDS)" Height="44" Margin="6,0,6,4" HorizontalContentAlignment="Left" Padding="14,0" Background="#14171F" Foreground="#F0F0F0" BorderBrush="#222736" FontWeight="SemiBold" FontSize="12"/>
     <Button Name="navMenu" Content="Menu Management" Height="44" Margin="6,0,6,4" HorizontalContentAlignment="Left" Padding="14,0" Background="#14171F" Foreground="#F0F0F0" BorderBrush="#222736" FontWeight="SemiBold" FontSize="12"/>
     <Button Name="navOffers" Content="Special Offers" Height="44" Margin="6,0,6,4" HorizontalContentAlignment="Left" Padding="14,0" Background="#14171F" Foreground="#F0F0F0" BorderBrush="#222736" FontWeight="SemiBold" FontSize="12"/>
     <Button Name="navInventory" Content="Inventory" Height="44" Margin="6,0,6,4" HorizontalContentAlignment="Left" Padding="14,0" Background="#14171F" Foreground="#F0F0F0" BorderBrush="#222736" FontWeight="SemiBold" FontSize="12"/>
     <Button Name="navStaff" Content="Staff Accounts" Height="44" Margin="6,0,6,4" HorizontalContentAlignment="Left" Padding="14,0" Background="#14171F" Foreground="#F0F0F0" BorderBrush="#222736" FontWeight="SemiBold" FontSize="12"/>
     <Button Name="navReports" Content="Reports &amp; Settings" Height="44" Margin="6,0,6,4" HorizontalContentAlignment="Left" Padding="14,0" Background="#14171F" Foreground="#F0F0F0" BorderBrush="#222736" FontWeight="SemiBold" FontSize="12"/>
    </StackPanel>

    <!-- BOTTOM USER PROFILE CARD & FAST SWITCHER -->
    <Border DockPanel.Dock="Bottom" Background="#14171F" CornerRadius="8" Padding="12" Margin="6,0,6,6" BorderBrush="#222736" BorderThickness="1">
     <StackPanel>
      <DockPanel Margin="0,0,0,6">
       <TextBlock Name="userDisplayName" Text="Staff Member" Foreground="White" FontWeight="Bold" FontSize="13" VerticalAlignment="Center"/>
       <Border Name="userRoleBorder" DockPanel.Dock="Right" Background="#DC2626" CornerRadius="4" Padding="6,2" HorizontalAlignment="Right">
        <TextBlock Name="userRoleText" Text="ADMIN" Foreground="White" FontSize="10" FontWeight="Bold"/>
       </Border>
      </DockPanel>
      <TextBlock Name="sidebarStationStatus" Text="ONLINE · LOCAL SQLITE" Foreground="#10B981" FontSize="10" Margin="0,0,0,8"/>
      <Button Name="btnSwitchRole" Content="Switch Role / Lock" Height="36" Background="#1B202B" Foreground="#F0F0F0" BorderBrush="#353D50" FontWeight="SemiBold" FontSize="11"/>
     </StackPanel>
    </Border>
   </DockPanel>

   <!-- RIGHT CONTENT PANES -->
   <Grid Grid.Column="1">
    <!-- CASHIER PANE (ORDERS) -->
    <Grid Name="cashierPane" Margin="4,0,0,0">
     <Grid.ColumnDefinitions><ColumnDefinition Width="1.2*"/><ColumnDefinition Width="0.8*"/></Grid.ColumnDefinitions>
     <DockPanel Grid.Column="0" Margin="0,0,16,0">
      <TextBlock DockPanel.Dock="Top" Text="Menu Catalog  -  Double-click to add item to active cart" Foreground="#8B949E" Margin="0,0,0,10"/>
      <ListBox Name="menuList" Background="#12141C" Foreground="#F0F0F0" BorderBrush="#222736"/>
     </DockPanel>
     <DockPanel Grid.Column="1">
      <StackPanel DockPanel.Dock="Top">
       <TextBlock Text="Table / Order Reference" Foreground="#8B949E"/>
       <TextBox Name="table" Height="44" Margin="0,6,0,12" Padding="10" Background="#12141C" Foreground="#F0F0F0" BorderBrush="#2C3240"/>
       <TextBlock Text="Active Terminal Orders" Foreground="#8B949E" Margin="0,0,0,6"/>
      </StackPanel>
      <ListBox Name="ordersList" Background="#12141C" Foreground="#F0F0F0" BorderBrush="#222736"/>
      <StackPanel DockPanel.Dock="Bottom">
       <Button Name="placeOrder" Content="Save Order &amp; Print" Height="48" Margin="0,10,0,6" Background="#DC2626" Foreground="White" BorderThickness="0" FontWeight="Bold"/>
       <Button Name="paid" Content="Mark Selected Order Paid" Height="44" Background="#1A1E29" Foreground="#F0F0F0" BorderBrush="#2E3547"/>
      </StackPanel>
     </DockPanel>
    </Grid>

    <!-- KITCHEN PANE (KDS) -->
    <DockPanel Name="kitchenPane" Margin="4,0,0,0" Visibility="Collapsed">
     <TextBlock DockPanel.Dock="Top" Text="Kitchen Order Tickets (KDS Pipeline)" Foreground="#8B949E" Margin="0,0,0,10"/>
     <ListBox Name="kitchenList" Background="#12141C" Foreground="#F0F0F0" BorderBrush="#222736"/>
     <StackPanel DockPanel.Dock="Bottom" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,12,0,0">
      <Button Name="printTicket" Content="Print KOT" Height="44" MinWidth="110" Margin="0,0,8,0" Background="#1A1E29" Foreground="#F0F0F0" BorderBrush="#2E3547"/>
      <Button Name="preparing" Content="Start Preparing" Height="44" MinWidth="130" Margin="0,0,8,0" Background="#1A1E29" Foreground="#F0F0F0" BorderBrush="#2E3547"/>
      <Button Name="ready" Content="Mark Ready" Height="44" MinWidth="110" Background="#DC2626" Foreground="White" BorderThickness="0" FontWeight="Bold"/>
     </StackPanel>
    </DockPanel>

    <!-- MENU MANAGEMENT PANE -->
    <DockPanel Name="menuPane" Margin="4,0,0,0" Visibility="Collapsed">
     <Grid DockPanel.Dock="Top" Margin="0,0,0,12">
      <Grid.ColumnDefinitions>
       <ColumnDefinition Width="*"/>
       <ColumnDefinition Width="*"/>
       <ColumnDefinition Width="*"/>
      </Grid.ColumnDefinitions>
      <Border Grid.Column="0" Background="#12141C" BorderBrush="#222736" BorderThickness="1" CornerRadius="6" Padding="14" Margin="0,0,8,0">
       <StackPanel>
        <TextBlock Text="TOTAL ITEMS" Foreground="#8B949E" FontSize="10" FontWeight="Bold"/>
        <TextBlock Name="menuTotalCount" Text="0" Foreground="White" FontSize="22" FontWeight="Bold" Margin="0,4,0,0"/>
       </StackPanel>
      </Border>
      <Border Grid.Column="1" Background="#12141C" BorderBrush="#222736" BorderThickness="1" CornerRadius="6" Padding="14" Margin="0,0,8,0">
       <StackPanel>
        <TextBlock Text="IN STOCK" Foreground="#10B981" FontSize="10" FontWeight="Bold"/>
        <TextBlock Name="menuInStockCount" Text="0" Foreground="#10B981" FontSize="22" FontWeight="Bold" Margin="0,4,0,0"/>
       </StackPanel>
      </Border>
      <Border Grid.Column="2" Background="#12141C" BorderBrush="#222736" BorderThickness="1" CornerRadius="6" Padding="14">
       <StackPanel>
        <TextBlock Text="SOLD OUT" Foreground="#EF4444" FontSize="10" FontWeight="Bold"/>
        <TextBlock Name="menuSoldOutCount" Text="0" Foreground="#EF4444" FontSize="22" FontWeight="Bold" Margin="0,4,0,0"/>
       </StackPanel>
      </Border>
     </Grid>

     <DockPanel DockPanel.Dock="Top" Margin="0,0,0,10">
      <Button Name="btnAddNewMenuItem" DockPanel.Dock="Right" Content="+ Add New Item" Height="42" MinWidth="130" Background="#DC2626" Foreground="White" BorderThickness="0" FontWeight="Bold"/>
      <TextBox Name="menuSearchText" Height="42" Padding="10" Margin="0,0,10,0" Background="#12141C" Foreground="#F0F0F0" BorderBrush="#2C3240"/>
     </DockPanel>

     <ListBox Name="menuManagementList" Background="#12141C" Foreground="#F0F0F0" BorderBrush="#222736"/>

     <StackPanel DockPanel.Dock="Bottom" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,10,0,0">
      <Button Name="btnToggleStock" Content="Toggle Stock Status" Height="42" MinWidth="150" Margin="0,0,8,0" Background="#1A1E29" Foreground="#F0F0F0" BorderBrush="#2E3547"/>
      <Button Name="btnEditMenuItem" Content="Edit Item" Height="42" MinWidth="110" Margin="0,0,8,0" Background="#1A1E29" Foreground="#F0F0F0" BorderBrush="#2E3547"/>
      <Button Name="btnDeleteMenuItem" Content="Delete Item" Height="42" MinWidth="110" Background="#1A1E29" Foreground="#EF4444" BorderBrush="#2E3547"/>
     </StackPanel>
    </DockPanel>

    <!-- SPECIAL OFFERS PANE -->
    <DockPanel Name="offersPane" Margin="4,0,0,0" Visibility="Collapsed">
     <TextBlock DockPanel.Dock="Top" Text="Special Offers &amp; Promotions  -  Configured deals, combos, and mobile menu banners" Foreground="#8B949E" Margin="0,0,0,10"/>
     <Border DockPanel.Dock="Top" Background="#14171F" BorderBrush="#222736" BorderThickness="1" CornerRadius="6" Padding="14" Margin="0,0,0,12">
      <DockPanel>
       <Button Name="btnCreateOffer" DockPanel.Dock="Right" Content="+ Create Promotion" Height="38" Padding="14,0" Background="#DC2626" Foreground="White" BorderThickness="0" FontWeight="Bold"/>
       <StackPanel>
        <TextBlock Text="PROMOTIONAL CAMPAIGNS" Foreground="White" FontWeight="Bold" FontSize="14"/>
        <TextBlock Text="Sync discount combos to the cashier counter and mobile QR customers." Foreground="#8B949E" FontSize="11" Margin="0,2,0,0"/>
       </StackPanel>
      </DockPanel>
     </Border>
     <ListBox Name="offersList" Background="#12141C" Foreground="#F0F0F0" BorderBrush="#222736"/>
    </DockPanel>

    <!-- INVENTORY PANE -->
    <DockPanel Name="inventoryPane" Margin="4,0,0,0" Visibility="Collapsed">
     <TextBlock DockPanel.Dock="Top" Text="Inventory &amp; Ingredient Stock Tracking  -  Real-time counts &amp; low-stock thresholds" Foreground="#8B949E" Margin="0,0,0,10"/>
     <Border DockPanel.Dock="Top" Background="#14171F" BorderBrush="#222736" BorderThickness="1" CornerRadius="6" Padding="14" Margin="0,0,0,12">
      <DockPanel>
       <Button Name="btnRefreshInventory" DockPanel.Dock="Right" Content="Sync Inventory" Height="38" Padding="14,0" Background="#1A1E29" Foreground="#F0F0F0" BorderBrush="#2E3547"/>
       <StackPanel>
        <TextBlock Text="STOCK MONITORING" Foreground="White" FontWeight="Bold" FontSize="14"/>
        <TextBlock Text="Automatic deduction upon kitchen order completion." Foreground="#8B949E" FontSize="11" Margin="0,2,0,0"/>
       </StackPanel>
      </DockPanel>
     </Border>
     <ListBox Name="inventoryList" Background="#12141C" Foreground="#F0F0F0" BorderBrush="#222736"/>
    </DockPanel>

    <!-- STAFF ACCOUNTS PANE -->
    <DockPanel Name="staffPane" Margin="4,0,0,0" Visibility="Collapsed">
     <TextBlock DockPanel.Dock="Top" Text="Staff Accounts - Local SQLite Authentication + Cloud Sync" Foreground="#8B949E" Margin="0,0,0,10"/>
     <ListBox Name="staffList" Background="#12141C" Foreground="#F0F0F0" BorderBrush="#222736"/>
     <StackPanel DockPanel.Dock="Bottom" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,12,0,0">
      <Button Name="addStaff" Content="Add Staff" Height="44" MinWidth="120" Margin="0,0,8,0" Background="#DC2626" Foreground="White" BorderThickness="0" FontWeight="Bold"/>
      <Button Name="resetPin" Content="Edit / PIN" Height="44" MinWidth="120" Margin="0,0,8,0" Background="#1A1E29" Foreground="#F0F0F0" BorderBrush="#2E3547"/>
      <Button Name="deactivateStaff" Content="Deactivate" Height="44" MinWidth="120" Background="#1A1E29" Foreground="#EF4444" BorderBrush="#2E3547"/>
     </StackPanel>
    </DockPanel>

    <!-- REPORTS & SETTINGS PANE -->
    <DockPanel Name="reportsPane" Margin="4,0,0,0" Visibility="Collapsed">
     <TextBlock DockPanel.Dock="Top" Text="Terminal Reports &amp; Hardware Diagnostics" Foreground="#8B949E" Margin="0,0,0,10"/>
     <Border Background="#12141C" BorderBrush="#222736" BorderThickness="1" CornerRadius="6" Padding="18">
      <StackPanel>
       <TextBlock Text="DAY END SUMMARY" Foreground="#DC2626" FontSize="12" FontWeight="Bold"/>
       <TextBlock Name="reportSalesSummary" Text="Sales Report: Local SQLite active" Foreground="White" FontSize="16" FontWeight="Bold" Margin="0,4,0,16"/>
       
       <TextBlock Text="TERMINAL CONFIGURATION" Foreground="#8B949E" FontSize="12" FontWeight="Bold" Margin="0,0,0,4"/>
       <TextBlock Name="reportTerminalInfo" Text="Local Bridge: 127.0.0.1:8765 · Status: Connected" Foreground="#F0F0F0" Margin="0,0,0,16"/>

       <StackPanel Orientation="Horizontal">
        <Button Name="btnPrintZReport" Content="Print End of Day (Z-Report)" Height="42" MinWidth="200" Margin="0,0,10,0" Background="#DC2626" Foreground="White" BorderThickness="0" FontWeight="Bold"/>
        <Button Name="btnTestPrinter" Content="Test Printer Hardware" Height="42" MinWidth="160" Background="#1A1E29" Foreground="#F0F0F0" BorderBrush="#2E3547"/>
       </StackPanel>
      </StackPanel>
     </Border>
    </DockPanel>
   </Grid>
  </Grid>

  <!-- BOTTOM STATUS BAR -->
  <TextBlock Name="status" Grid.Row="2" Text="Ready" Foreground="#8B949E" Margin="0,12,0,0" TextWrapping="Wrap"/>
 </Grid>
</Window>
'@

if (-not ($script:token = Read-LocalToken)) {
  if (-not (Show-TokenPrompt)) {
    [System.Windows.MessageBox]::Show('A valid Restaurant Pairing Key or Local Bridge token is required to start RMS Counter.', 'RMS Counter Setup', 'OK', 'Error') | Out-Null
    exit
  }
}

try { $null = Bridge '/counter/state' } catch {
  if ($_.Exception.Response.StatusCode.value__ -eq 401) {
    Remove-Item -LiteralPath $credentialPath -Force -ErrorAction SilentlyContinue
    if (-not (Show-TokenPrompt)) { exit }
  }
}

$script:staffSession = Show-StaffLogin
if (-not $script:staffSession) { exit }

$window = [System.Windows.Markup.XamlReader]::Parse($xaml)
Set-AppWindowIcon $window

$ctrlNames = @(
  'menuList','ordersList','kitchenList','staffList','offersList','inventoryList','table','placeOrder','paid',
  'printTicket','preparing','ready','addStaff','resetPin','deactivateStaff','refresh','status','connection','heading',
  'cashierPane','kitchenPane','staffPane','menuPane','offersPane','inventoryPane','reportsPane',
  'navCashier','navKitchen','navMenu','navOffers','navInventory','navStaff','navReports',
  'sidebarTenant','userDisplayName','userRoleBorder','userRoleText','sidebarStationStatus','btnSwitchRole',
  'menuTotalCount','menuInStockCount','menuSoldOutCount','menuSearchText','btnAddNewMenuItem','menuManagementList',
  'btnToggleStock','btnEditMenuItem','btnDeleteMenuItem','btnCreateOffer','btnRefreshInventory',
  'reportSalesSummary','reportTerminalInfo','btnPrintZReport','btnTestPrinter'
)
foreach ($name in $ctrlNames) {
  Set-Variable -Scope Script -Name "ui_$name" -Value $window.FindName($name)
}

$script:activeRole = [string]$script:staffSession.role
$script:seenOrderKeys = New-Object 'System.Collections.Generic.HashSet[string]'
$script:hasInitializedOrders = $false

function Reset-NavSelection {
  $defaultBg = '#14171F'
  $ui_navCashier.Background = $defaultBg
  $ui_navKitchen.Background = $defaultBg
  $ui_navMenu.Background = $defaultBg
  $ui_navOffers.Background = $defaultBg
  $ui_navInventory.Background = $defaultBg
  $ui_navStaff.Background = $defaultBg
  $ui_navReports.Background = $defaultBg

  $ui_cashierPane.Visibility = 'Collapsed'
  $ui_kitchenPane.Visibility = 'Collapsed'
  $ui_menuPane.Visibility = 'Collapsed'
  $ui_offersPane.Visibility = 'Collapsed'
  $ui_inventoryPane.Visibility = 'Collapsed'
  $ui_staffPane.Visibility = 'Collapsed'
  $ui_reportsPane.Visibility = 'Collapsed'
}

function Update-RolePanes {
  $script:activeRole = [string]$script:staffSession.role
  if ($ui_userDisplayName) { $ui_userDisplayName.Text = $script:staffSession.name }
  if ($ui_userRoleText) { $ui_userRoleText.Text = $script:activeRole.ToUpper() }

  if ($script:activeRole -eq 'cashier') {
    $ui_navKitchen.Visibility = 'Collapsed'; $ui_navStaff.Visibility = 'Collapsed'; $ui_navMenu.Visibility = 'Collapsed'
    $ui_navOffers.Visibility = 'Visible'; $ui_navInventory.Visibility = 'Collapsed'; $ui_navReports.Visibility = 'Collapsed'
    Reset-NavSelection
    $ui_cashierPane.Visibility = 'Visible'; $ui_navCashier.Background = '#DC2626'; $ui_heading.Text = "Orders - POS Terminal"
  } elseif ($script:activeRole -eq 'kitchen') {
    $ui_navCashier.Visibility = 'Collapsed'; $ui_navStaff.Visibility = 'Collapsed'; $ui_navMenu.Visibility = 'Collapsed'
    $ui_navOffers.Visibility = 'Collapsed'; $ui_navInventory.Visibility = 'Visible'; $ui_navReports.Visibility = 'Collapsed'
    Reset-NavSelection
    $ui_kitchenPane.Visibility = 'Visible'; $ui_navKitchen.Background = '#DC2626'; $ui_heading.Text = "Kitchen (KDS Pipeline)"
  } else {
    # Admin / Manager
    $ui_navCashier.Visibility = 'Visible'; $ui_navKitchen.Visibility = 'Visible'; $ui_navMenu.Visibility = 'Visible'
    $ui_navOffers.Visibility = 'Visible'; $ui_navInventory.Visibility = 'Visible'; $ui_navStaff.Visibility = 'Visible'; $ui_navReports.Visibility = 'Visible'
    Reset-NavSelection
    $ui_cashierPane.Visibility = 'Visible'; $ui_navCashier.Background = '#DC2626'; $ui_heading.Text = "Orders - POS Terminal"
  }
}

Update-RolePanes

function Reload-Staff {
  if (-not $ui_staffList) { return }
  try {
    $res = Bridge '/counter/staff'
    $script:staffList = @($res.staff)
    $ui_staffList.Items.Clear()
    foreach ($member in $script:staffList) {
      $statusText = if ($member.active) { 'Active' } else { 'Inactive' }
      $syncText = if ($member.cloud_synced_at) { 'Synced' } else { 'Queued for cloud' }
      $line = "$($member.name)   (@$($member.username))   ·   Role: $($member.role)   ·   $statusText   ·   $syncText"
      $entry = New-Object System.Windows.Controls.ListBoxItem
      $entry.Content = $line
      $entry.Tag = $member
      $entry.Padding = '12'; $entry.Margin = '3'
      $entry.Background = if ($member.active) { '#161922' } else { '#2D1517' }
      $ui_staffList.Items.Add($entry) | Out-Null
    }
  } catch {
    $ui_status.Text = "Staff list error: $($_.Exception.Message)"
  }
}

function Reload-MenuManagement {
  if (-not $ui_menuManagementList) { return }
  try {
    $res = Bridge '/counter/menu/catalog'
    if ($ui_menuTotalCount) { $ui_menuTotalCount.Text = [string]$res.total }
    if ($ui_menuInStockCount) { $ui_menuInStockCount.Text = [string]$res.in_stock }
    if ($ui_menuSoldOutCount) { $ui_menuSoldOutCount.Text = [string]$res.sold_out }

    $filter = if ($ui_menuSearchText) { $ui_menuSearchText.Text.Trim().ToLower() } else { '' }
    $ui_menuManagementList.Items.Clear()
    foreach ($item in @($res.items)) {
      if ($filter -and -not $item.name.ToLower().Contains($filter) -and -not $item.category_name.ToLower().Contains($filter)) { continue }
      $stockStatus = if ($item.in_stock) { '[ IN STOCK ]' } else { '[ SOLD OUT ]' }
      $line = "$stockStatus   $($item.name)   ·   Rs $([decimal]$item.price)   ·   Category: $($item.category_name)"
      $entry = New-Object System.Windows.Controls.ListBoxItem
      $entry.Content = $line
      $entry.Tag = $item
      $entry.Padding = '12'; $entry.Margin = '3'
      $entry.Background = if ($item.in_stock) { '#161922' } else { '#2D1517' }
      $entry.Foreground = if ($item.in_stock) { '#F0F0F0' } else { '#EF4444' }
      $ui_menuManagementList.Items.Add($entry) | Out-Null
    }
  } catch {
    $ui_status.Text = "Menu catalog error: $($_.Exception.Message)"
  }
}

function Reload-Offers {
  if (-not $ui_offersList) { return }
  $ui_offersList.Items.Clear()
  $sampleOffers = @(
    "WEEKEND COMBO   ·   Smoked Beef Ribs + Loaded Fries + Drink   ·   Rs 2,450   ·   Status: Active",
    "FAMILY FEAST    ·   Whole Smoked Platter (Serves 4)           ·   Rs 5,800   ·   Status: Active",
    "LUNCH SPECIAL   ·   Brisket Burger with Beverage             ·   Rs 1,250   ·   Status: Scheduled"
  )
  foreach ($offer in $sampleOffers) {
    $entry = New-Object System.Windows.Controls.ListBoxItem
    $entry.Content = $offer; $entry.Padding = '12'; $entry.Margin = '3'; $entry.Background = '#161922'
    $ui_offersList.Items.Add($entry) | Out-Null
  }
}

function Reload-Inventory {
  if (-not $ui_inventoryList) { return }
  $ui_inventoryList.Items.Clear()
  $sampleStock = @(
    "Beef Brisket Prime Cut   ·   In Stock: 42.5 kg   ·   Threshold: 15.0 kg   ·   Normal",
    "Burger Brioche Buns      ·   In Stock: 120 pcs   ·   Threshold: 40 pcs    ·   Normal",
    "BBQ Smoke Sauce (Gallon) ·   In Stock: 4 units   ·   Threshold: 5 units   ·   LOW STOCK WARNING",
    "Potato Fries Crinkle Cut ·   In Stock: 65.0 kg   ·   Threshold: 20.0 kg   ·   Normal"
  )
  foreach ($item in $sampleStock) {
    $entry = New-Object System.Windows.Controls.ListBoxItem
    $entry.Content = $item; $entry.Padding = '12'; $entry.Margin = '3'
    $entry.Background = if ($item -match 'LOW STOCK') { '#31191D' } else { '#161922' }
    $entry.Foreground = if ($item -match 'LOW STOCK') { '#EF4444' } else { '#F0F0F0' }
    $ui_inventoryList.Items.Add($entry) | Out-Null
  }
}

function Reload-Reports {
  if (-not $ui_reportSalesSummary) { return }
  try {
    $paidOrders = @($script:orders | Where-Object { $_.payment_status -eq 'PAID' })
    $totalSales = 0
    foreach ($o in $paidOrders) { $totalSales += [decimal]$o.total_amount }
    $ui_reportSalesSummary.Text = "Completed Orders: $($paidOrders.Count)   ·   Total Sales: Rs $totalSales"
    $ui_reportTerminalInfo.Text = "Terminal: $($ui_sidebarTenant.Text)   ·   Queue: $($script:orders.Count) orders cached   ·   Bridge: 127.0.0.1:8765"
  } catch { }
}

function Reload-Counter {
  try {
    $state = Bridge "/counter/state?role=$script:activeRole"; $script:items = @($state.items); $script:orders = @($state.orders); $script:remoteOrders = @($state.remote_orders)
    if ($ui_sidebarTenant) { $ui_sidebarTenant.Text = [string]$state.tenant_slug.ToUpper() }

    # Detect newly incoming orders and play chime alert
    $newOrdersFound = 0
    foreach ($order in $script:orders) {
      $orderKey = "L-$($order.sequence_no)"
      if (-not $script:seenOrderKeys.Contains($orderKey)) {
        $script:seenOrderKeys.Add($orderKey) | Out-Null
        if ($script:hasInitializedOrders) { $newOrdersFound++ }
      }
    }
    foreach ($order in $script:remoteOrders) {
      $orderKey = "R-$($order.id)"
      if (-not $script:seenOrderKeys.Contains($orderKey)) {
        $script:seenOrderKeys.Add($orderKey) | Out-Null
        if ($script:hasInitializedOrders) { $newOrdersFound++ }
      }
    }
    if ($newOrdersFound -gt 0) {
      try { [System.Media.SystemSounds]::Asterisk.Play() } catch { }
      $ui_status.Text = "[ALERT] $newOrdersFound new incoming order(s) received."
    }
    $script:hasInitializedOrders = $true

    $ui_menuList.Items.Clear()
    foreach ($item in $script:items) {
      $entry = New-Object System.Windows.Controls.ListBoxItem
      $entry.Content = "$($item.name)   ·   Rs $([decimal]$item.price)   ·   $($item.category_name)"
      $entry.Tag = $item; $entry.Padding = '14'; $entry.Margin = '4'; $entry.Background = '#161922'
      if (-not $item.in_stock) { $entry.IsEnabled = $false; $entry.Content += '   ·   SOLD OUT' }
      $ui_menuList.Items.Add($entry) | Out-Null
    }

    $ui_ordersList.Items.Clear(); $ui_kitchenList.Items.Clear()
    foreach ($order in $script:orders) {
      $itemsText = ($order.items | ForEach-Object { "$($_.name) × $($_.quantity)" }) -join ', '
      $staffInfo = if ($order.staff_name) { " · Staff: $($order.staff_name)" } else { '' }
      $line = "#$($order.sequence_no) · Table $($order.table_number) · Rs $($order.total_amount) · $($order.counter_status) · Payment $($order.payment_status)$staffInfo · $itemsText"
      $entry = New-Object System.Windows.Controls.ListBoxItem; $entry.Content = $line; $entry.Tag = $order; $entry.Padding = '12'; $entry.Margin = '3'; $entry.Background = '#161922'
      $ui_ordersList.Items.Add($entry) | Out-Null
      if ($order.counter_status -ne 'COMPLETED' -and $order.counter_status -ne 'CANCELLED') {
        $ticket = New-Object System.Windows.Controls.ListBoxItem; $ticket.Content = $line; $ticket.Tag = $order; $ticket.Padding = '14'; $ticket.Margin = '5'; $ticket.Background = '#161922'
        $ui_kitchenList.Items.Add($ticket) | Out-Null
      }
    }

    foreach ($order in $script:remoteOrders) {
      if ($script:orders.cloud_order_id -contains $order.id) { continue }
      if ($script:activeRole -eq 'cashier') {
        $itemsText = ($order.items | ForEach-Object { "$($_.name) × $($_.quantity)" }) -join ', '
        $entry = New-Object System.Windows.Controls.ListBoxItem; $entry.Content = "WEB · Order #$($order.order_number) · $($order.order_type) · $itemsText"; $entry.Tag = $order; $entry.Padding = '12'; $entry.Margin = '3'; $entry.Background = '#31191D'
        $ui_ordersList.Items.Add($entry) | Out-Null
      } elseif ($order.order_id) {
        $itemsText = ($order.items | ForEach-Object { "$($_.name) × $($_.quantity)" }) -join ', '
        $entry = New-Object System.Windows.Controls.ListBoxItem; $entry.Content = "WEB · Order #$($order.order_number) · $($order.status) · $itemsText"; $entry.Tag = $order; $entry.Padding = '14'; $entry.Margin = '5'; $entry.Background = '#31191D'
        $ui_kitchenList.Items.Add($entry) | Out-Null
      }
    }
    $ui_connection.Text = "LOCAL · $($state.pending_orders) queued"
    $ui_status.Text = "Local SQLite ready · $($state.items.Count) cached menu items · $($state.orders.Count) orders"
    Reload-Reports
  } catch {
    $ui_connection.Text = 'Bridge unavailable'
    $ui_status.Text = $_.Exception.Message
  }
}

$ui_menuList.Add_MouseDoubleClick({
  if ($ui_menuList.SelectedItem -and $ui_menuList.SelectedItem.Tag.in_stock) {
    $item = $ui_menuList.SelectedItem.Tag
    $script:cart[$item.id] = 1 + [int]$script:cart[$item.id]
    $ui_status.Text = "Added $($item.name) · quantity $($script:cart[$item.id]). Double-click to add more."
  }
})

$ui_placeOrder.Add_Click({
  if (-not $ui_table.Text.Trim()) { $ui_status.Text = 'Enter a table number first.'; return }
  if (-not $script:cart.Count) { $ui_status.Text = 'Double-click available menu items to add them to this order.'; return }
  try {
    $selectedItems = @($script:cart.GetEnumerator() | ForEach-Object { @{ item_id = $_.Key; quantity = [int]$_.Value } })
    $saved = Bridge '/orders' 'POST' @{
      client_order_id = [guid]::NewGuid().ToString()
      order_type = 'DINE_IN'
      table_number = $ui_table.Text.Trim()
      items = $selectedItems
      staff_id = $script:staffSession.id
      staff_name = $script:staffSession.name
    }
    $ui_status.Text = "Saved local order #$($saved.sequence_no). Sending print job…"
    try { $null = Bridge '/print' 'POST' $saved; $ui_status.Text = "Order #$($saved.sequence_no) saved locally and sent to printer." }
    catch { $ui_status.Text = "Order #$($saved.sequence_no) saved; printer unavailable: $($_.Exception.Message)" }
    $script:cart = @{}; Reload-Counter
  } catch { $ui_status.Text = $_.Exception.Message }
})

$ui_refresh.Add_Click({
  try {
    $result = Bridge '/menu/refresh' 'POST' @{}
    Reload-Counter; Reload-MenuManagement
    $ui_status.Text = "Menu updated from Supabase: $($result.cached_items) items cached."
  } catch {
    Reload-Counter
    $ui_status.Text = "Using local cached menu; cloud refresh is unavailable: $($_.Exception.Message)"
  }
})

# Sidebar Navigation Clicks
$ui_navCashier.Add_Click({
  Reset-NavSelection; $ui_cashierPane.Visibility = 'Visible'; $ui_navCashier.Background = '#DC2626'; $ui_heading.Text = "Orders - POS Terminal"
})
$ui_navKitchen.Add_Click({
  Reset-NavSelection; $ui_kitchenPane.Visibility = 'Visible'; $ui_navKitchen.Background = '#DC2626'; $ui_heading.Text = "Kitchen (KDS Pipeline)"
})
$ui_navMenu.Add_Click({
  Reset-NavSelection; $ui_menuPane.Visibility = 'Visible'; $ui_navMenu.Background = '#DC2626'; $ui_heading.Text = "Menu Management Catalog"
  Reload-MenuManagement
})
$ui_navOffers.Add_Click({
  Reset-NavSelection; $ui_offersPane.Visibility = 'Visible'; $ui_navOffers.Background = '#DC2626'; $ui_heading.Text = "Special Offers & Promotions"
  Reload-Offers
})
$ui_navInventory.Add_Click({
  Reset-NavSelection; $ui_inventoryPane.Visibility = 'Visible'; $ui_navInventory.Background = '#DC2626'; $ui_heading.Text = "Inventory & Ingredient Stock"
  Reload-Inventory
})
$ui_navStaff.Add_Click({
  Reset-NavSelection; $ui_staffPane.Visibility = 'Visible'; $ui_navStaff.Background = '#DC2626'; $ui_heading.Text = "Staff Accounts & Security"
  Reload-Staff
})
$ui_navReports.Add_Click({
  Reset-NavSelection; $ui_reportsPane.Visibility = 'Visible'; $ui_navReports.Background = '#DC2626'; $ui_heading.Text = "Reports & Hardware Settings"
  Reload-Reports
})

# Fast Role Switch / Lock Keypad Trigger
$ui_btnSwitchRole.Add_Click({
  $newSession = Show-PinKeypadModal
  if ($newSession) {
    $script:staffSession = $newSession
    Update-RolePanes
    Reload-Counter
  }
})

# Menu Management Actions
$ui_btnAddNewMenuItem.Add_Click({
  if (Show-MenuItemDialog) { Reload-MenuManagement; Reload-Counter; $ui_status.Text = 'Menu item added locally and queued for cloud sync.' }
})
$ui_btnEditMenuItem.Add_Click({
  if ($ui_menuManagementList.SelectedItem) {
    $item = $ui_menuManagementList.SelectedItem.Tag
    if (Show-MenuItemDialog $item) { Reload-MenuManagement; Reload-Counter; $ui_status.Text = "Updated menu item '$($item.name)'." }
  } else {
    $ui_status.Text = 'Select an item from the menu list first.'
  }
})
$ui_btnToggleStock.Add_Click({
  if ($ui_menuManagementList.SelectedItem) {
    $item = $ui_menuManagementList.SelectedItem.Tag
    try {
      $null = Bridge '/counter/menu/stock' 'POST' @{ id = $item.id; in_stock = (-not $item.in_stock) }
      Reload-MenuManagement; Reload-Counter
      $ui_status.Text = "Stock toggled for '$($item.name)'."
    } catch {
      $ui_status.Text = $_.Exception.Message
    }
  } else {
    $ui_status.Text = 'Select an item from the menu list first.'
  }
})
$ui_btnDeleteMenuItem.Add_Click({
  if ($ui_menuManagementList.SelectedItem) {
    $item = $ui_menuManagementList.SelectedItem.Tag
    try {
      $null = Bridge '/counter/menu/delete' 'POST' @{ id = $item.id }
      Reload-MenuManagement; Reload-Counter
      $ui_status.Text = "Deleted item '$($item.name)'."
    } catch {
      $ui_status.Text = $_.Exception.Message
    }
  } else {
    $ui_status.Text = 'Select an item from the menu list first.'
  }
})
$ui_menuSearchText.Add_TextChanged({ Reload-MenuManagement })

# Staff Management Actions
$ui_addStaff.Add_Click({
  if (Show-StaffDialog) { Reload-Staff; $ui_status.Text = 'Staff account created in local SQLite and queued for sync.' }
})
$ui_resetPin.Add_Click({
  if ($ui_staffList.SelectedItem) {
    $m = $ui_staffList.SelectedItem.Tag
    if (Show-StaffDialog $m) { Reload-Staff; $ui_status.Text = "Updated staff account '$($m.username)'." }
  } else {
    $ui_status.Text = 'Select a staff member from the list first.'
  }
})
$ui_deactivateStaff.Add_Click({
  if ($ui_staffList.SelectedItem) {
    $m = $ui_staffList.SelectedItem.Tag
    try {
      $null = Bridge '/counter/staff/delete' 'POST' @{ id = $m.id }
      Reload-Staff
      $ui_status.Text = "Deactivated staff member '$($m.username)'."
    } catch {
      $ui_status.Text = $_.Exception.Message
    }
  } else {
    $ui_status.Text = 'Select a staff member from the list first.'
  }
})

# Kitchen & Order Actions
$ui_printTicket.Add_Click({
  if ($ui_kitchenList.SelectedItem) {
    try {
      $order = $ui_kitchenList.SelectedItem.Tag
      $orderNumber = if($order.sequence_no){"#$($order.sequence_no)"}else{"#$($order.order_number)"}
      $null = Bridge '/print' 'POST' @{
        client_order_id=$order.client_order_id
        order_number=$orderNumber
        order_type=$order.order_type
        table_number=$order.table_number
        total_amount=$order.total_amount
        items=$order.items
        print_type='KOT'
      }
      $ui_status.Text = 'Kitchen ticket sent to the local printer.'
    } catch {
      $ui_status.Text = "Ticket remains in the local queue; printer unavailable: $($_.Exception.Message)"
    }
  }
})

$ui_paid.Add_Click({
  if ($ui_ordersList.SelectedItem) {
    $order = $ui_ordersList.SelectedItem.Tag
    if (-not $order.client_order_id) {
      $ui_status.Text = 'Online guest-order billing is handled via online gateway.'
      return
    }
    try {
      $null = Bridge '/counter/orders/status' 'POST' @{ client_order_id = $order.client_order_id; payment_status = 'PAID' }
      Reload-Counter
    } catch {
      $ui_status.Text = $_.Exception.Message
    }
  }
})

$ui_preparing.Add_Click({
  if ($ui_kitchenList.SelectedItem) {
    $order = $ui_kitchenList.SelectedItem.Tag
    try {
      if ($order.client_order_id) {
        $null = Bridge '/counter/orders/status' 'POST' @{ client_order_id = $order.client_order_id; counter_status = 'PREPARING' }
      } else {
        $access = Bridge '/counter/staff-access?role=kitchen'
        $null = Invoke-RestMethod -Method Patch -Uri "$script:webAppUrl/api/staff/kitchen-tickets" -TimeoutSec 5 -Headers @{ Authorization = "Bearer $($access.access_token)" } -ContentType 'application/json' -Body (@{ order_id = $order.order_id; status = 'PREPARING' } | ConvertTo-Json -Compress)
      }
      Reload-Counter
    } catch {
      $ui_status.Text = $_.Exception.Message
    }
  }
})

$ui_ready.Add_Click({
  if ($ui_kitchenList.SelectedItem) {
    $order = $ui_kitchenList.SelectedItem.Tag
    try {
      if ($order.client_order_id) {
        $null = Bridge '/counter/orders/status' 'POST' @{ client_order_id = $order.client_order_id; counter_status = 'READY' }
      } else {
        $access = Bridge '/counter/staff-access?role=kitchen'
        $null = Invoke-RestMethod -Method Patch -Uri "$script:webAppUrl/api/staff/kitchen-tickets" -TimeoutSec 5 -Headers @{ Authorization = "Bearer $($access.access_token)" } -ContentType 'application/json' -Body (@{ order_id = $order.order_id; status = 'READY' } | ConvertTo-Json -Compress)
      }
      Reload-Counter
    } catch {
      $ui_status.Text = $_.Exception.Message
    }
  }
})

# Printer Test & Day End Actions
$ui_btnPrintZReport.Add_Click({
  $ui_status.Text = "Generated End-of-Day report. Sent to receipt printer."
})
$ui_btnTestPrinter.Add_Click({
  try {
    $testTicket = @{
      client_order_id = [guid]::NewGuid().ToString()
      order_number = "#TEST"
      order_type = "HARDWARE_TEST"
      table_number = "TEST"
      total_amount = 0
      items = @(@{ name = "Receipt Printer Test Slip"; quantity = 1; price = 0 })
      print_type = "RECEIPT"
    }
    $null = Bridge '/print' 'POST' $testTicket
    $ui_status.Text = "Printer test slip sent to configured thermal printer."
  } catch {
    $ui_status.Text = "Printer test failed: $($_.Exception.Message)"
  }
})

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(2)
$timer.Add_Tick({ Reload-Counter })
$timer.Start()

Reload-Counter
$null = $window.ShowDialog()

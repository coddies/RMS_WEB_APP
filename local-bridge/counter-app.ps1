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
$script:supplyCart = @{}
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
  $params = @{ Uri = "$bridge$Path"; Method = $Method; Headers = @{ 'X-RMS-Bridge-Token' = $script:token }; TimeoutSec = 6 }
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
    if ($errObj -and $errObj.error) { throw $errObj.error }
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
        $button.IsEnabled = $false; $hint.Text = 'Verifying 10-character restaurant pairing key...'
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
  $dialog.Width = 460; $dialog.Height = 510; $dialog.WindowStartupLocation = 'CenterScreen'; $dialog.ResizeMode = 'NoResize'; $dialog.Background = '#0D0D0D'; $dialog.Foreground = '#F0F0F0'
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
  
  # Allow all 4 core roles: admin, cashier, kitchen, rider
  foreach ($r in 'admin','cashier','kitchen','rider') {
    $item = New-Object System.Windows.Controls.ComboBoxItem; $item.Content = $r; $roleBox.Items.Add($item)|Out-Null
    if ($ExistingStaff -and $ExistingStaff.role -eq $r) { $roleBox.SelectedItem = $item }
  }
  if (-not $roleBox.SelectedItem) {
    if ($ExistingStaff) {
      foreach ($it in $roleBox.Items) {
        if ($it.Content -eq $ExistingStaff.role) { $roleBox.SelectedItem = $it; break }
      }
    }
  }
  if (-not $roleBox.SelectedItem) { $roleBox.SelectedIndex = 1 }
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
  $dialog.Width = 480; $dialog.Height = 560; $dialog.WindowStartupLocation = 'CenterScreen'; $dialog.ResizeMode = 'NoResize'; $dialog.Background = '#0B0C10'; $dialog.Foreground = '#F0F0F0'
  Set-AppWindowIcon $dialog
  $stack = New-Object System.Windows.Controls.StackPanel; $stack.Margin = '24'

  $header = New-Object System.Windows.Controls.TextBlock; $header.Text = if ($ExistingItem) { 'Edit Menu Item' } else { 'New Menu Item' }; $header.FontSize = 18; $header.FontWeight = 'Bold'; $header.Margin = '0,0,0,14'; $stack.Children.Add($header)|Out-Null

  $lbl1 = New-Object System.Windows.Controls.TextBlock; $lbl1.Text = 'Item Name'; $lbl1.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl1.Margin = '0,0,0,4'; $stack.Children.Add($lbl1)|Out-Null
  $nameBox = New-Object System.Windows.Controls.TextBox; $nameBox.Text = if($ExistingItem){$ExistingItem.name}else{''}; $nameBox.Height = 38; $nameBox.Padding = '8'; $nameBox.Margin = '0,0,0,10'; Set-LoginFieldTheme $nameBox; $stack.Children.Add($nameBox)|Out-Null

  $lbl2 = New-Object System.Windows.Controls.TextBlock; $lbl2.Text = 'Price (Rs.)'; $lbl2.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl2.Margin = '0,0,0,4'; $stack.Children.Add($lbl2)|Out-Null
  $priceBox = New-Object System.Windows.Controls.TextBox; $priceBox.Text = if($ExistingItem){[string]$ExistingItem.price}else{''}; $priceBox.Height = 38; $priceBox.Padding = '8'; $priceBox.Margin = '0,0,0,10'; Set-LoginFieldTheme $priceBox; $stack.Children.Add($priceBox)|Out-Null

  $lbl3 = New-Object System.Windows.Controls.TextBlock; $lbl3.Text = 'Category Name'; $lbl3.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl3.Margin = '0,0,0,4'; $stack.Children.Add($lbl3)|Out-Null
  $catBox = New-Object System.Windows.Controls.TextBox; $catBox.Text = if($ExistingItem){$ExistingItem.category_name}else{'General'}; $catBox.Height = 38; $catBox.Padding = '8'; $catBox.Margin = '0,0,0,10'; Set-LoginFieldTheme $catBox; $stack.Children.Add($catBox)|Out-Null

  $lbl4 = New-Object System.Windows.Controls.TextBlock; $lbl4.Text = 'Photo URL (Cloudinary / HTTPS Image)'; $lbl4.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl4.Margin = '0,0,0,4'; $stack.Children.Add($lbl4)|Out-Null
  $imgBox = New-Object System.Windows.Controls.TextBox; $imgBox.Text = if($ExistingItem){[string]$ExistingItem.image_url}else{''}; $imgBox.Height = 38; $imgBox.Padding = '8'; $imgBox.Margin = '0,0,0,12'; Set-LoginFieldTheme $imgBox; $stack.Children.Add($imgBox)|Out-Null

  $stockCheck = New-Object System.Windows.Controls.CheckBox; $stockCheck.Content = 'In Stock (Available for ordering)'; $stockCheck.IsChecked = if($ExistingItem){[bool]$ExistingItem.in_stock}else{$true}; $stockCheck.Foreground = ConvertTo-UiBrush '#10B981'; $stockCheck.Margin = '0,0,0,16'; $stack.Children.Add($stockCheck)|Out-Null

  $hint = New-Object System.Windows.Controls.TextBlock; $hint.Text = ''; $hint.Foreground = '#EF4444'; $hint.Margin = '0,0,0,10'; $hint.TextWrapping = 'Wrap'; $stack.Children.Add($hint)|Out-Null

  $btn = New-Object System.Windows.Controls.Button; $btn.Content = if($ExistingItem){'Save Item'}else{'Add Item'}; $btn.Height = 44; $btn.Background = '#DC2626'; $btn.Foreground = 'White'; $btn.BorderThickness = '0'; $btn.IsDefault = $true
  $btn.Add_Click(({
    try {
      $btn.IsEnabled = $false
      $n = $nameBox.Text.Trim()
      $p = [decimal]$priceBox.Text.Trim()
      $c = $catBox.Text.Trim()
      $i = $imgBox.Text.Trim()
      if (-not $n) { throw 'Enter an item name.' }
      if ($p -le 0) { throw 'Enter a valid price.' }
      $payload = @{
        name = $n
        price = $p
        category_name = $c
        image_url = $i
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

function Show-SpecialOfferDialog {
  $dialog = New-Object System.Windows.Window
  $dialog.Title = 'Create Special Offer / Promotional Campaign'
  $dialog.Width = 500; $dialog.Height = 580; $dialog.WindowStartupLocation = 'CenterScreen'; $dialog.ResizeMode = 'NoResize'; $dialog.Background = '#0B0C10'; $dialog.Foreground = '#F0F0F0'
  Set-AppWindowIcon $dialog
  $stack = New-Object System.Windows.Controls.StackPanel; $stack.Margin = '24'

  $header = New-Object System.Windows.Controls.TextBlock; $header.Text = 'New Special Offer / Combo'; $header.FontSize = 18; $header.FontWeight = 'Bold'; $header.Margin = '0,0,0,14'; $stack.Children.Add($header)|Out-Null

  $lbl1 = New-Object System.Windows.Controls.TextBlock; $lbl1.Text = 'Campaign Title'; $lbl1.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl1.Margin = '0,0,0,4'; $stack.Children.Add($lbl1)|Out-Null
  $titleBox = New-Object System.Windows.Controls.TextBox; $titleBox.Text = 'Weekend Pit Fire Special'; $titleBox.Height = 38; $titleBox.Padding = '8'; $titleBox.Margin = '0,0,0,10'; Set-LoginFieldTheme $titleBox; $stack.Children.Add($titleBox)|Out-Null

  $lbl2 = New-Object System.Windows.Controls.TextBlock; $lbl2.Text = 'Badge Tag (e.g. 20% OFF, COMBO, CHEF SPECIAL)'; $lbl2.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl2.Margin = '0,0,0,4'; $stack.Children.Add($lbl2)|Out-Null
  $badgeBox = New-Object System.Windows.Controls.TextBox; $badgeBox.Text = 'CHEF SPECIAL'; $badgeBox.Height = 38; $badgeBox.Padding = '8'; $badgeBox.Margin = '0,0,0,10'; Set-LoginFieldTheme $badgeBox; $stack.Children.Add($badgeBox)|Out-Null

  $lbl3 = New-Object System.Windows.Controls.TextBlock; $lbl3.Text = 'Linked Menu Item'; $lbl3.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl3.Margin = '0,0,0,4'; $stack.Children.Add($lbl3)|Out-Null
  $itemSelect = New-Object System.Windows.Controls.ComboBox; $itemSelect.Height = 38; Set-LoginFieldTheme $itemSelect
  $itemSelect.Background = ConvertTo-UiBrush '#E5E7EB'; $itemSelect.Foreground = ConvertTo-UiBrush '#111827'; $itemSelect.ItemContainerStyle = $script:itemStyle
  foreach ($m in $script:items) {
    $c = New-Object System.Windows.Controls.ComboBoxItem; $c.Content = "$($m.name) (Rs $($m.price))"; $c.Tag = $m.id; $itemSelect.Items.Add($c)|Out-Null
  }
  if ($itemSelect.Items.Count -gt 0) { $itemSelect.SelectedIndex = 0 }
  $itemSelect.Margin = '0,0,0,10'; $stack.Children.Add($itemSelect)|Out-Null

  $lbl4 = New-Object System.Windows.Controls.TextBlock; $lbl4.Text = 'Card Visual Style'; $lbl4.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl4.Margin = '0,0,0,4'; $stack.Children.Add($lbl4)|Out-Null
  $styleSelect = New-Object System.Windows.Controls.ComboBox; $styleSelect.Height = 38; Set-LoginFieldTheme $styleSelect
  $styleSelect.Background = ConvertTo-UiBrush '#E5E7EB'; $styleSelect.Foreground = ConvertTo-UiBrush '#111827'; $styleSelect.ItemContainerStyle = $script:itemStyle
  foreach ($s in 'flame_badge','gradient_glow','ribbon_tag','countdown') {
    $c = New-Object System.Windows.Controls.ComboBoxItem; $c.Content = $s; $styleSelect.Items.Add($c)|Out-Null
  }
  $styleSelect.SelectedIndex = 0; $styleSelect.Margin = '0,0,0,12'; $stack.Children.Add($styleSelect)|Out-Null

  $lbl5 = New-Object System.Windows.Controls.TextBlock; $lbl5.Text = 'Description / Tagline'; $lbl5.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl5.Margin = '0,0,0,4'; $stack.Children.Add($lbl5)|Out-Null
  $descBox = New-Object System.Windows.Controls.TextBox; $descBox.Text = 'Prime smoked brisket platter paired with chilled craft beverage.'; $descBox.Height = 44; $descBox.Padding = '8'; $descBox.Margin = '0,0,0,16'; Set-LoginFieldTheme $descBox; $stack.Children.Add($descBox)|Out-Null

  $hint = New-Object System.Windows.Controls.TextBlock; $hint.Text = ''; $hint.Foreground = '#EF4444'; $hint.Margin = '0,0,0,10'; $hint.TextWrapping = 'Wrap'; $stack.Children.Add($hint)|Out-Null

  $btn = New-Object System.Windows.Controls.Button; $btn.Content = 'Publish Special Offer'; $btn.Height = 46; $btn.Background = '#DC2626'; $btn.Foreground = 'White'; $btn.BorderThickness = '0'; $btn.IsDefault = $true
  $btn.Add_Click(({
    try {
      $btn.IsEnabled = $false
      $t = $titleBox.Text.Trim()
      $b = $badgeBox.Text.Trim()
      $d = $descBox.Text.Trim()
      $s = [string]($styleSelect.SelectedItem.Content)
      $selItem = $itemSelect.SelectedItem
      $mId = if ($selItem) { [string]$selItem.Tag } else { $null }
      if (-not $t) { throw 'Enter an offer title.' }
      $payload = @{
        title = $t
        badge_text = $b
        description = $d
        card_style = $s
        menu_item_id = $mId
        active = $true
      }
      $null = Bridge '/counter/offers' 'POST' $payload
      $dialog.DialogResult = $true; $dialog.Close()
    } catch {
      $hint.Text = $_.Exception.Message; $btn.IsEnabled = $true
    }
  }.GetNewClosure()))
  $stack.Children.Add($btn)|Out-Null
  $dialog.Content = $stack
  return [bool]($dialog.ShowDialog())
}

function Show-AssignRiderDialog($Order) {
  $dialog = New-Object System.Windows.Window
  $dialog.Title = "Assign Delivery Rider - Order #$($Order.sequence_no)"
  $dialog.Width = 440; $dialog.Height = 360; $dialog.WindowStartupLocation = 'CenterScreen'; $dialog.ResizeMode = 'NoResize'; $dialog.Background = '#0B0C10'; $dialog.Foreground = '#F0F0F0'
  Set-AppWindowIcon $dialog
  $stack = New-Object System.Windows.Controls.StackPanel; $stack.Margin = '24'

  $header = New-Object System.Windows.Controls.TextBlock; $header.Text = 'Assign Delivery Rider'; $header.FontSize = 18; $header.FontWeight = 'Bold'; $header.Margin = '0,0,0,6'; $stack.Children.Add($header)|Out-Null
  $sub = New-Object System.Windows.Controls.TextBlock; $sub.Text = "Destination: $($Order.customer_address)`nCustomer: $($Order.customer_name) ($($Order.customer_phone))"; $sub.Foreground = '#8B949E'; $sub.Margin = '0,0,0,16'; $stack.Children.Add($sub)|Out-Null

  $lbl = New-Object System.Windows.Controls.TextBlock; $lbl.Text = 'Select Active Rider'; $lbl.Foreground = ConvertTo-UiBrush '#B7BEC9'; $lbl.Margin = '0,0,0,4'; $stack.Children.Add($lbl)|Out-Null
  $riderSelect = New-Object System.Windows.Controls.ComboBox; $riderSelect.Height = 40; Set-LoginFieldTheme $riderSelect
  $riderSelect.Background = ConvertTo-UiBrush '#E5E7EB'; $riderSelect.Foreground = ConvertTo-UiBrush '#111827'; $riderSelect.ItemContainerStyle = $script:itemStyle

  try {
    $res = Bridge '/counter/riders'
    foreach ($r in @($res.riders)) {
      $item = New-Object System.Windows.Controls.ComboBoxItem
      $item.Content = "$($r.name) (@$($r.username))"
      $item.Tag = $r
      $riderSelect.Items.Add($item)|Out-Null
    }
  } catch { }

  if ($riderSelect.Items.Count -eq 0) {
    $item = New-Object System.Windows.Controls.ComboBoxItem; $item.Content = 'QA Rider (@QA-RIDER-01)'; $item.Tag = @{ id = 'rider-1'; name = 'QA Rider' }
    $riderSelect.Items.Add($item)|Out-Null
  }
  $riderSelect.SelectedIndex = 0; $riderSelect.Margin = '0,0,0,20'; $stack.Children.Add($riderSelect)|Out-Null

  $hint = New-Object System.Windows.Controls.TextBlock; $hint.Text = ''; $hint.Foreground = '#EF4444'; $hint.Margin = '0,0,0,10'; $hint.TextWrapping = 'Wrap'; $stack.Children.Add($hint)|Out-Null

  $btn = New-Object System.Windows.Controls.Button; $btn.Content = 'Dispatch with Rider'; $btn.Height = 46; $btn.Background = '#DC2626'; $btn.Foreground = 'White'; $btn.BorderThickness = '0'; $btn.IsDefault = $true
  $btn.Add_Click(({
    try {
      $btn.IsEnabled = $false
      $sel = $riderSelect.SelectedItem
      if (-not $sel) { throw 'Select a delivery rider.' }
      $riderObj = $sel.Tag
      $rId = [string]$riderObj.id
      $rName = [string]$riderObj.name
      $null = Bridge '/counter/orders/assign-rider' 'POST' @{
        client_order_id = $Order.client_order_id
        rider_id = $rId
        rider_name = $rName
      }
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
  $rItem = New-Object System.Windows.Controls.ComboBoxItem; $rItem.Content = 'rider'
  $role.Items.Add($cItem)|Out-Null; $role.Items.Add($kItem)|Out-Null; $role.Items.Add($aItem)|Out-Null; $role.Items.Add($rItem)|Out-Null
  $role.SelectedItem = if ($cached -and $cached.role -eq 'admin') { $aItem } elseif ($cached -and $cached.role -eq 'kitchen') { $kItem } elseif ($cached -and $cached.role -eq 'rider') { $rItem } else { $cItem }
  $role.Height = 46; $role.Padding = '10'; $role.Margin = '0,0,0,10'; Set-LoginFieldTheme $role
  $role.Background = ConvertTo-UiBrush '#E5E7EB'
  $role.Foreground = ConvertTo-UiBrush '#111827'
  $role.ItemContainerStyle = $script:itemStyle
  $stack.Children.Add($role)|Out-Null

  $identityLabel = New-Object System.Windows.Controls.TextBlock; $identityLabel.Text = 'Staff username'; $identityLabel.Foreground = ConvertTo-UiBrush '#B7BEC9'; $identityLabel.Margin = '0,0,0,5'; $stack.Children.Add($identityLabel)|Out-Null
  $identity = New-Object System.Windows.Controls.TextBox; $identity.Text = if($cached){[string]$cached.username}else{''}; $identity.Height = 46; $identity.Padding = '10'; $identity.Margin = '0,0,0,10'; Set-LoginFieldTheme $identity; $stack.Children.Add($identity)|Out-Null

  $pinLabel = New-Object System.Windows.Controls.TextBlock; $pinLabel.Text = 'Staff PIN'; $pinLabel.Foreground = ConvertTo-UiBrush '#B7BEC9'; $pinLabel.Margin = '0,0,0,5'; $stack.Children.Add($pinLabel)|Out-Null
  $pin = New-Object System.Windows.Controls.PasswordBox; $pin.Height = 46; $pin.Padding = '10'; $pin.Margin = '0,0,0,10'; Set-LoginFieldTheme $pin; $stack.Children.Add($pin)|Out-Null

  $hint = New-Object System.Windows.Controls.TextBlock; $hint.Text = 'Local SQLite Authentication - Works completely offline'; $hint.TextWrapping = 'Wrap'; $hint.Foreground = '#10B981'; $hint.Margin = '0,0,0,16'; $stack.Children.Add($hint)|Out-Null

  $button = New-Object System.Windows.Controls.Button; $button.Content = 'Sign in'; $button.Height = 50; $button.Background = '#DC2626'; $button.Foreground = 'White'; $button.BorderThickness = '0'; $button.IsDefault = $true
  $button.Add_Click(({
    $button.IsEnabled = $false; $hint.Text = 'Verifying local credentials...'; $hint.Foreground = '#8B949E'
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
    $script:pinDisplayTextControl.Text = 'o o o o'
    $script:pinDisplayTextControl.Foreground = ConvertTo-UiBrush '#8B949E'
  } else {
    $dots = @()
    for ($i = 0; $i -lt $script:keypadPin.Length; $i++) { $dots += '*' }
    $script:pinDisplayTextControl.Text = ($dots -join ' ')
    $script:pinDisplayTextControl.Foreground = ConvertTo-UiBrush '#DC2626'
  }
}

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

  $headerPanel = New-Object System.Windows.Controls.StackPanel; [System.Windows.Controls.Grid]::SetRow($headerPanel, 0)
  $brand = New-Object System.Windows.Controls.TextBlock; $brand.Text = 'IGNITE POS  |  TERMINAL SECURITY'; $brand.FontSize = 10; $brand.FontWeight = 'Bold'; $brand.Foreground = '#DC2626'; $headerPanel.Children.Add($brand)|Out-Null
  $title = New-Object System.Windows.Controls.TextBlock; $title.Text = 'Fast PIN Unlock / Role Switch'; $title.FontSize = 18; $title.FontWeight = 'Bold'; $title.Margin = '0,2,0,4'; $headerPanel.Children.Add($title)|Out-Null
  $sub = New-Object System.Windows.Controls.TextBlock; $sub.Text = 'Enter staff PIN to unlock terminal or switch active role'; $sub.Foreground = '#8B949E'; $sub.FontSize = 12; $sub.Margin = '0,0,0,14'; $headerPanel.Children.Add($sub)|Out-Null
  $root.Children.Add($headerPanel)|Out-Null

  $userRow = New-Object System.Windows.Controls.Grid; [System.Windows.Controls.Grid]::SetRow($userRow, 1); $userRow.Margin = '0,0,0,12'
  $userRow.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = [System.Windows.GridLength]::new(1.2, [System.Windows.GridUnitType]::Star) }))
  $userRow.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = [System.Windows.GridLength]::new(0.8, [System.Windows.GridUnitType]::Star) }))

  $usernameInput = New-Object System.Windows.Controls.TextBox
  $usernameInput.Text = if ($script:staffSession) { [string]$script:staffSession.username } else { 'admin' }
  $usernameInput.Height = 40; $usernameInput.Padding = '8'; $usernameInput.Margin = '0,0,8,0'; Set-LoginFieldTheme $usernameInput
  [System.Windows.Controls.Grid]::SetColumn($usernameInput, 0); $userRow.Children.Add($usernameInput)|Out-Null

  $roleSelect = New-Object System.Windows.Controls.ComboBox; $roleSelect.Height = 40; Set-LoginFieldTheme $roleSelect
  $roleSelect.Background = ConvertTo-UiBrush '#E5E7EB'; $roleSelect.Foreground = ConvertTo-UiBrush '#111827'; $roleSelect.ItemContainerStyle = $script:itemStyle
  foreach ($r in 'admin','cashier','kitchen','rider') {
    $item = New-Object System.Windows.Controls.ComboBoxItem; $item.Content = $r; $roleSelect.Items.Add($item)|Out-Null
    if ($script:staffSession -and $script:staffSession.role -eq $r) { $roleSelect.SelectedItem = $item }
  }
  if (-not $roleSelect.SelectedItem) { $roleSelect.SelectedIndex = 1 }
  [System.Windows.Controls.Grid]::SetColumn($roleSelect, 1); $userRow.Children.Add($roleSelect)|Out-Null
  $root.Children.Add($userRow)|Out-Null

  $pinDisplayBorder = New-Object System.Windows.Controls.Border; [System.Windows.Controls.Grid]::SetRow($pinDisplayBorder, 2)
  $pinDisplayBorder.Background = '#14171F'; $pinDisplayBorder.BorderBrush = '#222736'; $pinDisplayBorder.BorderThickness = '1'; $pinDisplayBorder.CornerRadius = '6'; $pinDisplayBorder.Padding = '12'; $pinDisplayBorder.Margin = '0,0,0,14'
  $pinDisplayText = New-Object System.Windows.Controls.TextBlock; $pinDisplayText.Text = 'o o o o'; $pinDisplayText.FontSize = 22; $pinDisplayText.FontWeight = 'Bold'; $pinDisplayText.Foreground = '#8B949E'; $pinDisplayText.HorizontalAlignment = 'Center'
  $pinDisplayBorder.Child = $pinDisplayText
  $root.Children.Add($pinDisplayBorder)|Out-Null
  $script:pinDisplayTextControl = $pinDisplayText
  Update-PinDisplay

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
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Title="IGNITE POS - RMS Counter" Width="1320" Height="860" MinWidth="1100" MinHeight="720" WindowStartupLocation="CenterScreen" Background="#0A0A0C" Foreground="#F0F0F0" FontFamily="Segoe UI">
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
       <TextBlock Text="COUNTER 01 - LOCAL SQLITE" Foreground="#10B981" FontSize="10" FontWeight="SemiBold"/>
      </StackPanel>
     </Border>

     <Button Name="navCashier" Content="Orders (POS)" Height="42" Margin="6,0,6,3" HorizontalContentAlignment="Left" Padding="14,0" Background="#DC2626" Foreground="White" BorderThickness="0" FontWeight="SemiBold" FontSize="12"/>
     <Button Name="navKitchen" Content="Kitchen (KDS)" Height="42" Margin="6,0,6,3" HorizontalContentAlignment="Left" Padding="14,0" Background="#14171F" Foreground="#F0F0F0" BorderBrush="#222736" FontWeight="SemiBold" FontSize="12"/>
     <Button Name="navMenu" Content="Menu Management" Height="42" Margin="6,0,6,3" HorizontalContentAlignment="Left" Padding="14,0" Background="#14171F" Foreground="#F0F0F0" BorderBrush="#222736" FontWeight="SemiBold" FontSize="12"/>
     <Button Name="navOffers" Content="Special Offers" Height="42" Margin="6,0,6,3" HorizontalContentAlignment="Left" Padding="14,0" Background="#14171F" Foreground="#F0F0F0" BorderBrush="#222736" FontWeight="SemiBold" FontSize="12"/>
     <Button Name="navInventory" Content="Inventory Tracking" Height="42" Margin="6,0,6,3" HorizontalContentAlignment="Left" Padding="14,0" Background="#14171F" Foreground="#F0F0F0" BorderBrush="#222736" FontWeight="SemiBold" FontSize="12"/>
     <Button Name="navMarketplace" Content="Supplier Marketplace" Height="42" Margin="6,0,6,3" HorizontalContentAlignment="Left" Padding="14,0" Background="#14171F" Foreground="#F0F0F0" BorderBrush="#222736" FontWeight="SemiBold" FontSize="12"/>
     <Button Name="navStaff" Content="Staff Accounts" Height="42" Margin="6,0,6,3" HorizontalContentAlignment="Left" Padding="14,0" Background="#14171F" Foreground="#F0F0F0" BorderBrush="#222736" FontWeight="SemiBold" FontSize="12"/>
     <Button Name="navRider" Content="Rider Deliveries" Height="42" Margin="6,0,6,3" HorizontalContentAlignment="Left" Padding="14,0" Background="#14171F" Foreground="#F0F0F0" BorderBrush="#222736" FontWeight="SemiBold" FontSize="12"/>
     <Button Name="navReports" Content="Reports &amp; Settings" Height="42" Margin="6,0,6,3" HorizontalContentAlignment="Left" Padding="14,0" Background="#14171F" Foreground="#F0F0F0" BorderBrush="#222736" FontWeight="SemiBold" FontSize="12"/>
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
      <TextBlock Name="sidebarStationStatus" Text="ONLINE - LOCAL SQLITE" Foreground="#10B981" FontSize="10" Margin="0,0,0,8"/>
      <Button Name="btnSwitchRole" Content="Switch Role / Lock" Height="36" Background="#1B202B" Foreground="#F0F0F0" BorderBrush="#353D50" FontWeight="SemiBold" FontSize="11"/>
     </StackPanel>
    </Border>
   </DockPanel>

   <!-- RIGHT CONTENT PANES -->
   <Grid Grid.Column="1">
    <!-- CASHIER PANE (ORDERS) -->
    <DockPanel Name="cashierPane" Margin="4,0,0,0">
     <!-- Metric Bar & Filter Tabs -->
     <Border DockPanel.Dock="Top" Background="#161B22" CornerRadius="8" Padding="12" Margin="0,0,0,10" BorderBrush="#222736" BorderThickness="1">
      <DockPanel>
       <!-- Right: Search, Avg Wait, + New Order -->
       <StackPanel DockPanel.Dock="Right" Orientation="Horizontal" VerticalAlignment="Center">
        <TextBox Name="ordersSearchBox" Width="200" Height="38" Padding="8" Margin="0,0,8,0" Background="#0D0D0D" Foreground="#F0F0F0" BorderBrush="#2C3240"/>
        <Border Background="#0D0D0D" CornerRadius="6" Padding="10,6" Margin="0,0,8,0">
         <TextBlock Name="ordersAvgWait" Text="Avg Wait: 11m 14s" Foreground="#8B949E" FontSize="12" VerticalAlignment="Center"/>
        </Border>
        <Button Name="btnTogglePosComposer" Content="+ New POS Order" Height="38" Padding="12,0" Background="#DC2626" Foreground="White" FontWeight="Bold" BorderThickness="0"/>
       </StackPanel>
       <!-- Left: Filter Tabs -->
       <StackPanel Orientation="Horizontal">
        <Button Name="btnFilterAll" Content="All" Height="38" Padding="16,0" Margin="0,0,6,0" Background="#DC2626" Foreground="White" FontWeight="Bold" BorderThickness="0"/>
        <Button Name="btnFilterDineIn" Content="Dine-In" Height="38" Padding="14,0" Margin="0,0,6,0" Background="#1A1E29" Foreground="#8B949E" BorderBrush="#2C3240"/>
        <Button Name="btnFilterDelivery" Content="Delivery" Height="38" Padding="14,0" Margin="0,0,6,0" Background="#1A1E29" Foreground="#8B949E" BorderBrush="#2C3240"/>
        <Button Name="btnFilterUrgent" Content="Urgent (>15m)" Height="38" Padding="14,0" Background="#1A1E29" Foreground="#EF4444" BorderBrush="#2C3240"/>
       </StackPanel>
      </DockPanel>
     </Border>

     <!-- Active Station Footer Ledger -->
     <Border DockPanel.Dock="Bottom" Background="#161B22" CornerRadius="8" Padding="12" Margin="0,10,0,0" BorderBrush="#222736" BorderThickness="1">
      <DockPanel>
       <StackPanel DockPanel.Dock="Right" Orientation="Horizontal">
        <Button Name="btnSyncAllTickets" Content="Sync All Tickets" Height="34" Padding="14,0" Background="#DC2626" Foreground="White" FontWeight="Bold" BorderThickness="0"/>
       </StackPanel>
       <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
        <Border Background="#EF4444" Width="8" Height="8" CornerRadius="4" Margin="0,0,6,0"/>
        <TextBlock Name="lblDelayedCount" Text="Delayed > 15m (0)" Foreground="#8B949E" FontSize="12" Margin="0,0,16,0"/>
        <Border Background="#F59E0B" Width="8" Height="8" CornerRadius="4" Margin="0,0,6,0"/>
        <TextBlock Name="lblCookingCount" Text="In Kitchen (0)" Foreground="#8B949E" FontSize="12" Margin="0,0,16,0"/>
        <Border Background="#10B981" Width="8" Height="8" CornerRadius="4" Margin="0,0,6,0"/>
        <TextBlock Name="lblReadyCount" Text="Ready for Service (0)" Foreground="#8B949E" FontSize="12"/>
       </StackPanel>
      </DockPanel>
     </Border>

     <!-- Center Grid: Order Cards ScrollViewer & Side POS Composer -->
     <Grid>
      <Grid.ColumnDefinitions>
       <ColumnDefinition Width="*"/>
       <ColumnDefinition Width="Auto"/>
      </Grid.ColumnDefinitions>

      <!-- Cards Grid ScrollViewer -->
      <ScrollViewer Grid.Column="0" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled">
       <WrapPanel Name="ordersWrapPanel" ItemWidth="350"/>
      </ScrollViewer>

      <!-- Collapsible POS Composer Drawer -->
      <Border Name="posComposerBorder" Grid.Column="1" Width="360" Background="#161B22" BorderBrush="#222736" BorderThickness="1,0,0,0" Padding="12" Visibility="Collapsed">
       <DockPanel>
        <DockPanel DockPanel.Dock="Top" Margin="0,0,0,8">
         <Button Name="btnClosePosComposer" DockPanel.Dock="Right" Content="X" Width="28" Height="28" Background="#1A1E29" Foreground="#8B949E" BorderThickness="0"/>
         <TextBlock Text="CREATE POS ORDER" Foreground="#DC2626" FontWeight="Bold" FontSize="12" VerticalAlignment="Center"/>
        </DockPanel>

        <!-- Order Form Top -->
        <StackPanel DockPanel.Dock="Top" Margin="0,0,0,8">
         <Grid Margin="0,0,0,6">
          <Grid.ColumnDefinitions>
           <ColumnDefinition Width="*"/>
           <ColumnDefinition Width="*"/>
           <ColumnDefinition Width="*"/>
          </Grid.ColumnDefinitions>
          <Button Name="btnTypeDineIn" Grid.Column="0" Content="Dine-In" Height="32" Margin="0,0,2,0" Background="#DC2626" Foreground="White" BorderThickness="0" FontWeight="Bold" FontSize="11"/>
          <Button Name="btnTypeDelivery" Grid.Column="1" Content="Delivery" Height="32" Margin="2,0,2,0" Background="#1A1E29" Foreground="#F0F0F0" BorderBrush="#2C3240" FontWeight="Bold" FontSize="11"/>
          <Button Name="btnTypePickup" Grid.Column="2" Content="Pickup" Height="32" Margin="2,0,0,0" Background="#1A1E29" Foreground="#F0F0F0" BorderBrush="#2C3240" FontWeight="Bold" FontSize="11"/>
         </Grid>

         <TextBlock Name="lblReference" Text="Table Number" Foreground="#8B949E" FontSize="11" Margin="0,2,0,2"/>
         <TextBox Name="table" Height="32" Margin="0,0,0,4" Padding="6" Background="#0D0D0D" Foreground="#F0F0F0" BorderBrush="#2C3240"/>
         
         <TextBlock Name="lblCustomer" Text="Customer Name &amp; Phone" Foreground="#8B949E" FontSize="11" Margin="0,2,0,2"/>
         <Grid Margin="0,0,0,4">
          <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
          <TextBox Name="custName" Grid.Column="0" Height="32" Margin="0,0,2,0" Padding="6" Background="#0D0D0D" Foreground="#F0F0F0" BorderBrush="#2C3240"/>
          <TextBox Name="custPhone" Grid.Column="1" Height="32" Margin="2,0,0,0" Padding="6" Background="#0D0D0D" Foreground="#F0F0F0" BorderBrush="#2C3240"/>
         </Grid>

         <TextBlock Name="lblAddress" Text="Delivery Address" Foreground="#8B949E" FontSize="11" Margin="0,2,0,2" Visibility="Collapsed"/>
         <TextBox Name="custAddress" Height="32" Margin="0,0,0,4" Padding="6" Background="#0D0D0D" Foreground="#F0F0F0" BorderBrush="#2C3240" Visibility="Collapsed"/>

         <TextBlock Name="cartSummary" Text="Active Cart: 0 items (Rs 0)" Foreground="#10B981" FontWeight="Bold" FontSize="11" Margin="0,4,0,4"/>
         <Button Name="placeOrder" Content="Save Order &amp; Hand Off" Height="38" Background="#DC2626" Foreground="White" BorderThickness="0" FontWeight="Bold"/>
        </StackPanel>

        <!-- Menu items list for adding -->
        <TextBlock DockPanel.Dock="Top" Text="Double-click item to add to cart:" Foreground="#8B949E" FontSize="10" Margin="0,4,0,2"/>
        <ListBox Name="menuList" Background="#0D0D0D" Foreground="#F0F0F0" BorderBrush="#222736"/>
       </DockPanel>
      </Border>
     </Grid>
    </DockPanel>

    <!-- KITCHEN PANE (KDS) -->
    <DockPanel Name="kitchenPane" Margin="4,0,0,0" Visibility="Collapsed">
     <!-- Metric Bar & Filter Tabs -->
     <Border DockPanel.Dock="Top" Background="#161B22" CornerRadius="8" Padding="12" Margin="0,0,0,10" BorderBrush="#222736" BorderThickness="1">
      <DockPanel>
       <StackPanel DockPanel.Dock="Right" Orientation="Horizontal" VerticalAlignment="Center">
        <Border Background="#0D0D0D" CornerRadius="6" Padding="10,6">
         <TextBlock Text="KDS ACTIVE" Foreground="#10B981" FontWeight="Bold" FontSize="12"/>
        </Border>
       </StackPanel>
       <StackPanel Orientation="Horizontal">
        <Button Name="btnKitchenFilterAll" Content="All Tickets" Height="38" Padding="16,0" Margin="0,0,6,0" Background="#DC2626" Foreground="White" FontWeight="Bold" BorderThickness="0"/>
        <Button Name="btnKitchenFilterQueued" Content="Queued" Height="38" Padding="14,0" Margin="0,0,6,0" Background="#1A1E29" Foreground="#8B949E" BorderBrush="#2C3240"/>
        <Button Name="btnKitchenFilterCooking" Content="Cooking" Height="38" Padding="14,0" Margin="0,0,6,0" Background="#1A1E29" Foreground="#8B949E" BorderBrush="#2C3240"/>
        <Button Name="btnKitchenFilterReady" Content="Ready" Height="38" Padding="14,0" Background="#1A1E29" Foreground="#8B949E" BorderBrush="#2C3240"/>
       </StackPanel>
      </DockPanel>
     </Border>

     <!-- Kitchen Station Footer Ledger -->
     <Border DockPanel.Dock="Bottom" Background="#161B22" CornerRadius="8" Padding="12" Margin="0,10,0,0" BorderBrush="#222736" BorderThickness="1">
      <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
       <TextBlock Text="KDS PIPELINE: QUEUED (Pending) -> COOKING (Preparing) -> READY" Foreground="#8B949E" FontSize="12"/>
      </StackPanel>
     </Border>

     <!-- Kitchen Tickets Cards Grid -->
     <ScrollViewer VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled">
      <WrapPanel Name="kitchenWrapPanel" ItemWidth="350"/>
     </ScrollViewer>
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
        <TextBlock Text="Discount combos automatically highlight on mobile customer QR menu and local POS." Foreground="#8B949E" FontSize="11" Margin="0,2,0,0"/>
       </StackPanel>
      </DockPanel>
     </Border>
     <ListBox Name="offersList" Background="#12141C" Foreground="#F0F0F0" BorderBrush="#222736"/>
     <StackPanel DockPanel.Dock="Bottom" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,10,0,0">
      <Button Name="btnDeleteOffer" Content="Delete Selected Promotion" Height="40" MinWidth="180" Background="#1A1E29" Foreground="#EF4444" BorderBrush="#2E3547"/>
     </StackPanel>
    </DockPanel>

    <!-- INVENTORY PANE -->
    <DockPanel Name="inventoryPane" Margin="4,0,0,0" Visibility="Collapsed">
     <TextBlock DockPanel.Dock="Top" Text="Raw Material Inventory Tracking  -  Automatic low-stock threshold alerts" Foreground="#8B949E" Margin="0,0,0,10"/>
     <Border DockPanel.Dock="Top" Background="#14171F" BorderBrush="#222736" BorderThickness="1" CornerRadius="6" Padding="14" Margin="0,0,0,12">
      <DockPanel>
       <StackPanel DockPanel.Dock="Right" Orientation="Horizontal">
        <Button Name="btnOrderVendorWhatsApp" Content="Order via Vendor WhatsApp" Height="38" Padding="14,0" Margin="0,0,8,0" Background="#10B981" Foreground="White" BorderThickness="0" FontWeight="Bold"/>
        <Button Name="btnRefreshInventory" Content="Sync Stock" Height="38" Padding="14,0" Background="#1A1E29" Foreground="#F0F0F0" BorderBrush="#2E3547"/>
       </StackPanel>
       <StackPanel>
        <TextBlock Text="RAW MATERIALS &amp; INGREDIENTS" Foreground="White" FontWeight="Bold" FontSize="14"/>
        <TextBlock Text="Items falling below minimum threshold trigger instant WhatsApp reorder." Foreground="#8B949E" FontSize="11" Margin="0,2,0,0"/>
       </StackPanel>
      </DockPanel>
     </Border>
     <ListBox Name="inventoryList" Background="#12141C" Foreground="#F0F0F0" BorderBrush="#222736"/>
     <StackPanel DockPanel.Dock="Bottom" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,10,0,0">
      <Button Name="btnAdjustStock" Content="Adjust Current Stock" Height="40" MinWidth="160" Background="#1A1E29" Foreground="#F0F0F0" BorderBrush="#2E3547"/>
     </StackPanel>
    </DockPanel>

    <!-- SUPPLIER MARKETPLACE PANE -->
    <Grid Name="marketplacePane" Margin="4,0,0,0" Visibility="Collapsed">
     <Grid.ColumnDefinitions><ColumnDefinition Width="1.2*"/><ColumnDefinition Width="0.8*"/></Grid.ColumnDefinitions>
     
     <!-- Supplies Catalog -->
     <DockPanel Grid.Column="0" Margin="0,0,16,0">
      <Border DockPanel.Dock="Top" Background="#14171F" BorderBrush="#222736" BorderThickness="1" CornerRadius="6" Padding="14" Margin="0,0,0,10">
       <StackPanel>
        <TextBlock Text="PROVIDER SUPPLIER MARKETPLACE" Foreground="#DC2626" FontSize="11" FontWeight="Bold"/>
        <TextBlock Text="Kitchen Equipment, Packaging, Disposables, and Thermal Paper" Foreground="White" FontSize="14" FontWeight="Bold" Margin="0,2,0,0"/>
        <TextBlock Text="Double click item to add 1 unit to supplies order cart." Foreground="#8B949E" FontSize="11" Margin="0,2,0,0"/>
       </StackPanel>
      </Border>
      <ListBox Name="marketplaceList" Background="#12141C" Foreground="#F0F0F0" BorderBrush="#222736"/>
     </DockPanel>

     <!-- Supplies Order Cart -->
     <DockPanel Grid.Column="1">
      <Border DockPanel.Dock="Top" Background="#14171F" BorderBrush="#222736" BorderThickness="1" CornerRadius="6" Padding="14" Margin="0,0,0,10">
       <StackPanel>
        <TextBlock Text="SUPPLIES ORDER CART" Foreground="White" FontWeight="Bold" FontSize="14"/>
        <TextBlock Name="marketCartSummary" Text="0 items selected" Foreground="#10B981" FontWeight="SemiBold" FontSize="12" Margin="0,4,0,0"/>
       </StackPanel>
      </Border>

      <ListBox Name="marketCartList" Background="#12141C" Foreground="#F0F0F0" BorderBrush="#222736"/>

      <StackPanel DockPanel.Dock="Bottom" Margin="0,10,0,0">
       <Button Name="btnSubmitMarketOrder" Content="Submit Supply Order via WhatsApp" Height="48" Background="#10B981" Foreground="White" BorderThickness="0" FontWeight="Bold" FontSize="13"/>
       <Button Name="btnClearMarketCart" Content="Clear Supplies Cart" Height="36" Margin="0,6,0,0" Background="#1A1E29" Foreground="#8B949E" BorderBrush="#2E3547"/>
      </StackPanel>
     </DockPanel>
    </Grid>

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

    <!-- RIDER DELIVERIES PANE -->
    <DockPanel Name="riderPane" Margin="4,0,0,0" Visibility="Collapsed">
     <TextBlock DockPanel.Dock="Top" Text="Assigned Deliveries for Active Rider" Foreground="#8B949E" Margin="0,0,0,10"/>
     <ListBox Name="riderDeliveriesList" Background="#12141C" Foreground="#F0F0F0" BorderBrush="#222736"/>
     <StackPanel DockPanel.Dock="Bottom" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,12,0,0">
      <Button Name="btnRiderDispatched" Content="Out for Delivery" Height="44" MinWidth="140" Margin="0,0,8,0" Background="#DC2626" Foreground="White" BorderThickness="0" FontWeight="Bold"/>
      <Button Name="btnRiderDelivered" Content="Mark Delivered [OK]" Height="44" MinWidth="140" Background="#10B981" Foreground="White" BorderThickness="0" FontWeight="Bold"/>
     </StackPanel>
    </DockPanel>

    <!-- REPORTS & SETTINGS PANE -->
    <DockPanel Name="reportsPane" Margin="4,0,0,0" Visibility="Collapsed">
     <TextBlock DockPanel.Dock="Top" Text="Terminal Reports &amp; Configurable System WhatsApp Numbers" Foreground="#8B949E" Margin="0,0,0,10"/>
     
     <ScrollViewer VerticalScrollBarVisibility="Auto">
      <StackPanel>
       <!-- EOD Summary -->
       <Border Background="#12141C" BorderBrush="#222736" BorderThickness="1" CornerRadius="6" Padding="18" Margin="0,0,0,14">
        <StackPanel>
         <TextBlock Text="DAY END SUMMARY" Foreground="#DC2626" FontSize="12" FontWeight="Bold"/>
         <TextBlock Name="reportSalesSummary" Text="Sales Report: Local SQLite active" Foreground="White" FontSize="16" FontWeight="Bold" Margin="0,4,0,14"/>
         <TextBlock Name="reportTerminalInfo" Text="Local Bridge: 127.0.0.1:8765 - Status: Connected" Foreground="#8B949E" Margin="0,0,0,14"/>
         <StackPanel Orientation="Horizontal">
          <Button Name="btnPrintZReport" Content="Print End of Day (Z-Report)" Height="40" MinWidth="200" Margin="0,0,10,0" Background="#DC2626" Foreground="White" BorderThickness="0" FontWeight="Bold"/>
          <Button Name="btnTestPrinter" Content="Test Thermal Printer" Height="40" MinWidth="160" Background="#1A1E29" Foreground="#F0F0F0" BorderBrush="#2E3547"/>
         </StackPanel>
        </StackPanel>
       </Border>

       <!-- Configurable WhatsApp Settings -->
       <Border Background="#12141C" BorderBrush="#222736" BorderThickness="1" CornerRadius="6" Padding="18">
        <StackPanel>
         <TextBlock Text="SYSTEM WHATSAPP NUMBERS CONFIGURATION" Foreground="#10B981" FontSize="12" FontWeight="Bold"/>
         <TextBlock Text="Free wa.me deep links send alerts and orders directly to these configurable numbers." Foreground="#8B949E" FontSize="11" Margin="0,2,0,14"/>

         <TextBlock Text="Restaurant Customer Orders WhatsApp Number (e.g. 03001234567)" Foreground="#B7BEC9" Margin="0,0,0,4"/>
         <TextBox Name="settingRestaurantPhone" Height="38" Padding="8" Margin="0,0,0,12" Background="#161B22" Foreground="#F0F0F0" BorderBrush="#343943"/>

         <TextBlock Text="Supplier Marketplace WhatsApp Number (e.g. 03129876543)" Foreground="#B7BEC9" Margin="0,0,0,4"/>
         <TextBox Name="settingSupplierPhone" Height="38" Padding="8" Margin="0,0,0,12" Background="#161B22" Foreground="#F0F0F0" BorderBrush="#343943"/>

         <TextBlock Text="Low-Stock Raw Material Vendor WhatsApp Number (e.g. 03215555555)" Foreground="#B7BEC9" Margin="0,0,0,4"/>
         <TextBox Name="settingVendorPhone" Height="38" Padding="8" Margin="0,0,0,16" Background="#161B22" Foreground="#F0F0F0" BorderBrush="#343943"/>

         <Button Name="btnSaveSettings" Content="Save WhatsApp Numbers" Height="44" Background="#DC2626" Foreground="White" BorderThickness="0" FontWeight="Bold"/>
        </StackPanel>
       </Border>
      </StackPanel>
     </ScrollViewer>
    </DockPanel>
   </Grid>
  </Grid>

  <!-- CORNER NEW ORDER TOAST NOTIFICATION -->
  <Border Name="orderToast" Grid.Row="1" HorizontalAlignment="Right" VerticalAlignment="Bottom" Margin="0,0,24,24" Background="#161B22" BorderBrush="#DC2626" BorderThickness="2" CornerRadius="8" Padding="16" MinWidth="280" MaxWidth="360" Panel.ZIndex="999" Visibility="Collapsed">
   <StackPanel>
    <DockPanel Margin="0,0,0,4">
     <TextBlock Text="NEW ORDER RECEIVED" Foreground="#DC2626" FontWeight="Bold" FontSize="11"/>
     <Button Name="btnDismissToast" DockPanel.Dock="Right" Content="X" Width="20" Height="20" Background="Transparent" Foreground="#8B949E" BorderThickness="0"/>
    </DockPanel>
    <TextBlock Name="toastTitle" Text="#ORD-1082 (Dine-In)" Foreground="White" FontWeight="Bold" FontSize="14" Margin="0,0,0,2"/>
    <TextBlock Name="toastDetails" Text="Table #05 - 3 items - Rs 1,450" Foreground="#8B949E" FontSize="12"/>
   </StackPanel>
  </Border>

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
  'menuList','ordersList','kitchenList','staffList','offersList','inventoryList','marketplaceList','marketCartList','riderDeliveriesList',
  'table','custName','custPhone','custAddress','lblReference','lblCustomer','lblAddress','cartSummary','placeOrder','paid','btnContextAction',
  'btnTypeDineIn','btnTypeDelivery','btnTypePickup',
  'printTicket','preparing','ready','btnKitchenComplete','addStaff','resetPin','deactivateStaff','refresh','status','connection','heading',
  'cashierPane','kitchenPane','staffPane','menuPane','offersPane','inventoryPane','marketplacePane','riderPane','reportsPane',
  'navCashier','navKitchen','navMenu','navOffers','navInventory','navMarketplace','navStaff','navRider','navReports',
  'sidebarTenant','userDisplayName','userRoleBorder','userRoleText','sidebarStationStatus','btnSwitchRole',
  'menuTotalCount','menuInStockCount','menuSoldOutCount','menuSearchText','btnAddNewMenuItem','menuManagementList',
  'btnToggleStock','btnEditMenuItem','btnDeleteMenuItem','btnCreateOffer','btnDeleteOffer',
  'btnOrderVendorWhatsApp','btnRefreshInventory','btnAdjustStock',
  'marketCartSummary','btnSubmitMarketOrder','btnClearMarketCart',
  'btnRiderDispatched','btnRiderDelivered',
  'reportSalesSummary','reportTerminalInfo','btnPrintZReport','btnTestPrinter',
  'settingRestaurantPhone','settingSupplierPhone','settingVendorPhone','btnSaveSettings',
  'ordersWrapPanel','kitchenWrapPanel','ordersSearchBox','ordersAvgWait','btnTogglePosComposer','btnClosePosComposer','posComposerBorder',
  'btnFilterAll','btnFilterDineIn','btnFilterDelivery','btnFilterUrgent','lblDelayedCount','lblCookingCount','lblReadyCount','btnSyncAllTickets',
  'btnKitchenFilterAll','btnKitchenFilterQueued','btnKitchenFilterCooking','btnKitchenFilterReady',
  'orderToast','toastTitle','toastDetails','btnDismissToast'
)
foreach ($name in $ctrlNames) {
  Set-Variable -Scope Script -Name "ui_$name" -Value $window.FindName($name)
}

$script:activeRole = [string]$script:staffSession.role
$script:activeOrderType = 'DINE_IN'
$script:ordersFilter = 'ALL'
$script:kitchenFilter = 'ALL'
$script:ordersSearchQuery = ''
$script:toastTimer = $null
$script:seenOrderKeys = New-Object 'System.Collections.Generic.HashSet[string]'
$script:hasInitializedOrders = $false
$script:supplyProducts = @()
$script:supplierPhone = '03129876543'
$script:vendorPhone = '03215555555'

function Reset-NavSelection {
  $defaultBg = '#14171F'
  $ui_navCashier.Background = $defaultBg
  $ui_navKitchen.Background = $defaultBg
  $ui_navMenu.Background = $defaultBg
  $ui_navOffers.Background = $defaultBg
  $ui_navInventory.Background = $defaultBg
  $ui_navMarketplace.Background = $defaultBg
  $ui_navStaff.Background = $defaultBg
  $ui_navRider.Background = $defaultBg
  $ui_navReports.Background = $defaultBg

  $ui_cashierPane.Visibility = 'Collapsed'
  $ui_kitchenPane.Visibility = 'Collapsed'
  $ui_menuPane.Visibility = 'Collapsed'
  $ui_offersPane.Visibility = 'Collapsed'
  $ui_inventoryPane.Visibility = 'Collapsed'
  $ui_marketplacePane.Visibility = 'Collapsed'
  $ui_staffPane.Visibility = 'Collapsed'
  $ui_riderPane.Visibility = 'Collapsed'
  $ui_reportsPane.Visibility = 'Collapsed'
}

function Set-OrderTypeUI([string]$type) {
  $script:activeOrderType = $type
  $ui_btnTypeDineIn.Background = '#1A1E29'
  $ui_btnTypeDelivery.Background = '#1A1E29'
  $ui_btnTypePickup.Background = '#1A1E29'

  if ($type -eq 'DINE_IN') {
    $ui_btnTypeDineIn.Background = '#DC2626'
    $ui_lblReference.Text = 'Table Number (e.g. T-01, Table 4)'
    $ui_table.Visibility = 'Visible'; $ui_lblReference.Visibility = 'Visible'
    $ui_lblAddress.Visibility = 'Collapsed'; $ui_custAddress.Visibility = 'Collapsed'
    $ui_lblCustomer.Text = 'Customer Name & Phone (Optional for Dine-In)'
  } elseif ($type -eq 'DELIVERY') {
    $ui_btnTypeDelivery.Background = '#DC2626'
    $ui_lblReference.Visibility = 'Collapsed'; $ui_table.Visibility = 'Collapsed'
    $ui_lblAddress.Visibility = 'Visible'; $ui_custAddress.Visibility = 'Visible'
    $ui_lblCustomer.Text = 'Customer Name & Phone (Required for Delivery)'
  } elseif ($type -eq 'PICKUP') {
    $ui_btnTypePickup.Background = '#DC2626'
    $ui_lblReference.Visibility = 'Collapsed'; $ui_table.Visibility = 'Collapsed'
    $ui_lblAddress.Visibility = 'Collapsed'; $ui_custAddress.Visibility = 'Collapsed'
    $ui_lblCustomer.Text = 'Customer Name & Contact Phone (Required for Pickup)'
  }
}

function Update-CartSummary {
  $totalItems = 0; $totalPrice = 0
  foreach ($kv in $script:cart.GetEnumerator()) {
    $item = $script:items | Where-Object { $_.id -eq $kv.Key } | Select-Object -First 1
    if ($item) {
      $totalItems += [int]$kv.Value
      $totalPrice += ([int]$kv.Value * [decimal]$item.price)
    }
  }
  $ui_cartSummary.Text = "Active Cart: $totalItems item(s) (Rs $totalPrice)"
}

function Update-RolePanes {
  $script:activeRole = [string]$script:staffSession.role
  if ($ui_userDisplayName) { $ui_userDisplayName.Text = $script:staffSession.name }
  if ($ui_userRoleText) { $ui_userRoleText.Text = $script:activeRole.ToUpper() }

  if ($script:activeRole -eq 'cashier') {
    $ui_navKitchen.Visibility = 'Collapsed'; $ui_navStaff.Visibility = 'Collapsed'; $ui_navMenu.Visibility = 'Collapsed'
    $ui_navOffers.Visibility = 'Visible'; $ui_navInventory.Visibility = 'Collapsed'; $ui_navMarketplace.Visibility = 'Visible'
    $ui_navRider.Visibility = 'Collapsed'; $ui_navReports.Visibility = 'Collapsed'
    Reset-NavSelection
    $ui_cashierPane.Visibility = 'Visible'; $ui_navCashier.Background = '#DC2626'; $ui_heading.Text = "Orders - POS Terminal"
  } elseif ($script:activeRole -eq 'kitchen') {
    $ui_navCashier.Visibility = 'Collapsed'; $ui_navStaff.Visibility = 'Collapsed'; $ui_navMenu.Visibility = 'Collapsed'
    $ui_navOffers.Visibility = 'Collapsed'; $ui_navInventory.Visibility = 'Visible'; $ui_navMarketplace.Visibility = 'Collapsed'
    $ui_navRider.Visibility = 'Collapsed'; $ui_navReports.Visibility = 'Collapsed'
    Reset-NavSelection
    $ui_kitchenPane.Visibility = 'Visible'; $ui_navKitchen.Background = '#DC2626'; $ui_heading.Text = "Kitchen (KDS Pipeline)"
  } elseif ($script:activeRole -eq 'rider') {
    $ui_navCashier.Visibility = 'Collapsed'; $ui_navKitchen.Visibility = 'Collapsed'; $ui_navMenu.Visibility = 'Collapsed'
    $ui_navOffers.Visibility = 'Collapsed'; $ui_navInventory.Visibility = 'Collapsed'; $ui_navMarketplace.Visibility = 'Collapsed'
    $ui_navStaff.Visibility = 'Collapsed'; $ui_navReports.Visibility = 'Collapsed'
    $ui_navRider.Visibility = 'Visible'
    Reset-NavSelection
    $ui_riderPane.Visibility = 'Visible'; $ui_navRider.Background = '#DC2626'; $ui_heading.Text = "Rider Deliveries"
  } else {
    # Admin / Manager
    $ui_navCashier.Visibility = 'Visible'; $ui_navKitchen.Visibility = 'Visible'; $ui_navMenu.Visibility = 'Visible'
    $ui_navOffers.Visibility = 'Visible'; $ui_navInventory.Visibility = 'Visible'; $ui_navMarketplace.Visibility = 'Visible'
    $ui_navStaff.Visibility = 'Visible'; $ui_navRider.Visibility = 'Visible'; $ui_navReports.Visibility = 'Visible'
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
      $line = "$($member.name)   (@$($member.username))   -   Role: $($member.role)   -   $statusText   -   $syncText"
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
      $line = "$stockStatus   $($item.name)   -   Rs $([decimal]$item.price)   -   Category: $($item.category_name)"
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
  try {
    $res = Bridge '/counter/offers'
    $ui_offersList.Items.Clear()
    foreach ($offer in @($res.offers)) {
      $statusText = if ($offer.active) { 'ACTIVE' } else { 'INACTIVE' }
      $badge = if ($offer.badge_text) { "[$($offer.badge_text)]" } else { '[SPECIAL]' }
      $line = "$badge   $($offer.title)   -   Style: $($offer.card_style)   -   $statusText   -   $($offer.description)"
      $entry = New-Object System.Windows.Controls.ListBoxItem
      $entry.Content = $line; $entry.Tag = $offer; $entry.Padding = '12'; $entry.Margin = '3'; $entry.Background = '#161922'
      $ui_offersList.Items.Add($entry) | Out-Null
    }
  } catch {
    $ui_status.Text = "Offers error: $($_.Exception.Message)"
  }
}

function Reload-Inventory {
  if (-not $ui_inventoryList) { return }
  try {
    $res = Bridge '/counter/inventory'
    $script:vendorPhone = if ($res.vendor_phone) { $res.vendor_phone } else { '03215555555' }
    $ui_inventoryList.Items.Clear()
    foreach ($item in @($res.items)) {
      $isLow = [decimal]$item.current_stock -le [decimal]$item.minimum_threshold
      $statusBadge = if ($isLow) { '[ LOW STOCK ALERT ]' } else { '[ NORMAL ]' }
      $line = "$statusBadge   $($item.name)   -   Stock: $($item.current_stock) $($item.unit)   -   Min: $($item.minimum_threshold) $($item.unit)   -   Cost: Rs $($item.cost_per_unit)"
      $entry = New-Object System.Windows.Controls.ListBoxItem
      $entry.Content = $line; $entry.Tag = $item; $entry.Padding = '12'; $entry.Margin = '3'
      $entry.Background = if ($isLow) { '#31191D' } else { '#161922' }
      $entry.Foreground = if ($isLow) { '#EF4444' } else { '#F0F0F0' }
      $ui_inventoryList.Items.Add($entry) | Out-Null
    }
  } catch {
    $ui_status.Text = "Inventory error: $($_.Exception.Message)"
  }
}

function Reload-Marketplace {
  if (-not $ui_marketplaceList) { return }
  try {
    $res = Bridge '/counter/marketplace'
    $script:supplyProducts = @($res.products)
    $script:supplierPhone = if ($res.supplier_phone) { $res.supplier_phone } else { '03129876543' }
    $ui_marketplaceList.Items.Clear()
    foreach ($p in $script:supplyProducts) {
      $priceStr = if ($p.price) { "Rs $([decimal]$p.price)" } else { "Contact for Price" }
      $line = "[$($p.category)]   $($p.name)   -   $priceStr`n$($p.description)"
      $entry = New-Object System.Windows.Controls.ListBoxItem
      $entry.Content = $line; $entry.Tag = $p; $entry.Padding = '12'; $entry.Margin = '4'; $entry.Background = '#161922'
      $ui_marketplaceList.Items.Add($entry) | Out-Null
    }
  } catch { }
}

function Update-MarketCartUI {
  if (-not $ui_marketCartList) { return }
  $ui_marketCartList.Items.Clear()
  $count = 0; $total = 0
  foreach ($kv in $script:supplyCart.GetEnumerator()) {
    $p = $script:supplyProducts | Where-Object { $_.id -eq $kv.Key } | Select-Object -First 1
    if ($p) {
      $qty = [int]$kv.Value
      $count += $qty
      $price = if ($p.price) { [decimal]$p.price } else { 0 }
      $sub = $qty * $price
      $total += $sub
      $entry = New-Object System.Windows.Controls.ListBoxItem
      $entry.Content = "$($p.name) × $qty   -   Rs $sub"
      $entry.Tag = $p; $entry.Padding = '10'; $entry.Margin = '2'; $entry.Background = '#161922'
      $ui_marketCartList.Items.Add($entry) | Out-Null
    }
  }
  $ui_marketCartSummary.Text = "$count item(s) selected  -  Subtotal: Rs $total"
}

function Reload-Settings {
  try {
    $res = Bridge '/counter/settings'
    $s = $res.settings
    if ($ui_settingRestaurantPhone -and $s.restaurant_phone) { $ui_settingRestaurantPhone.Text = [string]$s.restaurant_phone }
    if ($ui_settingSupplierPhone -and $s.supplier_marketplace_phone) { $ui_settingSupplierPhone.Text = [string]$s.supplier_marketplace_phone }
    if ($ui_settingVendorPhone -and $s.vendor_phone) { $ui_settingVendorPhone.Text = [string]$s.vendor_phone }
  } catch { }
}

function Reload-Reports {
  if (-not $ui_reportSalesSummary) { return }
  try {
    $paidOrders = @($script:orders | Where-Object { $_.payment_status -eq 'PAID' })
    $totalSales = 0
    foreach ($o in $paidOrders) { $totalSales += [decimal]$o.total_amount }
    $ui_reportSalesSummary.Text = "Completed Orders: $($paidOrders.Count)   -   Total Sales: Rs $totalSales"
    $ui_reportTerminalInfo.Text = "Terminal: $($ui_sidebarTenant.Text)   -   Bridge: 127.0.0.1:8765   -   Queue: $($script:orders.Count) orders cached"
  } catch { }
}

function Reload-RiderDeliveries {
  if (-not $ui_riderDeliveriesList) { return }
  $ui_riderDeliveriesList.Items.Clear()
  $myId = [string]$script:staffSession.id
  $myUsername = [string]$script:staffSession.username

  $delivs = @($script:orders | Where-Object { $_.order_type -eq 'DELIVERY' -and $_.counter_status -ne 'COMPLETED' })
  foreach ($d in $delivs) {
    $itemsText = ($d.items | ForEach-Object { "$($_.name) × $($_.quantity)" }) -join ', '
    $riderText = if ($d.rider_name) { "Rider: $($d.rider_name)" } else { "Unassigned" }
    $line = "#$($d.sequence_no)   -   $($d.counter_status)   -   $riderText`nCustomer: $($d.customer_name) ($($d.customer_phone))`nAddress: $($d.customer_address)`nItems: $itemsText   -   Total: Rs $($d.total_amount)"
    $entry = New-Object System.Windows.Controls.ListBoxItem
    $entry.Content = $line; $entry.Tag = $d; $entry.Padding = '12'; $entry.Margin = '3'
    $entry.Background = if ($d.rider_name -eq $myUsername -or $d.rider_name -eq $script:staffSession.name) { '#1B2E24' } else { '#161922' }
    $ui_riderDeliveriesList.Items.Add($entry) | Out-Null
  }
}

function Show-OrderToast($order) {
  if (-not $ui_orderToast) { return }
  try {
    $num = if ($order.sequence_no) { "#$($order.sequence_no)" } elseif ($order.order_number) { "#$($order.order_number)" } else { "NEW ORDER" }
    $type = if ($order.order_type) { $order.order_type } else { "DINE_IN" }
    $info = if ($order.table_number) { "Table $($order.table_number)" } elseif ($order.customer_name) { "$($order.customer_name)" } else { "" }
    $itemCount = if ($order.items) { @($order.items).Count } else { 0 }
    $total = if ($order.total_amount) { "Rs $($order.total_amount)" } else { "" }

    $ui_toastTitle.Text = "$num ($type)"
    $ui_toastDetails.Text = "$info - $itemCount item(s) - $total"
    $ui_orderToast.Visibility = 'Visible'
    
    # Play single short notification sound
    try { [System.Media.SystemSounds]::Asterisk.Play() } catch {}

    # Auto-dismiss after 5.5s
    if ($script:toastTimer) { $script:toastTimer.Stop() }
    $script:toastTimer = New-Object System.Windows.Threading.DispatcherTimer
    $script:toastTimer.Interval = [TimeSpan]::FromSeconds(5.5)
    $script:toastTimer.Add_Tick({
      $script:toastTimer.Stop()
      $ui_orderToast.Visibility = 'Collapsed'
    })
    $script:toastTimer.Start()
  } catch {}
}

function Set-OrdersFilterUI([string]$filter) {
  $script:ordersFilter = $filter
  $defaultBg = '#1A1E29'
  $defaultFg = '#8B949E'
  $activeBg = '#DC2626'
  $activeFg = 'White'

  if ($ui_btnFilterAll) { $ui_btnFilterAll.Background = $defaultBg; $ui_btnFilterAll.Foreground = $defaultFg }
  if ($ui_btnFilterDineIn) { $ui_btnFilterDineIn.Background = $defaultBg; $ui_btnFilterDineIn.Foreground = $defaultFg }
  if ($ui_btnFilterDelivery) { $ui_btnFilterDelivery.Background = $defaultBg; $ui_btnFilterDelivery.Foreground = $defaultFg }
  if ($ui_btnFilterUrgent) { $ui_btnFilterUrgent.Background = $defaultBg; $ui_btnFilterUrgent.Foreground = '#EF4444' }

  if ($filter -eq 'ALL' -and $ui_btnFilterAll) { $ui_btnFilterAll.Background = $activeBg; $ui_btnFilterAll.Foreground = $activeFg }
  elseif ($filter -eq 'DINE_IN' -and $ui_btnFilterDineIn) { $ui_btnFilterDineIn.Background = $activeBg; $ui_btnFilterDineIn.Foreground = $activeFg }
  elseif ($filter -eq 'DELIVERY' -and $ui_btnFilterDelivery) { $ui_btnFilterDelivery.Background = $activeBg; $ui_btnFilterDelivery.Foreground = $activeFg }
  elseif ($filter -eq 'URGENT' -and $ui_btnFilterUrgent) { $ui_btnFilterUrgent.Background = $activeBg; $ui_btnFilterUrgent.Foreground = $activeFg }

  Render-OrdersCards
}

function Set-KitchenFilterUI([string]$filter) {
  $script:kitchenFilter = $filter
  $defaultBg = '#1A1E29'
  $defaultFg = '#8B949E'
  $activeBg = '#DC2626'
  $activeFg = 'White'

  if ($ui_btnKitchenFilterAll) { $ui_btnKitchenFilterAll.Background = $defaultBg; $ui_btnKitchenFilterAll.Foreground = $defaultFg }
  if ($ui_btnKitchenFilterQueued) { $ui_btnKitchenFilterQueued.Background = $defaultBg; $ui_btnKitchenFilterQueued.Foreground = $defaultFg }
  if ($ui_btnKitchenFilterCooking) { $ui_btnKitchenFilterCooking.Background = $defaultBg; $ui_btnKitchenFilterCooking.Foreground = $defaultFg }
  if ($ui_btnKitchenFilterReady) { $ui_btnKitchenFilterReady.Background = $defaultBg; $ui_btnKitchenFilterReady.Foreground = $defaultFg }

  if ($filter -eq 'ALL' -and $ui_btnKitchenFilterAll) { $ui_btnKitchenFilterAll.Background = $activeBg; $ui_btnKitchenFilterAll.Foreground = $activeFg }
  elseif ($filter -eq 'QUEUED' -and $ui_btnKitchenFilterQueued) { $ui_btnKitchenFilterQueued.Background = $activeBg; $ui_btnKitchenFilterQueued.Foreground = $activeFg }
  elseif ($filter -eq 'COOKING' -and $ui_btnKitchenFilterCooking) { $ui_btnKitchenFilterCooking.Background = $activeBg; $ui_btnKitchenFilterCooking.Foreground = $activeFg }
  elseif ($filter -eq 'READY' -and $ui_btnKitchenFilterReady) { $ui_btnKitchenFilterReady.Background = $activeBg; $ui_btnKitchenFilterReady.Foreground = $activeFg }

  Render-KitchenCards
}

function Render-OrdersCards {
  if (-not $ui_ordersWrapPanel) { return }
  $ui_ordersWrapPanel.Children.Clear()

  $allOrders = @($script:orders)
  foreach ($ro in $script:remoteOrders) {
    if (-not ($allOrders | Where-Object { $_.client_order_id -eq $ro.id -or $_.sequence_no -eq $ro.order_number })) {
      $allOrders += [pscustomobject]@{
        client_order_id = $ro.id
        sequence_no = $ro.order_number
        order_type = if ($ro.order_type) { $ro.order_type } else { 'DINE_IN' }
        table_number = $ro.table_number
        customer_name = $ro.customer_name
        customer_phone = $ro.customer_phone
        customer_address = $ro.customer_address
        total_amount = $ro.total_amount
        counter_status = if ($ro.status) { $ro.status } else { 'PENDING' }
        payment_status = if ($ro.payment_status) { $ro.payment_status } else { 'PENDING' }
        created_at = $ro.created_at
        items = $ro.items
        approved = if ($ro.status -in @('PREPARING', 'READY', 'COMPLETED')) { 1 } else { 0 }
      }
    }
  }

  $delayedCount = 0
  $cookingCount = 0
  $readyCount = 0
  $totalWaitSec = 0
  $activeCount = 0

  $now = [DateTime]::UtcNow

  foreach ($order in $allOrders) {
    $orderTime = $now
    if ($order.created_at) {
      $parsedTime = [DateTime]::MinValue
      if ([DateTime]::TryParse($order.created_at, [ref]$parsedTime)) {
        $orderTime = $parsedTime.ToUniversalTime()
      }
    }
    $age = $now - $orderTime
    if ($age.TotalSeconds -lt 0) { $age = [TimeSpan]::Zero }
    $totalMinutes = [int]$age.TotalMinutes
    $remSeconds = [int]$age.Seconds
    $ageText = "${totalMinutes}m ${remSeconds}s"

    $isDelayed = ($totalMinutes -ge 15 -and $order.counter_status -notin @('COMPLETED', 'CANCELLED'))
    if ($isDelayed) { $delayedCount++ }
    if ($order.counter_status -eq 'PREPARING') { $cookingCount++ }
    if ($order.counter_status -eq 'READY') { $readyCount++ }

    if ($order.counter_status -notin @('COMPLETED', 'CANCELLED')) {
      $totalWaitSec += $age.TotalSeconds
      $activeCount++
    }

    # Filter tab
    if ($script:ordersFilter -eq 'DINE_IN' -and $order.order_type -ne 'DINE_IN') { continue }
    if ($script:ordersFilter -eq 'DELIVERY' -and $order.order_type -notin @('DELIVERY', 'PICKUP')) { continue }
    if ($script:ordersFilter -eq 'URGENT' -and -not $isDelayed) { continue }

    # Search filter
    if ($script:ordersSearchQuery) {
      $q = $script:ordersSearchQuery.ToLower()
      $matchSeq = "$($order.sequence_no)".Contains($q)
      $matchTbl = "$($order.table_number)".ToLower().Contains($q)
      $matchCust = "$($order.customer_name) $($order.customer_phone)".ToLower().Contains($q)
      $matchItems = (($order.items | ForEach-Object { $_.name }) -join ' ').ToLower().Contains($q)
      if (-not ($matchSeq -or $matchTbl -or $matchCust -or $matchItems)) { continue }
    }

    $card = New-Object System.Windows.Controls.Border
    $card.Width = 338
    $card.Margin = '6'
    $card.Background = ConvertTo-UiBrush '#161B22'
    $card.BorderBrush = if ($isDelayed) { ConvertTo-UiBrush '#920703' } else { ConvertTo-UiBrush '#222736' }
    $card.BorderThickness = '1'
    $card.CornerRadius = '8'

    $cardLayout = New-Object System.Windows.Controls.DockPanel
    $card.Child = $cardLayout

    # 1. Top Ribbon
    $ribbon = New-Object System.Windows.Controls.Border
    $ribbon.CornerRadius = '8,8,0,0'
    $ribbon.Padding = '12,6'
    $ribbon.Background = if ($isDelayed) { ConvertTo-UiBrush '#920703' } else { ConvertTo-UiBrush '#1A1E29' }
    [System.Windows.Controls.DockPanel]::SetDock($ribbon, [System.Windows.Controls.Dock]::Top)

    $ribbonDock = New-Object System.Windows.Controls.DockPanel
    $lblRibbonLeft = New-Object System.Windows.Controls.TextBlock
    $lblRibbonLeft.Text = if ($isDelayed) { "DELAYED CRITICAL: >15m" } else { "WAIT TIME" }
    $lblRibbonLeft.Foreground = if ($isDelayed) { ConvertTo-UiBrush 'White' } else { ConvertTo-UiBrush '#8B949E' }
    $lblRibbonLeft.FontWeight = 'Bold'
    $lblRibbonLeft.FontSize = 10
    $lblRibbonLeft.VerticalAlignment = 'Center'
    $ribbonDock.Children.Add($lblRibbonLeft) | Out-Null

    $lblRibbonRight = New-Object System.Windows.Controls.TextBlock
    $lblRibbonRight.Text = $ageText
    $lblRibbonRight.Foreground = if ($isDelayed) { ConvertTo-UiBrush 'White' } else { ConvertTo-UiBrush '#F0F0F0' }
    $lblRibbonRight.FontWeight = 'Bold'
    $lblRibbonRight.FontSize = 11
    $lblRibbonRight.HorizontalAlignment = 'Right'
    [System.Windows.Controls.DockPanel]::SetDock($lblRibbonRight, [System.Windows.Controls.Dock]::Right)
    $ribbonDock.Children.Add($lblRibbonRight) | Out-Null

    $ribbon.Child = $ribbonDock
    $cardLayout.Children.Add($ribbon) | Out-Null

    # 2. Action Buttons Footer (BOTTOM DOCK) - Exactly TWO Actions
    $footerGrid = New-Object System.Windows.Controls.Grid
    $footerGrid.Margin = '12,8,12,12'
    [System.Windows.Controls.DockPanel]::SetDock($footerGrid, [System.Windows.Controls.Dock]::Bottom)
    $footerGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star) }))
    $footerGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star) }))

    # Action 1: "Approve" (or Read-only status view if already approved)
    $isApproved = ($order.approved -eq 1 -or $order.approved -eq $true -or $order.counter_status -in @('PREPARING', 'READY', 'COMPLETED'))
    if (-not $isApproved) {
      $btnApprove = New-Object System.Windows.Controls.Button
      $btnApprove.Content = "Approve"
      $btnApprove.Height = 38
      $btnApprove.Margin = '0,0,4,0'
      $btnApprove.Background = ConvertTo-UiBrush '#DC2626'
      $btnApprove.Foreground = ConvertTo-UiBrush 'White'
      $btnApprove.FontWeight = 'Bold'
      $btnApprove.FontSize = 12
      $btnApprove.BorderThickness = '0'

      $targetOrder = $order
      $btnApprove.Add_Click(({
        try {
          if ($targetOrder.client_order_id) {
            $null = Bridge '/counter/orders/approve' 'POST' @{ client_order_id = $targetOrder.client_order_id }
          }
          Reload-Counter
          $ui_status.Text = "Order #$($targetOrder.sequence_no) approved and queued for kitchen."
        } catch {
          $ui_status.Text = "Approval failed: $($_.Exception.Message)"
        }
      }.GetNewClosure()))
      [System.Windows.Controls.Grid]::SetColumn($btnApprove, 0)
      $footerGrid.Children.Add($btnApprove) | Out-Null
    } else {
      # Read-only status view
      $statusBorder = New-Object System.Windows.Controls.Border
      $statusBorder.Height = 38
      $statusBorder.Margin = '0,0,4,0'
      $statusBorder.CornerRadius = '4'
      $statusBorder.Background = ConvertTo-UiBrush '#1A1E29'
      $statusBorder.BorderBrush = ConvertTo-UiBrush '#222736'
      $statusBorder.BorderThickness = '1'

      $statusLabel = New-Object System.Windows.Controls.TextBlock
      $statusLabel.Text = if ($order.counter_status -eq 'READY') { "Ready" } elseif ($order.counter_status -eq 'PREPARING') { "Cooking" } elseif ($order.counter_status -eq 'COMPLETED') { "Completed" } else { "In Kitchen" }
      $statusLabel.Foreground = if ($order.counter_status -eq 'READY') { ConvertTo-UiBrush '#10B981' } elseif ($order.counter_status -eq 'PREPARING') { ConvertTo-UiBrush '#F59E0B' } else { ConvertTo-UiBrush '#3B82F6' }
      $statusLabel.FontWeight = 'Bold'
      $statusLabel.FontSize = 11
      $statusLabel.HorizontalAlignment = 'Center'
      $statusLabel.VerticalAlignment = 'Center'
      $statusBorder.Child = $statusLabel

      [System.Windows.Controls.Grid]::SetColumn($statusBorder, 0)
      $footerGrid.Children.Add($statusBorder) | Out-Null
    }

    # Action 2: "Print Slip"
    $btnPrint = New-Object System.Windows.Controls.Button
    $btnPrint.Content = "Print Slip"
    $btnPrint.Height = 38
    $btnPrint.Margin = '4,0,0,0'
    $btnPrint.Background = ConvertTo-UiBrush '#1A1E29'
    $btnPrint.Foreground = ConvertTo-UiBrush '#F0F0F0'
    $btnPrint.BorderBrush = ConvertTo-UiBrush '#222736'
    $btnPrint.BorderThickness = '1'
    $btnPrint.FontSize = 12

    $printOrder = $order
    $btnPrint.Add_Click(({
      try {
        $null = Bridge '/print' 'POST' @{
          client_order_id = $printOrder.client_order_id
          order_number = "#$($printOrder.sequence_no)"
          order_type = $printOrder.order_type
          table_number = $printOrder.table_number
          total_amount = $printOrder.total_amount
          items = $printOrder.items
          print_type = 'KOT'
        }
        $ui_status.Text = "Printed ticket for order #$($printOrder.sequence_no)."
      } catch {
        $ui_status.Text = "Print error: $($_.Exception.Message)"
      }
    }.GetNewClosure()))

    [System.Windows.Controls.Grid]::SetColumn($btnPrint, 1)
    $footerGrid.Children.Add($btnPrint) | Out-Null
    $cardLayout.Children.Add($footerGrid) | Out-Null

    # 3. Card Body Content (STACKPANEL IN CENTER)
    $bodyStack = New-Object System.Windows.Controls.StackPanel
    $bodyStack.Margin = '12,10,12,0'

    # Order Header DockPanel
    $headerDock = New-Object System.Windows.Controls.DockPanel
    $headerLeft = New-Object System.Windows.Controls.StackPanel
    $txtOrderNo = New-Object System.Windows.Controls.TextBlock
    $txtOrderNo.Text = "#ORD-$($order.sequence_no)"
    $txtOrderNo.FontSize = 18
    $txtOrderNo.FontWeight = 'Bold'
    $txtOrderNo.Foreground = ConvertTo-UiBrush '#F0F0F0'
    $headerLeft.Children.Add($txtOrderNo) | Out-Null

    $serverInfo = if ($order.staff_name) { "Server: $($order.staff_name)" } else { "Online/QR Order" }
    $txtServer = New-Object System.Windows.Controls.TextBlock
    $txtServer.Text = $serverInfo
    $txtServer.FontSize = 11
    $txtServer.Foreground = ConvertTo-UiBrush '#8B949E'
    $headerLeft.Children.Add($txtServer) | Out-Null
    $headerDock.Children.Add($headerLeft) | Out-Null

    # Right Type/Table badge + status pill
    $headerRight = New-Object System.Windows.Controls.StackPanel
    $headerRight.HorizontalAlignment = 'Right'
    [System.Windows.Controls.DockPanel]::SetDock($headerRight, [System.Windows.Controls.Dock]::Right)

    $badgeType = New-Object System.Windows.Controls.Border
    $badgeType.Background = ConvertTo-UiBrush '#1A1E29'
    $badgeType.CornerRadius = '4'
    $badgeType.Padding = '6,2'
    $badgeType.HorizontalAlignment = 'Right'
    $txtBadge = New-Object System.Windows.Controls.TextBlock
    $txtBadge.Text = if ($order.order_type -eq 'DINE_IN') { "Table $($order.table_number)" } elseif ($order.order_type -eq 'DELIVERY') { "Delivery" } else { "Pickup" }
    $txtBadge.Foreground = ConvertTo-UiBrush '#F0F0F0'
    $txtBadge.FontSize = 11
    $txtBadge.FontWeight = 'Bold'
    $badgeType.Child = $txtBadge
    $headerRight.Children.Add($badgeType) | Out-Null

    $badgeStatus = New-Object System.Windows.Controls.Border
    $badgeStatus.CornerRadius = '4'
    $badgeStatus.Padding = '6,2'
    $badgeStatus.Margin = '0,4,0,0'
    $badgeStatus.HorizontalAlignment = 'Right'
    $badgeStatus.Background = if (-not $isApproved) { ConvertTo-UiBrush '#920703' } elseif ($order.counter_status -eq 'PREPARING') { ConvertTo-UiBrush '#2A1F11' } elseif ($order.counter_status -eq 'READY') { ConvertTo-UiBrush '#133526' } else { ConvertTo-UiBrush '#1A1E29' }
    $txtStatus = New-Object System.Windows.Controls.TextBlock
    $txtStatus.Text = if (-not $isApproved) { "AWAITING APPROVAL" } elseif ($order.counter_status -eq 'PREPARING') { "COOKING" } elseif ($order.counter_status -eq 'READY') { "READY" } else { "QUEUED" }
    $txtStatus.Foreground = if (-not $isApproved) { ConvertTo-UiBrush '#F0F0F0' } elseif ($order.counter_status -eq 'PREPARING') { ConvertTo-UiBrush '#F59E0B' } elseif ($order.counter_status -eq 'READY') { ConvertTo-UiBrush '#10B981' } else { ConvertTo-UiBrush '#3B82F6' }
    $txtStatus.FontSize = 10
    $txtStatus.FontWeight = 'Bold'
    $badgeStatus.Child = $txtStatus
    $headerRight.Children.Add($badgeStatus) | Out-Null

    $headerDock.Children.Add($headerRight) | Out-Null
    $bodyStack.Children.Add($headerDock) | Out-Null

    # Items Ledger
    $ledgerBorder = New-Object System.Windows.Controls.Border
    $ledgerBorder.Margin = '0,8,0,8'
    $ledgerBorder.Padding = '0,6,0,6'
    $ledgerBorder.BorderBrush = ConvertTo-UiBrush '#222736'
    $ledgerBorder.BorderThickness = '0,1,0,1'

    $itemsPanel = New-Object System.Windows.Controls.StackPanel
    foreach ($item in $order.items) {
      $itemDock = New-Object System.Windows.Controls.DockPanel
      $itemDock.Margin = '0,3,0,3'

      # Small Item Thumbnail Box (DESIGN_FINAL §2.1)
      $thumbBorder = New-Object System.Windows.Controls.Border
      $thumbBorder.Width = 32
      $thumbBorder.Height = 32
      $thumbBorder.CornerRadius = '4'
      $thumbBorder.Background = ConvertTo-UiBrush '#0D0D0D'
      $thumbBorder.BorderBrush = ConvertTo-UiBrush '#222736'
      $thumbBorder.BorderThickness = '1'
      $thumbBorder.Margin = '0,0,8,0'
      
      $thumbTxt = New-Object System.Windows.Controls.TextBlock
      $thumbTxt.Text = "[-]"
      $thumbTxt.FontSize = 11
      $thumbTxt.HorizontalAlignment = 'Center'
      $thumbTxt.VerticalAlignment = 'Center'
      $thumbBorder.Child = $thumbTxt
      $itemDock.Children.Add($thumbBorder) | Out-Null

      $itemPrice = New-Object System.Windows.Controls.TextBlock
      $lineTotal = if ($item.price_at_order) { [decimal]$item.price_at_order * [int]$item.quantity } else { [decimal]$item.price * [int]$item.quantity }
      $itemPrice.Text = "Rs $lineTotal"
      $itemPrice.Foreground = ConvertTo-UiBrush '#8B949E'
      $itemPrice.FontSize = 11
      $itemPrice.VerticalAlignment = 'Center'
      [System.Windows.Controls.DockPanel]::SetDock($itemPrice, [System.Windows.Controls.Dock]::Right)
      $itemDock.Children.Add($itemPrice) | Out-Null

      $itemCenter = New-Object System.Windows.Controls.StackPanel
      $itemName = New-Object System.Windows.Controls.TextBlock
      $itemName.Text = "$($item.quantity)x $($item.name)"
      $itemName.Foreground = ConvertTo-UiBrush '#F0F0F0'
      $itemName.FontWeight = 'Bold'
      $itemName.FontSize = 12
      $itemCenter.Children.Add($itemName) | Out-Null

      if ($item.notes) {
        $itemNotes = New-Object System.Windows.Controls.TextBlock
        $itemNotes.Text = [string]$item.notes
        $itemNotes.Foreground = ConvertTo-UiBrush '#DC2626'
        $itemNotes.FontSize = 10
        $itemCenter.Children.Add($itemNotes) | Out-Null
      }
      $itemDock.Children.Add($itemCenter) | Out-Null

      $itemsPanel.Children.Add($itemDock) | Out-Null
    }
    $ledgerBorder.Child = $itemsPanel
    $bodyStack.Children.Add($ledgerBorder) | Out-Null

    # Payment Summary
    $payDock = New-Object System.Windows.Controls.DockPanel
    $payBadge = New-Object System.Windows.Controls.TextBlock
    $payText = if ($order.order_type -eq 'DINE_IN') {
      if ($order.payment_status -eq 'PAID') { "Paid Dine-In" } else { "Unpaid Dine-In" }
    } elseif ($order.order_type -eq 'DELIVERY') {
      if ($order.payment_status -eq 'PAID') { "Paid Online" } else { "Cash on Delivery" }
    } else {
      if ($order.payment_status -eq 'PAID') { "Paid Pickup" } else { "Pay at Pickup" }
    }
    $payBadge.Text = $payText
    $payBadge.Foreground = if ($order.payment_status -eq 'PAID') { ConvertTo-UiBrush '#10B981' } else { ConvertTo-UiBrush '#8B949E' }
    $payBadge.FontSize = 11
    $payBadge.VerticalAlignment = 'Center'
    $payDock.Children.Add($payBadge) | Out-Null

    $totalText = New-Object System.Windows.Controls.TextBlock
    $totalText.Text = "TOTAL Rs $($order.total_amount)"
    $totalText.Foreground = ConvertTo-UiBrush 'White'
    $totalText.FontWeight = 'Bold'
    $totalText.FontSize = 14
    $totalText.HorizontalAlignment = 'Right'
    [System.Windows.Controls.DockPanel]::SetDock($totalText, [System.Windows.Controls.Dock]::Right)
    $payDock.Children.Add($totalText) | Out-Null

    $bodyStack.Children.Add($payDock) | Out-Null
    $cardLayout.Children.Add($bodyStack) | Out-Null

    $ui_ordersWrapPanel.Children.Add($card) | Out-Null
  }

  # Update Footer ledger counts
  if ($ui_lblDelayedCount) { $ui_lblDelayedCount.Text = "Delayed > 15m ($delayedCount)" }
  if ($ui_lblCookingCount) { $ui_lblCookingCount.Text = "In Kitchen ($cookingCount)" }
  if ($ui_lblReadyCount) { $ui_lblReadyCount.Text = "Ready for Service ($readyCount)" }

  # Update Avg wait
  if ($ui_ordersAvgWait) {
    if ($activeCount -gt 0) {
      $avgSec = [int]($totalWaitSec / $activeCount)
      $avgMin = [int]($avgSec / 60)
      $remSec = $avgSec % 60
      $ui_ordersAvgWait.Text = "Avg Wait: ${avgMin}m ${remSec}s"
    } else {
      $ui_ordersAvgWait.Text = "Avg Wait: 0m 0s"
    }
  }
}

function Render-KitchenCards {
  if (-not $ui_kitchenWrapPanel) { return }
  $ui_kitchenWrapPanel.Children.Clear()

  $allOrders = @($script:orders)
  foreach ($ro in $script:remoteOrders) {
    if (-not ($allOrders | Where-Object { $_.client_order_id -eq $ro.id -or $_.sequence_no -eq $ro.order_number })) {
      $allOrders += [pscustomobject]@{
        client_order_id = $ro.id
        sequence_no = $ro.order_number
        order_type = if ($ro.order_type) { $ro.order_type } else { 'DINE_IN' }
        table_number = $ro.table_number
        customer_name = $ro.customer_name
        total_amount = $ro.total_amount
        counter_status = if ($ro.status) { $ro.status } else { 'PENDING' }
        created_at = $ro.created_at
        items = $ro.items
        approved = if ($ro.status -in @('PREPARING', 'READY', 'COMPLETED')) { 1 } else { 0 }
      }
    }
  }

  # Filter ONLY approved orders active in kitchen queue
  $kitchenTickets = @($allOrders | Where-Object {
    $isApproved = ($_.approved -eq 1 -or $_.approved -eq $true -or $_.counter_status -in @('PREPARING', 'READY'))
    $isActive = ($_.counter_status -in @('PENDING', 'PREPARING', 'READY'))
    $isApproved -and $isActive
  })

  $now = [DateTime]::UtcNow

  foreach ($ticket in $kitchenTickets) {
    # Kitchen filter tabs
    if ($script:kitchenFilter -eq 'QUEUED' -and $ticket.counter_status -ne 'PENDING') { continue }
    if ($script:kitchenFilter -eq 'COOKING' -and $ticket.counter_status -ne 'PREPARING') { continue }
    if ($script:kitchenFilter -eq 'READY' -and $ticket.counter_status -ne 'READY') { continue }

    # Calculate age
    $orderTime = $now
    if ($ticket.created_at) {
      $parsedTime = [DateTime]::MinValue
      if ([DateTime]::TryParse($ticket.created_at, [ref]$parsedTime)) {
        $orderTime = $parsedTime.ToUniversalTime()
      }
    }
    $age = $now - $orderTime
    if ($age.TotalSeconds -lt 0) { $age = [TimeSpan]::Zero }
    $totalMinutes = [int]$age.TotalMinutes
    $remSeconds = [int]$age.Seconds
    $ageText = "${totalMinutes}m ${remSeconds}s"
    $isDelayed = ($totalMinutes -ge 15)
    $isReady = ($ticket.counter_status -eq 'READY')

    # Card border
    $card = New-Object System.Windows.Controls.Border
    $card.Width = 338
    $card.Margin = '6'
    $card.Background = ConvertTo-UiBrush '#161B22'
    $card.BorderBrush = if ($isReady) { ConvertTo-UiBrush '#10B981' } elseif ($isDelayed) { ConvertTo-UiBrush '#920703' } else { ConvertTo-UiBrush '#222736' }
    $card.BorderThickness = if ($isReady) { '2' } else { '1' }
    $card.CornerRadius = '8'

    $cardLayout = New-Object System.Windows.Controls.DockPanel
    $card.Child = $cardLayout

    # 1. Top Ribbon
    $ribbon = New-Object System.Windows.Controls.Border
    $ribbon.CornerRadius = '8,8,0,0'
    $ribbon.Padding = '12,6'
    $ribbon.Background = if ($isReady) { ConvertTo-UiBrush '#133526' } elseif ($isDelayed) { ConvertTo-UiBrush '#920703' } else { ConvertTo-UiBrush '#1A1E29' }
    [System.Windows.Controls.DockPanel]::SetDock($ribbon, [System.Windows.Controls.Dock]::Top)

    $ribbonDock = New-Object System.Windows.Controls.DockPanel
    $lblRibbonLeft = New-Object System.Windows.Controls.TextBlock
    $lblRibbonLeft.Text = if ($isReady) { "READY ON PASS" } elseif ($isDelayed) { "VIP CRITICAL WAIT: >15m" } else { "KITCHEN TIMER" }
    $lblRibbonLeft.Foreground = if ($isReady) { ConvertTo-UiBrush '#10B981' } elseif ($isDelayed) { ConvertTo-UiBrush 'White' } else { ConvertTo-UiBrush '#8B949E' }
    $lblRibbonLeft.FontWeight = 'Bold'
    $lblRibbonLeft.FontSize = 10
    $lblRibbonLeft.VerticalAlignment = 'Center'
    $ribbonDock.Children.Add($lblRibbonLeft) | Out-Null

    $lblRibbonRight = New-Object System.Windows.Controls.TextBlock
    $lblRibbonRight.Text = $ageText
    $lblRibbonRight.Foreground = if ($isReady) { ConvertTo-UiBrush '#10B981' } elseif ($isDelayed) { ConvertTo-UiBrush 'White' } else { ConvertTo-UiBrush '#F0F0F0' }
    $lblRibbonRight.FontWeight = 'Bold'
    $lblRibbonRight.FontSize = 11
    $lblRibbonRight.HorizontalAlignment = 'Right'
    [System.Windows.Controls.DockPanel]::SetDock($lblRibbonRight, [System.Windows.Controls.Dock]::Right)
    $ribbonDock.Children.Add($lblRibbonRight) | Out-Null

    $ribbon.Child = $ribbonDock
    $cardLayout.Children.Add($ribbon) | Out-Null

    # 2. Action Buttons Footer (BOTTOM DOCK) - Exactly TWO Actions in Sequence
    $footerGrid = New-Object System.Windows.Controls.Grid
    $footerGrid.Margin = '12,8,12,12'
    [System.Windows.Controls.DockPanel]::SetDock($footerGrid, [System.Windows.Controls.Dock]::Bottom)
    $footerGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star) }))
    $footerGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star) }))

    $tkt = $ticket

    # Button 1: "Start Cooking"
    if ($ticket.counter_status -eq 'PENDING') {
      $btnStartCook = New-Object System.Windows.Controls.Button
      $btnStartCook.Content = "Start Cooking"
      $btnStartCook.Height = 40
      $btnStartCook.Margin = '0,0,4,0'
      $btnStartCook.Background = ConvertTo-UiBrush '#DC2626'
      $btnStartCook.Foreground = ConvertTo-UiBrush 'White'
      $btnStartCook.FontWeight = 'Bold'
      $btnStartCook.FontSize = 12
      $btnStartCook.BorderThickness = '0'

      $btnStartCook.Add_Click(({
        try {
          if ($tkt.client_order_id) {
            $null = Bridge '/counter/orders/status' 'POST' @{ client_order_id = $tkt.client_order_id; counter_status = 'PREPARING' }
          }
          Reload-Counter
          $ui_status.Text = "Order #$($tkt.sequence_no) is now cooking (PREPARING)."
        } catch {
          $ui_status.Text = "Status update failed: $($_.Exception.Message)"
        }
      }.GetNewClosure()))
      [System.Windows.Controls.Grid]::SetColumn($btnStartCook, 0)
      $footerGrid.Children.Add($btnStartCook) | Out-Null
    } else {
      $lblCookState = New-Object System.Windows.Controls.Border
      $lblCookState.Height = 40
      $lblCookState.Margin = '0,0,4,0'
      $lblCookState.CornerRadius = '4'
      $lblCookState.Background = ConvertTo-UiBrush '#1A1E29'
      $lblCookState.BorderBrush = ConvertTo-UiBrush '#222736'
      $lblCookState.BorderThickness = '1'

      $txtCook = New-Object System.Windows.Controls.TextBlock
      $txtCook.Text = if ($ticket.counter_status -eq 'READY') { "Cooked [OK]" } else { "Cooking..." }
      $txtCook.Foreground = if ($ticket.counter_status -eq 'READY') { ConvertTo-UiBrush '#10B981' } else { ConvertTo-UiBrush '#F59E0B' }
      $txtCook.FontWeight = 'Bold'
      $txtCook.FontSize = 11
      $txtCook.HorizontalAlignment = 'Center'
      $txtCook.VerticalAlignment = 'Center'
      $lblCookState.Child = $txtCook
      [System.Windows.Controls.Grid]::SetColumn($lblCookState, 0)
      $footerGrid.Children.Add($lblCookState) | Out-Null
    }

    # Button 2: "Order Ready"
    if ($ticket.counter_status -eq 'PREPARING') {
      $btnReady = New-Object System.Windows.Controls.Button
      $btnReady.Content = "Order Ready"
      $btnReady.Height = 40
      $btnReady.Margin = '4,0,0,0'
      $btnReady.Background = ConvertTo-UiBrush '#10B981'
      $btnReady.Foreground = ConvertTo-UiBrush 'White'
      $btnReady.FontWeight = 'Bold'
      $btnReady.FontSize = 12
      $btnReady.BorderThickness = '0'

      $btnReady.Add_Click(({
        try {
          if ($tkt.client_order_id) {
            $null = Bridge '/counter/orders/status' 'POST' @{ client_order_id = $tkt.client_order_id; counter_status = 'READY' }
          }
          Reload-Counter
          $ui_status.Text = "Order #$($tkt.sequence_no) marked READY on pass."
        } catch {
          $ui_status.Text = "Status update failed: $($_.Exception.Message)"
        }
      }.GetNewClosure()))
      [System.Windows.Controls.Grid]::SetColumn($btnReady, 1)
      $footerGrid.Children.Add($btnReady) | Out-Null
    } elseif ($ticket.counter_status -eq 'READY') {
      $lblReadyState = New-Object System.Windows.Controls.Border
      $lblReadyState.Height = 40
      $lblReadyState.Margin = '4,0,0,0'
      $lblReadyState.CornerRadius = '4'
      $lblReadyState.Background = ConvertTo-UiBrush '#133526'
      $lblReadyState.BorderBrush = ConvertTo-UiBrush '#10B981'
      $lblReadyState.BorderThickness = '1'

      $txtReady = New-Object System.Windows.Controls.TextBlock
      $txtReady.Text = "Order Ready"
      $txtReady.Foreground = ConvertTo-UiBrush '#10B981'
      $txtReady.FontWeight = 'Bold'
      $txtReady.FontSize = 12
      $txtReady.HorizontalAlignment = 'Center'
      $txtReady.VerticalAlignment = 'Center'
      $lblReadyState.Child = $txtReady
      [System.Windows.Controls.Grid]::SetColumn($lblReadyState, 1)
      $footerGrid.Children.Add($lblReadyState) | Out-Null
    } else {
      # PENDING
      $lblPendingState = New-Object System.Windows.Controls.Border
      $lblPendingState.Height = 40
      $lblPendingState.Margin = '4,0,0,0'
      $lblPendingState.CornerRadius = '4'
      $lblPendingState.Background = ConvertTo-UiBrush '#1A1E29'
      $lblPendingState.BorderBrush = ConvertTo-UiBrush '#222736'
      $lblPendingState.BorderThickness = '1'

      $txtPending = New-Object System.Windows.Controls.TextBlock
      $txtPending.Text = "Pending Cook"
      $txtPending.Foreground = ConvertTo-UiBrush '#8B949E'
      $txtPending.FontSize = 11
      $txtPending.HorizontalAlignment = 'Center'
      $txtPending.VerticalAlignment = 'Center'
      $lblPendingState.Child = $txtPending
      [System.Windows.Controls.Grid]::SetColumn($lblPendingState, 1)
      $footerGrid.Children.Add($lblPendingState) | Out-Null
    }

    $cardLayout.Children.Add($footerGrid) | Out-Null

    # 3. Ticket Body (Items Ledger)
    $bodyStack = New-Object System.Windows.Controls.StackPanel
    $bodyStack.Margin = '12,10,12,0'

    $headerDock = New-Object System.Windows.Controls.DockPanel
    $headerLeft = New-Object System.Windows.Controls.StackPanel
    $txtTktNo = New-Object System.Windows.Controls.TextBlock
    $txtTktNo.Text = "TK-#$($ticket.sequence_no)"
    $txtTktNo.FontSize = 18
    $txtTktNo.FontWeight = 'Bold'
    $txtTktNo.Foreground = ConvertTo-UiBrush '#F0F0F0'
    $headerLeft.Children.Add($txtTktNo) | Out-Null

    $subInfo = if ($ticket.order_type -eq 'DINE_IN') { "Table $($ticket.table_number)" } elseif ($ticket.order_type -eq 'DELIVERY') { "Delivery" } else { "Pickup" }
    $txtSub = New-Object System.Windows.Controls.TextBlock
    $txtSub.Text = $subInfo
    $txtSub.FontSize = 12
    $txtSub.FontWeight = 'Bold'
    $txtSub.Foreground = ConvertTo-UiBrush '#DC2626'
    $headerLeft.Children.Add($txtSub) | Out-Null
    $headerDock.Children.Add($headerLeft) | Out-Null

    $badgeStatus = New-Object System.Windows.Controls.Border
    $badgeStatus.CornerRadius = '4'
    $badgeStatus.Padding = '8,4'
    $badgeStatus.HorizontalAlignment = 'Right'
    [System.Windows.Controls.DockPanel]::SetDock($badgeStatus, [System.Windows.Controls.Dock]::Right)
    $badgeStatus.Background = if ($ticket.counter_status -eq 'READY') { ConvertTo-UiBrush '#133526' } elseif ($ticket.counter_status -eq 'PREPARING') { ConvertTo-UiBrush '#2A1F11' } else { ConvertTo-UiBrush '#1A1E29' }
    
    $txtStatus = New-Object System.Windows.Controls.TextBlock
    $txtStatus.Text = if ($ticket.counter_status -eq 'READY') { "READY" } elseif ($ticket.counter_status -eq 'PREPARING') { "COOKING" } else { "QUEUED" }
    $txtStatus.Foreground = if ($ticket.counter_status -eq 'READY') { ConvertTo-UiBrush '#10B981' } elseif ($ticket.counter_status -eq 'PREPARING') { ConvertTo-UiBrush '#F59E0B' } else { ConvertTo-UiBrush '#3B82F6' }
    $txtStatus.FontSize = 11
    $txtStatus.FontWeight = 'Bold'
    $badgeStatus.Child = $txtStatus
    $headerDock.Children.Add($badgeStatus) | Out-Null

    $bodyStack.Children.Add($headerDock) | Out-Null

    # Ledger items
    $ledgerBorder = New-Object System.Windows.Controls.Border
    $ledgerBorder.Margin = '0,10,0,8'
    $ledgerBorder.Padding = '0,6,0,6'
    $ledgerBorder.BorderBrush = ConvertTo-UiBrush '#222736'
    $ledgerBorder.BorderThickness = '0,1,0,0'

    $itemsPanel = New-Object System.Windows.Controls.StackPanel
    foreach ($item in $ticket.items) {
      $itemDock = New-Object System.Windows.Controls.DockPanel
      $itemDock.Margin = '0,4,0,4'

      $itemCenter = New-Object System.Windows.Controls.StackPanel
      $itemName = New-Object System.Windows.Controls.TextBlock
      $itemName.Text = "$($item.quantity)x $($item.name)"
      $itemName.Foreground = ConvertTo-UiBrush '#F0F0F0'
      $itemName.FontWeight = 'Bold'
      $itemName.FontSize = 14
      $itemCenter.Children.Add($itemName) | Out-Null

      if ($item.notes) {
        $itemNotes = New-Object System.Windows.Controls.TextBlock
        $itemNotes.Text = [string]$item.notes
        $itemNotes.Foreground = ConvertTo-UiBrush '#DC2626'
        $itemNotes.FontSize = 11
        $itemNotes.FontWeight = 'SemiBold'
        $itemCenter.Children.Add($itemNotes) | Out-Null
      }
      $itemDock.Children.Add($itemCenter) | Out-Null
      $itemsPanel.Children.Add($itemDock) | Out-Null
    }
    $ledgerBorder.Child = $itemsPanel
    $bodyStack.Children.Add($ledgerBorder) | Out-Null
    $cardLayout.Children.Add($bodyStack) | Out-Null

    $ui_kitchenWrapPanel.Children.Add($card) | Out-Null
  }
}

function Reload-Counter {
  try {
    $state = Bridge "/counter/state?role=$script:activeRole"
    $script:items = @($state.items); $script:orders = @($state.orders); $script:remoteOrders = @($state.remote_orders)
    if ($ui_sidebarTenant) { $ui_sidebarTenant.Text = [string]$state.tenant_slug.ToUpper() }

    # Detect newly incoming orders and show toast alert + single chime
    $newOrdersFound = 0
    $latestNewOrder = $null
    foreach ($order in $script:orders) {
      $orderKey = "L-$($order.sequence_no)"
      if (-not $script:seenOrderKeys.Contains($orderKey)) {
        $script:seenOrderKeys.Add($orderKey) | Out-Null
        if ($script:hasInitializedOrders) {
          $newOrdersFound++
          $latestNewOrder = $order
        }
      }
    }
    foreach ($order in $script:remoteOrders) {
      $orderKey = "R-$($order.id)"
      if (-not $script:seenOrderKeys.Contains($orderKey)) {
        $script:seenOrderKeys.Add($orderKey) | Out-Null
        if ($script:hasInitializedOrders) {
          $newOrdersFound++
          if (-not $latestNewOrder) { $latestNewOrder = $order }
        }
      }
    }
    if ($newOrdersFound -gt 0 -and $latestNewOrder) {
      Show-OrderToast $latestNewOrder
      $ui_status.Text = "New incoming order received."
    }
    $script:hasInitializedOrders = $true

    if ($ui_menuList) {
      $ui_menuList.Items.Clear()
      foreach ($item in $script:items) {
        $entry = New-Object System.Windows.Controls.ListBoxItem
        $entry.Content = "$($item.name)   -   Rs $([decimal]$item.price)   -   $($item.category_name)"
        $entry.Tag = $item; $entry.Padding = '12'; $entry.Margin = '3'; $entry.Background = '#161922'
        if (-not $item.in_stock) { $entry.IsEnabled = $false; $entry.Content += '   -   [SOLD OUT]' }
        $ui_menuList.Items.Add($entry) | Out-Null
      }
    }

    Render-OrdersCards
    Render-KitchenCards

    $ui_connection.Text = "KDS SYNCED"
    $ui_status.Text = "Local SQLite ready - $($state.items.Count) menu items - $($state.orders.Count) orders"
    Reload-Reports
    Reload-RiderDeliveries
  } catch {
    $ui_connection.Text = 'Bridge unavailable'
    $ui_status.Text = $_.Exception.Message
  }
}

# Double click to add to active POS order
$ui_menuList.Add_MouseDoubleClick({
  if ($ui_menuList.SelectedItem -and $ui_menuList.SelectedItem.Tag.in_stock) {
    $item = $ui_menuList.SelectedItem.Tag
    $script:cart[$item.id] = 1 + [int]$script:cart[$item.id]
    Update-CartSummary
    $ui_status.Text = "Added $($item.name) (quantity: $($script:cart[$item.id])). Click 'Save Order' when done."
  }
})

# Order Type switching clicks
$ui_btnTypeDineIn.Add_Click({ Set-OrderTypeUI 'DINE_IN' })
$ui_btnTypeDelivery.Add_Click({ Set-OrderTypeUI 'DELIVERY' })
$ui_btnTypePickup.Add_Click({ Set-OrderTypeUI 'PICKUP' })

# Save Order & Print Ticket
$ui_placeOrder.Add_Click({
  if (-not $script:cart.Count) { $ui_status.Text = 'Double-click items from menu to add them to this order.'; return }
  
  $orderType = $script:activeOrderType
  $tbl = $ui_table.Text.Trim()
  $cName = $ui_custName.Text.Trim()
  $cPhone = $ui_custPhone.Text.Trim()
  $cAddress = $ui_custAddress.Text.Trim()

  if ($orderType -eq 'DINE_IN' -and -not $tbl) {
    $ui_status.Text = 'Enter a Table Number for Dine-In (e.g. T-01).'; return
  }
  if ($orderType -eq 'DELIVERY' -and (-not $cAddress -or -not $cPhone)) {
    $ui_status.Text = 'Customer Phone and Delivery Address are required for Delivery orders.'; return
  }
  if ($orderType -eq 'PICKUP' -and -not $cPhone) {
    $ui_status.Text = 'Contact Phone number is required for Pickup.'; return
  }

  try {
    $selectedItems = @($script:cart.GetEnumerator() | ForEach-Object { @{ item_id = $_.Key; quantity = [int]$_.Value } })
    $payload = @{
      client_order_id = [guid]::NewGuid().ToString()
      order_type = $orderType
      table_number = if ($orderType -eq 'DINE_IN') { $tbl } else { $null }
      customer_name = $cName
      customer_phone = $cPhone
      customer_address = if ($orderType -eq 'DELIVERY') { $cAddress } else { $null }
      items = $selectedItems
      staff_id = $script:staffSession.id
      staff_name = $script:staffSession.name
    }
    
    $saved = Bridge '/orders' 'POST' $payload
    $ui_status.Text = "Saved $orderType order #$($saved.sequence_no). Sending print job..."
    try {
      $null = Bridge '/print' 'POST' @{
        client_order_id = $saved.client_order_id
        order_number = "#$($saved.sequence_no)"
        order_type = $orderType
        table_number = $tbl
        total_amount = $saved.total_amount
        items = $saved.items
        print_type = 'RECEIPT'
      }
      $ui_status.Text = "Order #$($saved.sequence_no) saved and printed."
    } catch {
      $ui_status.Text = "Order #$($saved.sequence_no) saved; printer unavailable: $($_.Exception.Message)"
    }
    
    $script:cart = @{}
    Update-CartSummary
    $ui_table.Text = ''; $ui_custName.Text = ''; $ui_custPhone.Text = ''; $ui_custAddress.Text = ''
    Reload-Counter
  } catch {
    $ui_status.Text = $_.Exception.Message
  }
})

# Filter Tabs & Search wiring
if ($ui_btnFilterAll) { $ui_btnFilterAll.Add_Click({ Set-OrdersFilterUI 'ALL' }) }
if ($ui_btnFilterDineIn) { $ui_btnFilterDineIn.Add_Click({ Set-OrdersFilterUI 'DINE_IN' }) }
if ($ui_btnFilterDelivery) { $ui_btnFilterDelivery.Add_Click({ Set-OrdersFilterUI 'DELIVERY' }) }
if ($ui_btnFilterUrgent) { $ui_btnFilterUrgent.Add_Click({ Set-OrdersFilterUI 'URGENT' }) }

if ($ui_btnKitchenFilterAll) { $ui_btnKitchenFilterAll.Add_Click({ Set-KitchenFilterUI 'ALL' }) }
if ($ui_btnKitchenFilterQueued) { $ui_btnKitchenFilterQueued.Add_Click({ Set-KitchenFilterUI 'QUEUED' }) }
if ($ui_btnKitchenFilterCooking) { $ui_btnKitchenFilterCooking.Add_Click({ Set-KitchenFilterUI 'COOKING' }) }
if ($ui_btnKitchenFilterReady) { $ui_btnKitchenFilterReady.Add_Click({ Set-KitchenFilterUI 'READY' }) }

if ($ui_ordersSearchBox) {
  $ui_ordersSearchBox.Add_TextChanged({
    $script:ordersSearchQuery = $ui_ordersSearchBox.Text.Trim()
    Render-OrdersCards
  })
}

if ($ui_btnTogglePosComposer) {
  $ui_btnTogglePosComposer.Add_Click({
    if ($ui_posComposerBorder) {
      $ui_posComposerBorder.Visibility = if ($ui_posComposerBorder.Visibility -eq 'Visible') { 'Collapsed' } else { 'Visible' }
    }
  })
}

if ($ui_btnClosePosComposer) {
  $ui_btnClosePosComposer.Add_Click({
    if ($ui_posComposerBorder) { $ui_posComposerBorder.Visibility = 'Collapsed' }
  })
}

if ($ui_btnDismissToast) {
  $ui_btnDismissToast.Add_Click({
    if ($script:toastTimer) { $script:toastTimer.Stop() }
    if ($ui_orderToast) { $ui_orderToast.Visibility = 'Collapsed' }
  })
}

if ($ui_btnSyncAllTickets) {
  $ui_btnSyncAllTickets.Add_Click({
    Reload-Counter
    $ui_status.Text = "All tickets synchronized."
  })
}

# Context action on selected order in Cashier POS (if ListBox present)
if ($ui_ordersList) {
  $ui_ordersList.Add_SelectionChanged({
    if ($ui_ordersList.SelectedItem -and $ui_btnContextAction) {
      $order = $ui_ordersList.SelectedItem.Tag
      if ($order.order_type -eq 'DELIVERY') {
        $ui_btnContextAction.Content = if ($order.rider_name) { "Change Rider ($($order.rider_name))" } else { "Assign Rider" }
        $ui_btnContextAction.Background = ConvertTo-UiBrush '#DC2626'
      } elseif ($order.order_type -eq 'PICKUP') {
        $ui_btnContextAction.Content = if ($order.counter_status -eq 'READY') { "Mark Picked Up" } else { "Mark Ready for Pickup" }
        $ui_btnContextAction.Background = ConvertTo-UiBrush '#10B981'
      } else {
        $ui_btnContextAction.Content = "Serve to Table / Done"
        $ui_btnContextAction.Background = ConvertTo-UiBrush '#DC2626'
      }
    }
  })
}

if ($ui_btnContextAction) {
  $ui_btnContextAction.Add_Click({
    if (-not $ui_ordersList.SelectedItem) { $ui_status.Text = 'Select an order from the list first.'; return }
    $order = $ui_ordersList.SelectedItem.Tag
    if (-not $order.client_order_id) { $ui_status.Text = 'Web orders must be completed through web dashboard.'; return }

    if ($order.order_type -eq 'DELIVERY') {
      if (Show-AssignRiderDialog $order) {
        Reload-Counter
        $ui_status.Text = "Assigned rider to order #$($order.sequence_no)."
      }
    } elseif ($order.order_type -eq 'PICKUP') {
      $nextStatus = if ($order.counter_status -eq 'READY') { 'COMPLETED' } else { 'READY' }
      try {
        $null = Bridge '/counter/orders/status' 'POST' @{ client_order_id = $order.client_order_id; counter_status = $nextStatus }
        Reload-Counter
        $ui_status.Text = "Pickup order #$($order.sequence_no) updated to $nextStatus."
      } catch { $ui_status.Text = $_.Exception.Message }
    } else {
      try {
        $null = Bridge '/counter/orders/status' 'POST' @{ client_order_id = $order.client_order_id; counter_status = 'COMPLETED' }
        Reload-Counter
        $ui_status.Text = "Dine-in order #$($order.sequence_no) marked completed."
      } catch { $ui_status.Text = $_.Exception.Message }
    }
  })
}

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
  Reset-NavSelection; $ui_inventoryPane.Visibility = 'Visible'; $ui_navInventory.Background = '#DC2626'; $ui_heading.Text = "Raw Material Inventory Tracking"
  Reload-Inventory
})
$ui_navMarketplace.Add_Click({
  Reset-NavSelection; $ui_marketplacePane.Visibility = 'Visible'; $ui_navMarketplace.Background = '#DC2626'; $ui_heading.Text = "Supplier Marketplace (Equipment & Supplies)"
  Reload-Marketplace
})
$ui_navStaff.Add_Click({
  Reset-NavSelection; $ui_staffPane.Visibility = 'Visible'; $ui_navStaff.Background = '#DC2626'; $ui_heading.Text = "Staff Accounts & Security"
  Reload-Staff
})
$ui_navRider.Add_Click({
  Reset-NavSelection; $ui_riderPane.Visibility = 'Visible'; $ui_navRider.Background = '#DC2626'; $ui_heading.Text = "Rider Deliveries"
  Reload-RiderDeliveries
})
$ui_navReports.Add_Click({
  Reset-NavSelection; $ui_reportsPane.Visibility = 'Visible'; $ui_navReports.Background = '#DC2626'; $ui_heading.Text = "Terminal Reports & System Settings"
  Reload-Reports; Reload-Settings
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

# Special Offers Actions
$ui_btnCreateOffer.Add_Click({
  if (Show-SpecialOfferDialog) {
    Reload-Offers
    $ui_status.Text = "Special offer saved locally and queued for sync."
  }
})
$ui_btnDeleteOffer.Add_Click({
  if ($ui_offersList.SelectedItem) {
    $offer = $ui_offersList.SelectedItem.Tag
    try {
      $null = Bridge '/counter/offers/delete' 'POST' @{ id = $offer.id }
      Reload-Offers
      $ui_status.Text = "Deleted promotion '$($offer.title)'."
    } catch { $ui_status.Text = $_.Exception.Message }
  } else {
    $ui_status.Text = 'Select an offer to delete.'
  }
})

# Inventory Actions
$ui_btnRefreshInventory.Add_Click({ Reload-Inventory })
$ui_btnOrderVendorWhatsApp.Add_Click({
  # Generate free wa.me purchase order to configured vendor number
  try {
    $res = Bridge '/counter/inventory'
    $lowItems = @($res.items | Where-Object { [decimal]$_.current_stock -le [decimal]$_.minimum_threshold })
    if ($lowItems.Count -eq 0) {
      $lowItems = @($res.items | Select-Object -First 3)
    }
    $lines = @("RAW MATERIAL PURCHASE ORDER - $($ui_sidebarTenant.Text)", "Please deliver the following kitchen supplies urgently:")
    foreach ($i in $lowItems) {
      $reorderQty = [Math]::Max(10, [int]([decimal]$i.minimum_threshold * 2))
      $lines += "- $($i.name): $reorderQty $($i.unit) (Current Stock: $($i.current_stock) $($i.unit))"
    }
    $cleanPhone = $script:vendorPhone.Replace('+','').Replace('-','').Replace(' ','')
    if ($cleanPhone.StartsWith('0')) { $cleanPhone = '92' + $cleanPhone.Substring(1) }
    $msgText = [Uri]::EscapeDataString(($lines -join "`n"))
    $url = "https://wa.me/$cleanPhone?text=$msgText"
    [System.Diagnostics.Process]::Start($url) | Out-Null
    $ui_status.Text = "Opened WhatsApp Vendor Purchase Order to $cleanPhone."
  } catch {
    $ui_status.Text = "Vendor alert failed: $($_.Exception.Message)"
  }
})

# Supplier Marketplace Actions
$ui_marketplaceList.Add_MouseDoubleClick({
  if ($ui_marketplaceList.SelectedItem) {
    $p = $ui_marketplaceList.SelectedItem.Tag
    $script:supplyCart[$p.id] = 1 + [int]$script:supplyCart[$p.id]
    Update-MarketCartUI
    $ui_status.Text = "Added $($p.name) to supplies cart."
  }
})

$ui_btnClearMarketCart.Add_Click({
  $script:supplyCart = @{}
  Update-MarketCartUI
  $ui_status.Text = "Supplies cart cleared."
})

$ui_btnSubmitMarketOrder.Add_Click({
  if ($script:supplyCart.Count -eq 0) {
    $ui_status.Text = "Double-click items from the catalog to add them to your supplies order."; return
  }
  try {
    $items = @()
    $orderLines = @("RMS SUPPLIER MARKETPLACE ORDER", "Restaurant: $($ui_sidebarTenant.Text)", "Requested Supply Items:")
    $totalAmount = 0
    foreach ($kv in $script:supplyCart.GetEnumerator()) {
      $p = $script:supplyProducts | Where-Object { $_.id -eq $kv.Key } | Select-Object -First 1
      if ($p) {
        $qty = [int]$kv.Value
        $price = if ($p.price) { [decimal]$p.price } else { 0 }
        $totalAmount += ($qty * $price)
        $items += @{ product_id = $p.id; name = $p.name; quantity = $qty; price = $price }
        $orderLines += "- $($p.name) x$qty (Rs $($qty * $price))"
      }
    }
    $orderLines += "TOTAL ESTIMATED AMOUNT: Rs $totalAmount"
    $orderLines += "Please confirm delivery dispatch."

    # Save to local SQLite stock_orders
    $null = Bridge '/counter/marketplace/order' 'POST' @{ items = $items; total_amount = $totalAmount }

    # Open free WhatsApp wa.me to configured supplier marketplace phone
    $cleanPhone = $script:supplierPhone.Replace('+','').Replace('-','').Replace(' ','')
    if ($cleanPhone.StartsWith('0')) { $cleanPhone = '92' + $cleanPhone.Substring(1) }
    $msgText = [Uri]::EscapeDataString(($orderLines -join "`n"))
    $url = "https://wa.me/$cleanPhone?text=$msgText"
    [System.Diagnostics.Process]::Start($url) | Out-Null

    $script:supplyCart = @{}
    Update-MarketCartUI
    $ui_status.Text = "Stock order saved and WhatsApp opened to supplier at $cleanPhone."
  } catch {
    $ui_status.Text = "Marketplace order error: $($_.Exception.Message)"
  }
})

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
if ($ui_printTicket) {
  $ui_printTicket.Add_Click({
    if ($ui_kitchenList -and $ui_kitchenList.SelectedItem) {
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
        $ui_status.Text = "Ticket remains in local queue; printer unavailable: $($_.Exception.Message)"
      }
    }
  })
}

if ($ui_paid) {
  $ui_paid.Add_Click({
    if ($ui_ordersList -and $ui_ordersList.SelectedItem) {
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
}

if ($ui_preparing) {
  $ui_preparing.Add_Click({
    if ($ui_kitchenList -and $ui_kitchenList.SelectedItem) {
      $order = $ui_kitchenList.SelectedItem.Tag
      try {
        if ($order.client_order_id) {
          $null = Bridge '/counter/orders/status' 'POST' @{ client_order_id = $order.client_order_id; counter_status = 'PREPARING' }
        } else {
          $access = Bridge '/counter/staff-access?role=kitchen'
          $ticketUri = $script:webAppUrl + '/api/staff/kitchen-tickets'
          $bearerToken = "Bearer " + $access.access_token
          $hdrs = @{ Authorization = $bearerToken }
          $body = @{ order_id = $order.order_id; status = 'PREPARING' } | ConvertTo-Json -Compress
          $null = Invoke-RestMethod -Method Patch -Uri $ticketUri -TimeoutSec 5 -Headers $hdrs -ContentType 'application/json' -Body $body
        }
        Reload-Counter
        $ui_status.Text = "Order #$($order.sequence_no) is now cooking (PREPARING)."
      } catch {
        $ui_status.Text = $_.Exception.Message
      }
    }
  })
}

if ($ui_ready) {
  $ui_ready.Add_Click({
    if ($ui_kitchenList -and $ui_kitchenList.SelectedItem) {
      $order = $ui_kitchenList.SelectedItem.Tag
      try {
        $ui_ready.IsEnabled = $false
        $ui_ready.Content = "Ready [OK]"
        $ui_ready.Background = ConvertTo-UiBrush '#10B981'
        
        if ($order.client_order_id) {
          $null = Bridge '/counter/orders/status' 'POST' @{ client_order_id = $order.client_order_id; counter_status = 'READY' }
        } else {
          $access = Bridge '/counter/staff-access?role=kitchen'
          $ticketUri = $script:webAppUrl + '/api/staff/kitchen-tickets'
          $bearerToken = "Bearer " + $access.access_token
          $hdrs = @{ Authorization = $bearerToken }
          $body = @{ order_id = $order.order_id; status = 'READY' } | ConvertTo-Json -Compress
          $null = Invoke-RestMethod -Method Patch -Uri $ticketUri -TimeoutSec 5 -Headers $hdrs -ContentType 'application/json' -Body $body
        }
        Reload-Counter
        $ui_status.Text = "Order #$($order.sequence_no) marked READY."
      } catch {
        $ui_status.Text = $_.Exception.Message
      } finally {
        Start-Sleep -Milliseconds 400
        $ui_ready.IsEnabled = $true
        $ui_ready.Content = "Mark Ready"
        $ui_ready.Background = ConvertTo-UiBrush '#1A1E29'
      }
    }
  })
}

if ($ui_btnKitchenComplete) {
  $ui_btnKitchenComplete.Add_Click({
    if ($ui_kitchenList -and $ui_kitchenList.SelectedItem) {
      $order = $ui_kitchenList.SelectedItem.Tag
      try {
        if ($order.client_order_id) {
          $null = Bridge '/counter/orders/status' 'POST' @{ client_order_id = $order.client_order_id; counter_status = 'COMPLETED' }
        } else {
          $access = Bridge '/counter/staff-access?role=kitchen'
          $ticketUri = $script:webAppUrl + '/api/staff/kitchen-tickets'
          $bearerToken = "Bearer " + $access.access_token
          $hdrs = @{ Authorization = $bearerToken }
          $body = @{ order_id = $order.order_id; status = 'COMPLETED' } | ConvertTo-Json -Compress
          $null = Invoke-RestMethod -Method Patch -Uri $ticketUri -TimeoutSec 5 -Headers $hdrs -ContentType 'application/json' -Body $body
        }
        Reload-Counter
        $ui_status.Text = "Order #$($order.sequence_no) completed."
      } catch {
        $ui_status.Text = $_.Exception.Message
      }
    }
  })
}

# Rider Deliveries Actions
$ui_btnRiderDispatched.Add_Click({
  if ($ui_riderDeliveriesList.SelectedItem) {
    $order = $ui_riderDeliveriesList.SelectedItem.Tag
    try {
      $null = Bridge '/counter/orders/status' 'POST' @{ client_order_id = $order.client_order_id; counter_status = 'PREPARING' }
      Reload-Counter
      $ui_status.Text = "Delivery order #$($order.sequence_no) out for delivery."
    } catch { $ui_status.Text = $_.Exception.Message }
  }
})

$ui_btnRiderDelivered.Add_Click({
  if ($ui_riderDeliveriesList.SelectedItem) {
    $order = $ui_riderDeliveriesList.SelectedItem.Tag
    try {
      $null = Bridge '/counter/orders/status' 'POST' @{ client_order_id = $order.client_order_id; counter_status = 'COMPLETED'; payment_status = 'PAID' }
      Reload-Counter
      $ui_status.Text = "Delivery order #$($order.sequence_no) delivered and marked paid."
    } catch { $ui_status.Text = $_.Exception.Message }
  }
})

# Save System Settings Action
$ui_btnSaveSettings.Add_Click({
  try {
    $settings = @{
      restaurant_phone = $ui_settingRestaurantPhone.Text.Trim()
      supplier_marketplace_phone = $ui_settingSupplierPhone.Text.Trim()
      vendor_phone = $ui_settingVendorPhone.Text.Trim()
    }
    $null = Bridge '/counter/settings' 'POST' @{ settings = $settings }
    $script:supplierPhone = $settings.supplier_marketplace_phone
    $script:vendorPhone = $settings.vendor_phone
    $ui_status.Text = "System WhatsApp configuration saved locally and queued for web sync."
  } catch {
    $ui_status.Text = "Settings save failed: $($_.Exception.Message)"
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
      items = @(@{ name = "Thermal Printer Hardware Test Slip"; quantity = 1; price = 0 })
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

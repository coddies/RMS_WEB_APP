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
  $serviceConfig = Join-Path $installRoot '.env'
  try {
    if (Test-Path -LiteralPath $serviceConfig) {
      $tokenLine = Get-Content -LiteralPath $serviceConfig -ErrorAction Stop | Where-Object { $_ -match '^BRIDGE_TOKEN=(.{32,})$' } | Select-Object -First 1
      if ($tokenLine -match '^BRIDGE_TOKEN=(.{32,})$') {
        $saved = $Matches[1]
        Save-LocalToken $saved
        return $saved
      }
    }
  } catch { }
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
  Invoke-RestMethod @params
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
  $dialog.Title = 'Connect to local-bridge'; $dialog.Width = 500; $dialog.Height = 210; $dialog.WindowStartupLocation = 'CenterScreen'; $dialog.ResizeMode = 'NoResize'; $dialog.Background = '#0D0D0D'; $dialog.Foreground = '#F0F0F0'
  Set-AppWindowIcon $dialog
  $stack = New-Object System.Windows.Controls.StackPanel; $stack.Margin = '22'
  $label = New-Object System.Windows.Controls.TextBlock; $label.Text = 'Local Counter connection token'; $label.Margin = '0,0,0,8'; $stack.Children.Add($label) | Out-Null
  $tokenBox = New-Object System.Windows.Controls.PasswordBox; $tokenBox.Height = 44; $tokenBox.Padding = '10'; $stack.Children.Add($tokenBox) | Out-Null
  $hint = New-Object System.Windows.Controls.TextBlock; $hint.Text = 'Enter the token shown after the bridge installer pairs this PC.'; $hint.Foreground = '#8B949E'; $hint.Margin = '0,8,0,14'; $stack.Children.Add($hint) | Out-Null
  $button = New-Object System.Windows.Controls.Button; $button.Content = 'Connect'; $button.Height = 46; $button.Background = '#DC2626'; $button.Foreground = 'White'; $button.BorderThickness = '0'; $button.IsDefault = $true
  $button.Add_Click(({
    if ($tokenBox.SecurePassword.Length -ge 32) {
      Save-LocalToken ([Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($tokenBox.SecurePassword)))
      $dialog.DialogResult = $true; $dialog.Close()
    } else { $hint.Text = 'The token must contain at least 32 characters.' }
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

function Show-StaffLogin {
  # Check bootstrap status first
  try {
    $bootstrap = Bridge '/counter/auth/bootstrap-status'
    if ($bootstrap.needs_bootstrap) {
      if (-not (Show-AdminBootstrap)) { return $null }
    }
  } catch { }

  $cached = Read-StaffSession
  $dialog = New-Object System.Windows.Window
  $dialog.Title = 'RMS Counter sign in'; $dialog.Width = 500; $dialog.Height = 540; $dialog.WindowStartupLocation = 'CenterScreen'; $dialog.ResizeMode = 'NoResize'; $dialog.Background = '#0D0D0D'; $dialog.Foreground = '#F0F0F0'
  Set-AppWindowIcon $dialog
  $stack = New-Object System.Windows.Controls.StackPanel; $stack.Margin = '24'
  $counterState = Bridge '/counter/state'
  $tenantLabel = New-Object System.Windows.Controls.TextBlock; $tenantLabel.Text = "Restaurant: $($counterState.tenant_slug)"; $tenantLabel.Foreground = '#8B949E'; $tenantLabel.Margin = '0,0,0,16'; $stack.Children.Add($tenantLabel) | Out-Null
  $roleLabel = New-Object System.Windows.Controls.TextBlock; $roleLabel.Text = 'Role'; $roleLabel.Foreground = ConvertTo-UiBrush '#B7BEC9'; $roleLabel.Margin = '0,0,0,5'; $stack.Children.Add($roleLabel)|Out-Null
  
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
  $identity = New-Object System.Windows.Controls.TextBox; $identity.Text = if($cached){[string]$cached.username}else{''}; $identity.Height = 46; $identity.Padding = '10'; $identity.Margin = '0,0,0,10'; $identity.ToolTip = 'The active staff username for this restaurant'; Set-LoginFieldTheme $identity; $stack.Children.Add($identity)|Out-Null
  $identityHint = New-Object System.Windows.Controls.TextBlock; $identityHint.Text = 'Enter your assigned staff username.'; $identityHint.Foreground = ConvertTo-UiBrush '#8B949E'; $identityHint.FontSize = 12; $identityHint.Margin = '0,-5,0,10'; $stack.Children.Add($identityHint)|Out-Null

  $pinLabel = New-Object System.Windows.Controls.TextBlock; $pinLabel.Text = 'PIN'; $pinLabel.Foreground = ConvertTo-UiBrush '#B7BEC9'; $pinLabel.Margin = '0,0,0,5'; $stack.Children.Add($pinLabel)|Out-Null
  $pin = New-Object System.Windows.Controls.PasswordBox; $pin.Height = 46; $pin.Padding = '10'; $pin.Margin = '0,0,0,10'; $pin.ToolTip = 'Your staff PIN'; Set-LoginFieldTheme $pin; $stack.Children.Add($pin)|Out-Null

  $hint = New-Object System.Windows.Controls.TextBlock; $hint.Text = '100% Local Authentication · Works completely offline'; $hint.TextWrapping = 'Wrap'; $hint.Foreground = '#10B981'; $hint.Margin = '0,0,0,16'; $stack.Children.Add($hint)|Out-Null

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

$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Title="RMS Counter" Width="1180" Height="780" MinWidth="960" MinHeight="640" WindowStartupLocation="CenterScreen" Background="#0D0D0D" Foreground="#F0F0F0" FontFamily="Segoe UI">
 <Grid Margin="24"><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
  <DockPanel Grid.Row="0" Margin="0,0,0,18"><StackPanel><TextBlock Text="RESTAURANT OPERATIONS" Foreground="#8B949E" FontSize="12" FontWeight="Bold"/><TextBlock Name="heading" Text="Counter" FontSize="30" FontWeight="Bold"/></StackPanel><StackPanel DockPanel.Dock="Right" Orientation="Horizontal" VerticalAlignment="Center"><Border Background="#161B22" CornerRadius="18" Padding="14,9" Margin="0,0,10,0"><TextBlock Name="connection" Text="Local" Foreground="#10B981" FontWeight="Bold"/></Border><Button Name="refresh" Content="Refresh" MinWidth="100" Height="48" Background="#1E1E24" Foreground="#F0F0F0" BorderBrush="#343943"/></StackPanel></DockPanel>
  <Grid Grid.Row="1"><Grid.ColumnDefinitions><ColumnDefinition Width="210"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
   <StackPanel Grid.Column="0" Margin="0,0,18,0" Background="#121212">
     <TextBlock Text="COUNTER" Foreground="#8B949E" FontSize="12" FontWeight="Bold" Margin="14,12,0,14"/>
     <Button Name="navCashier" Content="Orders" Height="50" Margin="8,0,8,6" HorizontalContentAlignment="Left" Padding="14,0" Background="#DC2626" Foreground="White" BorderThickness="0"/>
     <Button Name="navKitchen" Content="Kitchen" Height="50" Margin="8,0,8,6" HorizontalContentAlignment="Left" Padding="14,0" Background="#161B22" Foreground="#F0F0F0" BorderBrush="#2B3038"/>
     <Button Name="navStaff" Content="Staff" Height="50" Margin="8,0,8,6" HorizontalContentAlignment="Left" Padding="14,0" Background="#161B22" Foreground="#F0F0F0" BorderBrush="#2B3038"/>
   </StackPanel>
   <Grid Grid.Column="1">
    <Grid Name="cashierPane" Margin="4,10,0,0"><Grid.ColumnDefinitions><ColumnDefinition Width="1.2*"/><ColumnDefinition Width="0.8*"/></Grid.ColumnDefinitions>
     <DockPanel Grid.Column="0" Margin="0,0,16,0"><TextBlock DockPanel.Dock="Top" Text="Cached menu · double-click to add quantity" Foreground="#8B949E" Margin="0,0,0,12"/><ListBox Name="menuList" Background="#161B22" Foreground="#F0F0F0" BorderBrush="#2B3038"/></DockPanel>
     <DockPanel Grid.Column="1"><StackPanel DockPanel.Dock="Top"><TextBlock Text="Table number" Foreground="#8B949E"/><TextBox Name="table" Height="48" Margin="0,6,0,14" Padding="10" Background="#161B22" Foreground="#F0F0F0" BorderBrush="#343943"/><TextBlock Text="Current local orders" Foreground="#8B949E" Margin="0,0,0,8"/></StackPanel><ListBox Name="ordersList" Background="#161B22" Foreground="#F0F0F0" BorderBrush="#2B3038"/><StackPanel DockPanel.Dock="Bottom"><Button Name="placeOrder" Content="Save order &amp; print" Height="50" Margin="0,10,0,6" Background="#DC2626" Foreground="White" BorderThickness="0"/><Button Name="paid" Content="Mark selected order paid" Height="48" Background="#1E1E24" Foreground="#F0F0F0" BorderBrush="#343943"/></StackPanel></DockPanel>
    </Grid>
    <DockPanel Name="kitchenPane" Margin="4,10,0,0" Visibility="Collapsed">
      <TextBlock DockPanel.Dock="Top" Text="Kitchen tickets · newest first" Foreground="#8B949E" Margin="0,0,0,12"/>
      <ListBox Name="kitchenList" Background="#161B22" Foreground="#F0F0F0" BorderBrush="#2B3038"/>
      <StackPanel DockPanel.Dock="Bottom" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,12,0,0"><Button Name="printTicket" Content="Print KOT" Height="48" MinWidth="120" Margin="0,0,8,0" Background="#1E1E24" Foreground="#F0F0F0"/><Button Name="preparing" Content="Start preparing" Height="48" MinWidth="150" Margin="0,0,8,0" Background="#1E1E24" Foreground="#F0F0F0"/><Button Name="ready" Content="Mark ready" Height="48" MinWidth="120" Background="#DC2626" Foreground="White" BorderThickness="0"/></StackPanel>
    </DockPanel>
    <DockPanel Name="staffPane" Margin="4,10,0,0" Visibility="Collapsed">
      <TextBlock DockPanel.Dock="Top" Text="Restaurant staff accounts · local SQLite + Supabase backup" Foreground="#8B949E" Margin="0,0,0,12"/>
      <ListBox Name="staffList" Background="#161B22" Foreground="#F0F0F0" BorderBrush="#2B3038"/>
      <StackPanel DockPanel.Dock="Bottom" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,12,0,0">
        <Button Name="addStaff" Content="Add Staff" Height="48" MinWidth="130" Margin="0,0,8,0" Background="#DC2626" Foreground="White" BorderThickness="0"/>
        <Button Name="resetPin" Content="Edit / PIN" Height="48" MinWidth="130" Margin="0,0,8,0" Background="#1E1E24" Foreground="#F0F0F0" BorderBrush="#343943"/>
        <Button Name="deactivateStaff" Content="Deactivate" Height="48" MinWidth="130" Background="#1E1E24" Foreground="#EF4444" BorderBrush="#343943"/>
      </StackPanel>
    </DockPanel>
   </Grid>
  </Grid>
  <TextBlock Name="status" Grid.Row="2" Text="Ready" Foreground="#8B949E" Margin="0,14,0,0" TextWrapping="Wrap"/>
 </Grid>
</Window>
'@

if (-not ($script:token = Read-LocalToken)) {
  [System.Windows.MessageBox]::Show('The existing local bridge credential could not be read. Repair the local bridge installation and reopen RMS Counter. A second key is not required.', 'RMS Counter setup', 'OK', 'Error') | Out-Null
  exit
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
foreach ($name in 'menuList','ordersList','kitchenList','staffList','table','placeOrder','paid','printTicket','preparing','ready','addStaff','resetPin','deactivateStaff','refresh','status','connection','heading','cashierPane','kitchenPane','staffPane','navCashier','navKitchen','navStaff') { Set-Variable -Scope Script -Name "ui_$name" -Value $window.FindName($name) }

$script:activeRole = [string]$script:staffSession.role
$ui_heading.Text = "Welcome, $($script:staffSession.name)"

if ($script:activeRole -eq 'cashier') {
  $ui_navKitchen.Visibility = 'Collapsed'; $ui_navStaff.Visibility = 'Collapsed'
  $ui_cashierPane.Visibility = 'Visible'; $ui_kitchenPane.Visibility = 'Collapsed'; $ui_staffPane.Visibility = 'Collapsed'
} elseif ($script:activeRole -eq 'kitchen') {
  $ui_navCashier.Visibility = 'Collapsed'; $ui_navStaff.Visibility = 'Collapsed'
  $ui_cashierPane.Visibility = 'Collapsed'; $ui_kitchenPane.Visibility = 'Visible'; $ui_staffPane.Visibility = 'Collapsed'
} else {
  # admin / manager - sees all navigation
  $ui_navCashier.Visibility = 'Visible'; $ui_navKitchen.Visibility = 'Visible'; $ui_navStaff.Visibility = 'Visible'
  $ui_cashierPane.Visibility = 'Visible'; $ui_kitchenPane.Visibility = 'Collapsed'; $ui_staffPane.Visibility = 'Collapsed'
}

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
      $entry.Background = if ($member.active) { '#1E1E24' } else { '#2D1517' }
      $ui_staffList.Items.Add($entry) | Out-Null
    }
  } catch {
    $ui_status.Text = "Staff list error: $($_.Exception.Message)"
  }
}

function Reload-Counter {
  try {
    $state = Bridge "/counter/state?role=$script:activeRole"; $script:items = @($state.items); $script:orders = @($state.orders); $script:remoteOrders = @($state.remote_orders)
    $ui_menuList.Items.Clear()
    foreach ($item in $script:items) { $entry = New-Object System.Windows.Controls.ListBoxItem; $entry.Content = "$($item.name)   ·   Rs $([decimal]$item.price)   ·   $($item.category_name)"; $entry.Tag = $item; $entry.Padding = '14'; $entry.Margin = '4'; $entry.Background = '#1E1E24'; if (-not $item.in_stock) { $entry.IsEnabled = $false; $entry.Content += '   ·   SOLD OUT' }; $ui_menuList.Items.Add($entry) | Out-Null }
    $ui_ordersList.Items.Clear(); $ui_kitchenList.Items.Clear()
    foreach ($order in $script:orders) {
      $itemsText = ($order.items | ForEach-Object { "$($_.name) × $($_.quantity)" }) -join ', '
      $staffInfo = if ($order.staff_name) { " · Staff: $($order.staff_name)" } else { '' }
      $line = "#$($order.sequence_no) · Table $($order.table_number) · Rs $($order.total_amount) · $($order.counter_status) · Payment $($order.payment_status)$staffInfo · $itemsText"
      $entry = New-Object System.Windows.Controls.ListBoxItem; $entry.Content = $line; $entry.Tag = $order; $entry.Padding = '12'; $entry.Margin = '3'; $entry.Background = '#1E1E24'; $ui_ordersList.Items.Add($entry) | Out-Null
      if ($order.counter_status -ne 'COMPLETED' -and $order.counter_status -ne 'CANCELLED') { $ticket = New-Object System.Windows.Controls.ListBoxItem; $ticket.Content = $line; $ticket.Tag = $order; $ticket.Padding = '14'; $ticket.Margin = '5'; $ticket.Background = '#1E1E24'; $ui_kitchenList.Items.Add($ticket) | Out-Null }
    }
    foreach ($order in $script:remoteOrders) {
      if ($script:orders.cloud_order_id -contains $order.id) { continue }
      if ($script:activeRole -eq 'cashier') {
        $itemsText = ($order.items | ForEach-Object { "$($_.name) × $($_.quantity)" }) -join ', '
        $entry = New-Object System.Windows.Controls.ListBoxItem; $entry.Content = "WEB · Order #$($order.order_number) · $($order.order_type) · $itemsText"; $entry.Tag = $order; $entry.Padding = '12'; $entry.Margin = '3'; $entry.Background = '#31191D'; $ui_ordersList.Items.Add($entry) | Out-Null
      } elseif ($order.order_id) {
        $itemsText = ($order.items | ForEach-Object { "$($_.name) × $($_.quantity)" }) -join ', '
        $entry = New-Object System.Windows.Controls.ListBoxItem; $entry.Content = "WEB · Order #$($order.order_number) · $($order.status) · $itemsText"; $entry.Tag = $order; $entry.Padding = '14'; $entry.Margin = '5'; $entry.Background = '#31191D'; $ui_kitchenList.Items.Add($entry) | Out-Null
      }
    }
    $ui_connection.Text = "LOCAL · $($state.pending_orders) queued"; $ui_status.Text = "Local SQLite ready · $($state.items.Count) cached menu items · $($state.orders.Count) orders"
  } catch { $ui_connection.Text = 'Bridge unavailable'; $ui_status.Text = $_.Exception.Message }
}

$ui_menuList.Add_MouseDoubleClick({ if ($ui_menuList.SelectedItem -and $ui_menuList.SelectedItem.Tag.in_stock) { $item = $ui_menuList.SelectedItem.Tag; $script:cart[$item.id] = 1 + [int]$script:cart[$item.id]; $ui_status.Text = "Added $($item.name) · quantity $($script:cart[$item.id]). Double-click to add more." } })
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
    try { $null = Bridge '/print' 'POST' $saved; $ui_status.Text = "Order #$($saved.sequence_no) saved locally and sent to printer." } catch { $ui_status.Text = "Order #$($saved.sequence_no) saved; printer unavailable: $($_.Exception.Message)" }
    $script:cart = @{}; Reload-Counter
  } catch { $ui_status.Text = $_.Exception.Message }
})
$ui_refresh.Add_Click({
  try { $result = Bridge '/menu/refresh' 'POST' @{}; Reload-Counter; $ui_status.Text = "Menu updated from Supabase: $($result.cached_items) items cached." }
  catch { Reload-Counter; $ui_status.Text = "Using local cached menu; cloud refresh is unavailable: $($_.Exception.Message)" }
})

$ui_navCashier.Add_Click({
  $ui_cashierPane.Visibility = 'Visible'; $ui_kitchenPane.Visibility = 'Collapsed'; $ui_staffPane.Visibility = 'Collapsed'
  $ui_navCashier.Background = '#DC2626'; $ui_navKitchen.Background = '#161B22'; $ui_navStaff.Background = '#161B22'
})
$ui_navKitchen.Add_Click({
  $ui_cashierPane.Visibility = 'Collapsed'; $ui_kitchenPane.Visibility = 'Visible'; $ui_staffPane.Visibility = 'Collapsed'
  $ui_navCashier.Background = '#161B22'; $ui_navKitchen.Background = '#DC2626'; $ui_navStaff.Background = '#161B22'
})
$ui_navStaff.Add_Click({
  $ui_cashierPane.Visibility = 'Collapsed'; $ui_kitchenPane.Visibility = 'Collapsed'; $ui_staffPane.Visibility = 'Visible'
  $ui_navCashier.Background = '#161B22'; $ui_navKitchen.Background = '#161B22'; $ui_navStaff.Background = '#DC2626'
  Reload-Staff
})

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

$ui_printTicket.Add_Click({ if ($ui_kitchenList.SelectedItem) { try { $order = $ui_kitchenList.SelectedItem.Tag; $orderNumber = if($order.sequence_no){"#$($order.sequence_no)"}else{"#$($order.order_number)"}; $null = Bridge '/print' 'POST' @{ client_order_id=$order.client_order_id; order_number=$orderNumber; order_type=$order.order_type; table_number=$order.table_number; total_amount=$order.total_amount; items=$order.items; print_type='KOT' }; $ui_status.Text = 'Kitchen ticket sent to the local printer.' } catch { $ui_status.Text = "Ticket remains in the local queue; printer unavailable: $($_.Exception.Message)" } } })
$ui_paid.Add_Click({ if ($ui_ordersList.SelectedItem) { $order = $ui_ordersList.SelectedItem.Tag; if(-not $order.client_order_id){$ui_status.Text='Online guest-order billing is not configured in this counter screen.';return}; try { $null = Bridge '/counter/orders/status' 'POST' @{ client_order_id = $order.client_order_id; payment_status = 'PAID' }; Reload-Counter } catch { $ui_status.Text = $_.Exception.Message } } })
$ui_preparing.Add_Click({ if ($ui_kitchenList.SelectedItem) { $order = $ui_kitchenList.SelectedItem.Tag; try { if($order.client_order_id){$null=Bridge '/counter/orders/status' 'POST' @{client_order_id=$order.client_order_id;counter_status='PREPARING'}}else{$access=Bridge '/counter/staff-access?role=kitchen';$null=Invoke-RestMethod -Method Patch -Uri "$script:webAppUrl/api/staff/kitchen-tickets" -TimeoutSec 5 -Headers @{Authorization="Bearer $($access.access_token)"} -ContentType 'application/json' -Body (@{order_id=$order.order_id;status='PREPARING'}|ConvertTo-Json -Compress)}; Reload-Counter } catch { $ui_status.Text = $_.Exception.Message } } })
$ui_ready.Add_Click({ if ($ui_kitchenList.SelectedItem) { $order = $ui_kitchenList.SelectedItem.Tag; try { if($order.client_order_id){$null=Bridge '/counter/orders/status' 'POST' @{client_order_id=$order.client_order_id;counter_status='READY'}}else{$access=Bridge '/counter/staff-access?role=kitchen';$null=Invoke-RestMethod -Method Patch -Uri "$script:webAppUrl/api/staff/kitchen-tickets" -TimeoutSec 5 -Headers @{Authorization="Bearer $($access.access_token)"} -ContentType 'application/json' -Body (@{order_id=$order.order_id;status='READY'}|ConvertTo-Json -Compress)}; Reload-Counter } catch { $ui_status.Text = $_.Exception.Message } } })

$timer = New-Object System.Windows.Threading.DispatcherTimer; $timer.Interval = [TimeSpan]::FromSeconds(2); $timer.Add_Tick({ Reload-Counter }); $timer.Start()
Reload-Counter
$null = $window.ShowDialog()

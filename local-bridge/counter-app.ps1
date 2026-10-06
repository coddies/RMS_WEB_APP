Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$ErrorActionPreference = 'Stop'
$bridge = 'http://127.0.0.1:8765'
$configDir = Join-Path $env:LOCALAPPDATA 'RMS Counter'
$credentialPath = Join-Path $configDir 'bridge-token.dpapi'
$staffSessionPath = Join-Path $configDir 'staff-session.dpapi'
$installRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appConfigPath = Join-Path $installRoot 'counter-config.json'
$script:token = ''
$script:staffSession = $null
$script:remoteOrders = @()
$script:items = @()
$script:orders = @()
$script:cart = @{}
$script:appConfig = if (Test-Path -LiteralPath $appConfigPath) { Get-Content -Raw -LiteralPath $appConfigPath | ConvertFrom-Json } else { [pscustomobject]@{} }
$script:webAppUrl = ([string]$script:appConfig.web_app_url).TrimEnd('/')

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
  if (-not (Test-Path -LiteralPath $credentialPath)) { return '' }
  return Unprotect-UserText $credentialPath
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
  $params = @{ Uri = "$bridge$Path"; Method = $Method; Headers = @{ 'X-RMS-Bridge-Token' = $script:token }; TimeoutSec = 4 }
  if ($null -ne $Body) { $params.ContentType = 'application/json'; $params.Body = ($Body | ConvertTo-Json -Depth 8 -Compress) }
  Invoke-RestMethod @params
}
function Show-TokenPrompt {
  $dialog = New-Object System.Windows.Window
  $dialog.Title = 'Connect to local-bridge'; $dialog.Width = 500; $dialog.Height = 210; $dialog.WindowStartupLocation = 'CenterScreen'; $dialog.ResizeMode = 'NoResize'; $dialog.Background = '#0D0D0D'; $dialog.Foreground = '#F0F0F0'
  $stack = New-Object System.Windows.Controls.StackPanel; $stack.Margin = '22'
  $label = New-Object System.Windows.Controls.TextBlock; $label.Text = 'Local Counter connection token'; $label.Margin = '0,0,0,8'; $stack.Children.Add($label) | Out-Null
  $input = New-Object System.Windows.Controls.PasswordBox; $input.Height = 44; $input.Padding = '10'; $stack.Children.Add($input) | Out-Null
  $hint = New-Object System.Windows.Controls.TextBlock; $hint.Text = 'Enter the token shown after the bridge installer pairs this PC.'; $hint.Foreground = '#8B949E'; $hint.Margin = '0,8,0,14'; $stack.Children.Add($hint) | Out-Null
  $button = New-Object System.Windows.Controls.Button; $button.Content = 'Connect'; $button.Height = 46; $button.Background = '#DC2626'; $button.Foreground = 'White'; $button.BorderThickness = '0'; $button.IsDefault = $true
  $button.Add_Click(({
    if ($input.SecurePassword.Length -ge 32) {
      Save-LocalToken ([Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($input.SecurePassword)))
      $dialog.DialogResult = $true; $dialog.Close()
    } else { $hint.Text = 'The token must contain at least 32 characters.' }
  }.GetNewClosure()))
  $stack.Children.Add($button) | Out-Null; $dialog.Content = $stack
  if ($dialog.ShowDialog()) { return $true }; return $false
}
function Show-StaffLogin {
  $cached = Read-StaffSession
  $dialog = New-Object System.Windows.Window
  $dialog.Title = 'RMS Counter sign in'; $dialog.Width = 470; $dialog.Height = 460; $dialog.WindowStartupLocation = 'CenterScreen'; $dialog.ResizeMode = 'NoResize'; $dialog.Background = '#0D0D0D'; $dialog.Foreground = '#F0F0F0'
  $stack = New-Object System.Windows.Controls.StackPanel; $stack.Margin = '24'
  $title = New-Object System.Windows.Controls.TextBlock; $title.Text = 'Counter staff sign in'; $title.FontSize = 24; $title.FontWeight = 'Bold'; $title.Margin = '0,0,0,18'; $stack.Children.Add($title) | Out-Null
  $tenantLabel = New-Object System.Windows.Controls.TextBlock; $tenantLabel.Text = "Restaurant: $((Bridge '/counter/state').tenant_slug)"; $tenantLabel.Foreground = '#8B949E'; $tenantLabel.Margin = '0,0,0,16'; $stack.Children.Add($tenantLabel) | Out-Null
  $role = New-Object System.Windows.Controls.ComboBox; $role.Items.Add('cashier')|Out-Null; $role.Items.Add('kitchen')|Out-Null; $role.SelectedIndex = 0; $role.Height = 46; $role.Margin = '0,0,0,10'; $role.Background = '#161B22'; $role.Foreground = '#F0F0F0'; $stack.Children.Add($role)|Out-Null
  $identity = New-Object System.Windows.Controls.TextBox; $identity.Text = if($cached){[string]$cached.identity}else{''}; $identity.Height = 46; $identity.Padding = '10'; $identity.Margin = '0,0,0,10'; $identity.Background = '#161B22'; $identity.Foreground = '#F0F0F0'; $stack.Children.Add($identity)|Out-Null
  $pin = New-Object System.Windows.Controls.PasswordBox; $pin.Height = 46; $pin.Padding = '10'; $pin.Margin = '0,0,0,10'; $stack.Children.Add($pin)|Out-Null
  $hint = New-Object System.Windows.Controls.TextBlock; $hint.Text = if($script:webAppUrl){'Online sign-in syncs orders. Previously signed-in staff can use their PIN offline.'}else{'Production staff login URL is not configured. Cached staff can still sign in offline.'}; $hint.TextWrapping = 'Wrap'; $hint.Foreground = '#8B949E'; $hint.Margin = '0,0,0,16'; $stack.Children.Add($hint)|Out-Null
  $button = New-Object System.Windows.Controls.Button; $button.Content = 'Sign in'; $button.Height = 50; $button.Background = '#DC2626'; $button.Foreground = 'White'; $button.BorderThickness = '0'; $button.IsDefault = $true
  $button.Add_Click(({
    $button.IsEnabled = $false; $hint.Text = 'Checking staff account…'
    try {
      if (-not $identity.Text.Trim() -or -not $pin.SecurePassword.Length) { throw 'Enter your username and PIN.' }
      $selectedRole = [string]$role.SelectedItem
      $signedIn = $null
      if ($script:webAppUrl) {
        try {
          $signedIn = Invoke-RestMethod -Method Post -Uri "$script:webAppUrl/api/auth/login" -TimeoutSec 8 -ContentType 'application/json' -Body (@{ tenant = (Bridge '/counter/state').tenant_slug; role = $selectedRole; identity = $identity.Text.Trim(); credential = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pin.SecurePassword)); native_counter = $true } | ConvertTo-Json -Compress)
        } catch { $signedIn = $null }
      }
      if ($signedIn) {
        $profile = @{ role=$signedIn.role; name=$signedIn.name; tenant_slug=$signedIn.tenant_slug; identity=$identity.Text.Trim(); pin=[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pin.SecurePassword)); access_token=$signedIn.access_token; refresh_token=$signedIn.refresh_token; expires_at=[long]$signedIn.expires_at }
        $null = Bridge '/counter/session' 'POST' @{ role=$profile.role; access_token=$profile.access_token; refresh_token=$profile.refresh_token; expires_at=$profile.expires_at }
      } elseif ($cached -and $cached.identity -eq $identity.Text.Trim() -and $cached.role -eq $selectedRole -and $cached.pin -eq [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pin.SecurePassword))) {
        $profile = $cached
      } else { throw 'Online sign-in failed, and this Windows account has no matching cached offline staff sign-in.' }
      Save-StaffSession ([pscustomobject]$profile); $dialog.DialogResult = $true; $dialog.Close()
    } catch { $hint.Text = $_.Exception.Message; $button.IsEnabled = $true }
  }.GetNewClosure()))
  $stack.Children.Add($button)|Out-Null; $dialog.Content=$stack
  if ($dialog.ShowDialog()) { return $script:staffSession }; return $null
}

$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Title="RMS Counter" Width="1180" Height="780" MinWidth="960" MinHeight="640" WindowStartupLocation="CenterScreen" Background="#0D0D0D" Foreground="#F0F0F0" FontFamily="Segoe UI">
 <Grid Margin="24"><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
  <DockPanel Grid.Row="0" Margin="0,0,0,18"><StackPanel><TextBlock Text="RESTAURANT OPERATIONS" Foreground="#8B949E" FontSize="12" FontWeight="Bold"/><TextBlock Name="heading" Text="Counter" FontSize="30" FontWeight="Bold"/></StackPanel><StackPanel DockPanel.Dock="Right" Orientation="Horizontal" VerticalAlignment="Center"><Border Background="#161B22" CornerRadius="18" Padding="14,9" Margin="0,0,10,0"><TextBlock Name="connection" Text="Local" Foreground="#10B981" FontWeight="Bold"/></Border><Button Name="refresh" Content="Refresh" MinWidth="100" Height="48" Background="#1E1E24" Foreground="#F0F0F0" BorderBrush="#343943"/></StackPanel></DockPanel>
  <Grid Grid.Row="1"><Grid.ColumnDefinitions><ColumnDefinition Width="210"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
   <StackPanel Grid.Column="0" Margin="0,0,18,0" Background="#121212"><TextBlock Text="COUNTER" Foreground="#8B949E" FontSize="12" FontWeight="Bold" Margin="14,12,0,14"/><Button Name="navCashier" Content="Orders" Height="50" Margin="8,0,8,6" HorizontalContentAlignment="Left" Padding="14,0" Background="#DC2626" Foreground="White" BorderThickness="0"/><Button Name="navKitchen" Content="Kitchen" Height="50" Margin="8,0,8,6" HorizontalContentAlignment="Left" Padding="14,0" Background="#161B22" Foreground="#F0F0F0" BorderBrush="#2B3038"/></StackPanel>
   <Grid Grid.Column="1">
    <Grid Name="cashierPane" Margin="4,10,0,0"><Grid.ColumnDefinitions><ColumnDefinition Width="1.2*"/><ColumnDefinition Width="0.8*"/></Grid.ColumnDefinitions>
     <DockPanel Grid.Column="0" Margin="0,0,16,0"><TextBlock DockPanel.Dock="Top" Text="Cached menu · double-click to add quantity" Foreground="#8B949E" Margin="0,0,0,12"/><ListBox Name="menuList" Background="#161B22" Foreground="#F0F0F0" BorderBrush="#2B3038"/></DockPanel>
     <DockPanel Grid.Column="1"><StackPanel DockPanel.Dock="Top"><TextBlock Text="Table number" Foreground="#8B949E"/><TextBox Name="table" Height="48" Margin="0,6,0,14" Padding="10" Background="#161B22" Foreground="#F0F0F0" BorderBrush="#343943"/><TextBlock Text="Current local orders" Foreground="#8B949E" Margin="0,0,0,8"/></StackPanel><ListBox Name="ordersList" Background="#161B22" Foreground="#F0F0F0" BorderBrush="#2B3038"/><StackPanel DockPanel.Dock="Bottom"><Button Name="placeOrder" Content="Save order &amp; print" Height="50" Margin="0,10,0,6" Background="#DC2626" Foreground="White" BorderThickness="0"/><Button Name="paid" Content="Mark selected order paid" Height="48" Background="#1E1E24" Foreground="#F0F0F0" BorderBrush="#343943"/></StackPanel></DockPanel>
    </Grid>
    <DockPanel Name="kitchenPane" Margin="4,10,0,0" Visibility="Collapsed"><TextBlock DockPanel.Dock="Top" Text="Kitchen tickets · newest first" Foreground="#8B949E" Margin="0,0,0,12"/><ListBox Name="kitchenList" Background="#161B22" Foreground="#F0F0F0" BorderBrush="#2B3038"/><StackPanel DockPanel.Dock="Bottom" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,12,0,0"><Button Name="printTicket" Content="Print KOT" Height="48" MinWidth="120" Margin="0,0,8,0" Background="#1E1E24" Foreground="#F0F0F0"/><Button Name="preparing" Content="Start preparing" Height="48" MinWidth="150" Margin="0,0,8,0" Background="#1E1E24" Foreground="#F0F0F0"/><Button Name="ready" Content="Mark ready" Height="48" MinWidth="120" Background="#DC2626" Foreground="White" BorderThickness="0"/></StackPanel></DockPanel>
   </Grid>
  </Grid>
  <TextBlock Name="status" Grid.Row="2" Text="Ready" Foreground="#8B949E" Margin="0,14,0,0" TextWrapping="Wrap"/>
 </Grid>
</Window>
'@

if (-not ($script:token = Read-LocalToken)) { if (-not (Show-TokenPrompt)) { exit } }
try { $null = Bridge '/counter/state' } catch {
  if ($_.Exception.Response.StatusCode.value__ -eq 401) {
    Remove-Item -LiteralPath $credentialPath -Force -ErrorAction SilentlyContinue
    if (-not (Show-TokenPrompt)) { exit }
  }
}
$script:staffSession = Show-StaffLogin
if (-not $script:staffSession) { exit }
$window = [System.Windows.Markup.XamlReader]::Parse($xaml)
foreach ($name in 'menuList','ordersList','kitchenList','table','placeOrder','paid','printTicket','preparing','ready','refresh','status','connection','heading','cashierPane','kitchenPane','navCashier','navKitchen') { Set-Variable -Scope Script -Name "ui_$name" -Value $window.FindName($name) }
$script:activeRole = [string]$script:staffSession.role
$ui_heading.Text = "Welcome, $($script:staffSession.name)"
if ($script:activeRole -eq 'cashier') { $ui_navKitchen.Visibility = 'Collapsed'; $ui_kitchenPane.Visibility = 'Collapsed' }
else { $ui_navCashier.Visibility = 'Collapsed'; $ui_cashierPane.Visibility = 'Collapsed'; $ui_kitchenPane.Visibility = 'Visible' }

function Reload-Counter {
  try {
    $state = Bridge "/counter/state?role=$script:activeRole"; $script:items = @($state.items); $script:orders = @($state.orders); $script:remoteOrders = @($state.remote_orders)
    $ui_menuList.Items.Clear()
    foreach ($item in $script:items) { $entry = New-Object System.Windows.Controls.ListBoxItem; $entry.Content = "$($item.name)   ·   Rs $([decimal]$item.price)   ·   $($item.category_name)"; $entry.Tag = $item; $entry.Padding = '14'; $entry.Margin = '4'; $entry.Background = '#1E1E24'; if (-not $item.in_stock) { $entry.IsEnabled = $false; $entry.Content += '   ·   SOLD OUT' }; $ui_menuList.Items.Add($entry) | Out-Null }
    $ui_ordersList.Items.Clear(); $ui_kitchenList.Items.Clear()
    foreach ($order in $script:orders) {
      $itemsText = ($order.items | ForEach-Object { "$($_.name) × $($_.quantity)" }) -join ', '
      $line = "#$($order.sequence_no) · Table $($order.table_number) · Rs $($order.total_amount) · $($order.counter_status) · Payment $($order.payment_status) · $itemsText"
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
    $saved = Bridge '/orders' 'POST' @{ client_order_id = [guid]::NewGuid().ToString(); order_type = 'DINE_IN'; table_number = $ui_table.Text.Trim(); items = $selectedItems }
    $ui_status.Text = "Saved local order #$($saved.sequence_no). Sending print job…"
    try { $null = Bridge '/print' 'POST' $saved; $ui_status.Text = "Order #$($saved.sequence_no) saved locally and sent to printer." } catch { $ui_status.Text = "Order #$($saved.sequence_no) saved; printer unavailable: $($_.Exception.Message)" }
    $script:cart = @{}; Reload-Counter
  } catch { $ui_status.Text = $_.Exception.Message }
})
$ui_refresh.Add_Click({
  try { $result = Bridge '/menu/refresh' 'POST' @{}; Reload-Counter; $ui_status.Text = "Menu updated from Supabase: $($result.cached_items) items cached." }
  catch { Reload-Counter; $ui_status.Text = "Using local cached menu; cloud refresh is unavailable: $($_.Exception.Message)" }
})
$ui_navCashier.Add_Click({ $ui_cashierPane.Visibility = 'Visible'; $ui_kitchenPane.Visibility = 'Collapsed'; $ui_navCashier.Background = '#DC2626'; $ui_navKitchen.Background = '#161B22' })
$ui_navKitchen.Add_Click({ $ui_cashierPane.Visibility = 'Collapsed'; $ui_kitchenPane.Visibility = 'Visible'; $ui_navCashier.Background = '#161B22'; $ui_navKitchen.Background = '#DC2626' })
$ui_printTicket.Add_Click({ if ($ui_kitchenList.SelectedItem) { try { $order = $ui_kitchenList.SelectedItem.Tag; $orderNumber = if($order.sequence_no){"#$($order.sequence_no)"}else{"#$($order.order_number)"}; $null = Bridge '/print' 'POST' @{ client_order_id=$order.client_order_id; order_number=$orderNumber; order_type=$order.order_type; table_number=$order.table_number; total_amount=$order.total_amount; items=$order.items; print_type='KOT' }; $ui_status.Text = 'Kitchen ticket sent to the local printer.' } catch { $ui_status.Text = "Ticket remains in the local queue; printer unavailable: $($_.Exception.Message)" } } })
$ui_paid.Add_Click({ if ($ui_ordersList.SelectedItem) { $order = $ui_ordersList.SelectedItem.Tag; if(-not $order.client_order_id){$ui_status.Text='Online guest-order billing is not configured in this counter screen.';return}; try { $null = Bridge '/counter/orders/status' 'POST' @{ client_order_id = $order.client_order_id; payment_status = 'PAID' }; Reload-Counter } catch { $ui_status.Text = $_.Exception.Message } } })
$ui_preparing.Add_Click({ if ($ui_kitchenList.SelectedItem) { $order = $ui_kitchenList.SelectedItem.Tag; try { if($order.client_order_id){$null=Bridge '/counter/orders/status' 'POST' @{client_order_id=$order.client_order_id;counter_status='PREPARING'}}else{$access=Bridge '/counter/staff-access?role=kitchen';$null=Invoke-RestMethod -Method Patch -Uri "$script:webAppUrl/api/staff/kitchen-tickets" -TimeoutSec 5 -Headers @{Authorization="Bearer $($access.access_token)"} -ContentType 'application/json' -Body (@{order_id=$order.order_id;status='PREPARING'}|ConvertTo-Json -Compress)}; Reload-Counter } catch { $ui_status.Text = $_.Exception.Message } } })
$ui_ready.Add_Click({ if ($ui_kitchenList.SelectedItem) { $order = $ui_kitchenList.SelectedItem.Tag; try { if($order.client_order_id){$null=Bridge '/counter/orders/status' 'POST' @{client_order_id=$order.client_order_id;counter_status='READY'}}else{$access=Bridge '/counter/staff-access?role=kitchen';$null=Invoke-RestMethod -Method Patch -Uri "$script:webAppUrl/api/staff/kitchen-tickets" -TimeoutSec 5 -Headers @{Authorization="Bearer $($access.access_token)"} -ContentType 'application/json' -Body (@{order_id=$order.order_id;status='READY'}|ConvertTo-Json -Compress)}; Reload-Counter } catch { $ui_status.Text = $_.Exception.Message } } })
$timer = New-Object System.Windows.Threading.DispatcherTimer; $timer.Interval = [TimeSpan]::FromSeconds(2); $timer.Add_Tick({ Reload-Counter }); $timer.Start()
Reload-Counter
$null = $window.ShowDialog()

#ifndef SourceRoot
  #define SourceRoot ".."
#endif
#ifndef PayloadDir
  #define PayloadDir "payload"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#define SupabaseProjectUrl GetEnv("RMS_BUILD_SUPABASE_URL")
#define SupabasePublishableKey GetEnv("RMS_BUILD_SUPABASE_PUBLISHABLE_KEY")
#define WebAppUrl GetEnv("RMS_BUILD_WEB_APP_URL")
#if SupabaseProjectUrl == "" || SupabasePublishableKey == "" || WebAppUrl == ""
  #error "Set RMS_BUILD_SUPABASE_URL, RMS_BUILD_SUPABASE_PUBLISHABLE_KEY, and RMS_BUILD_WEB_APP_URL when building the installer."
#endif
#define BridgeVersion "1.1.4"

[Setup]
AppId={{7F248C1E-A725-4C0B-A9D3-1F1254309B12}
AppName=RMS Local Bridge
AppVersion={#BridgeVersion}
AppPublisher=Restaurant Management System
DefaultDirName=Z:\restaurant  management system\test-install
UsePreviousAppDir=no
DisableDirPage=no
DefaultGroupName=RMS Local Bridge
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=RMSLocalBridgeSetup-1.1.5
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=RMS Local Bridge
Uninstallable=yes
CloseApplications=yes
RestartApplications=no

[Files]
Source: "{#SourceRoot}\server.mjs"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\counter-app.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\raw-usb-printer.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\runtime\node.exe"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "{#PayloadDir}\runtime\LICENSE"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "{#PayloadDir}\service\RMSLocalBridge.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\installer\RMSLocalBridge.xml"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\installer\configure.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "{#PayloadDir}\service\WinSW-LICENSE.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion
; Native counter host — compiled C# launcher (no PowerShell/console window visible to user)
Source: "{#SourceRoot}\desktop-app\dist\RMSCounter.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\desktop-app\dist\RMSCounter.ico"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{app}\data"
Name: "{app}\logs"

[Icons]
; RMSCounter.exe is a compiled C# host — it starts the bridge (if needed) and
; runs the WPF UI in-process. No PowerShell or console window is ever shown.
Name: "{group}\RMS Counter"; Filename: "{app}\RMSCounter.exe"; WorkingDir: "{app}"; IconFilename: "{app}\RMSCounter.ico"
Name: "{autodesktop}\RMS Counter"; Filename: "{app}\RMSCounter.exe"; WorkingDir: "{app}"; IconFilename: "{app}\RMSCounter.ico"; Tasks: desktopicon
Name: "{group}\Uninstall RMS Local Bridge"; Filename: "{uninstallexe}"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut for RMS Counter"; GroupDescription: "Additional shortcuts:"

[Run]
; Launch the native C# counter host after install — no console window shown.
Filename: "{app}\RMSCounter.exe"; WorkingDir: "{app}"; Flags: postinstall nowait runasoriginaluser; Description: "Launch RMS Counter"

[UninstallRun]
Filename: "{app}\RMSLocalBridge.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopRMSLocalBridge"
Filename: "{app}\RMSLocalBridge.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "UninstallRMSLocalBridge"

[UninstallDelete]
Type: files; Name: "{app}\.env"
Type: dirifempty; Name: "{app}\data"
Type: dirifempty; Name: "{app}\logs"

[Code]

procedure RunAndCheck(const FileName, Params, FailureMessage: string; ShowCommand: Integer);
var
  ResultCode: Integer;
begin
  if not Exec(FileName, Params, ExpandConstant('{app}'), ShowCommand, ewWaitUntilTerminated, ResultCode) then
    RaiseException(FailureMessage);
  if ResultCode <> 0 then
    RaiseException(FailureMessage + ' (exit code ' + IntToStr(ResultCode) + ').');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  WaitCount: Integer;
begin
  if CurStep = ssInstall then begin
    if FileExists(ExpandConstant('{app}\RMSLocalBridge.exe')) then begin
      Exec(ExpandConstant('{app}\RMSLocalBridge.exe'), 'stop', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Exec(ExpandConstant('{app}\RMSLocalBridge.exe'), 'uninstall', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
    end;
    exit;
  end;
  if CurStep <> ssPostInstall then
    exit;

  RunAndCheck(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\installer\configure.ps1') + '" -InstallDir "' + ExpandConstant('{app}') + '" -SupabaseUrl "{#SupabaseProjectUrl}" -PublishableKey "{#SupabasePublishableKey}" -WebAppUrl "{#WebAppUrl}"',
    'Supabase configuration was not completed. The service was not started.', SW_SHOWNORMAL);

  RunAndCheck(ExpandConstant('{app}\RMSLocalBridge.exe'), 'install',
    'Windows could not register the RMS Local Bridge service.', SW_HIDE);
  RunAndCheck(ExpandConstant('{app}\RMSLocalBridge.exe'), 'start',
    'Windows could not start the RMS Local Bridge service.', SW_HIDE);

  for WaitCount := 1 to 30 do begin
    if Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -Command "try { $r=Invoke-RestMethod -TimeoutSec 1 http://127.0.0.1:8765/health; if ($r.ok) { exit 0 } } catch {}; exit 1"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0) then
      exit;
    Sleep(1000);
  end;

  RunAndCheck(ExpandConstant('{app}\RMSLocalBridge.exe'), 'stop',
    'The service did not become healthy. Windows could not stop it.', SW_HIDE);
  RaiseException('The service installed but its health endpoint did not respond. Check the service logs in the install folder.');
end;

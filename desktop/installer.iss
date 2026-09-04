#ifndef MyAppVersion
  #define MyAppVersion "1.1.0"
#endif
#ifndef MyAppArch
  #define MyAppArch "win-x64"
#endif
#ifndef SourceDir
  #define SourceDir "artifacts\publish\win-x64"
#endif

#if MyAppArch == "win-arm64"
  #define ArchitectureAllowed "arm64"
#else
  #define ArchitectureAllowed "x64compatible"
#endif

[Setup]
AppId={{CDE56D9E-09A8-4B4A-A9A9-2D2AECFAE8CB}
AppName=Ultra Headcount Manager
AppVersion={#MyAppVersion}
AppPublisher=xprezz
AppPublisherURL=https://github.com/xprezz/ultra-headcount-manager
AppSupportURL=https://github.com/xprezz/ultra-headcount-manager/issues
AppUpdatesURL=https://github.com/xprezz/ultra-headcount-manager/releases
DefaultDirName={localappdata}\Programs\Ultra Headcount Manager
DefaultGroupName=Ultra Headcount Manager
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed={#ArchitectureAllowed}
OutputDir=artifacts\installers
OutputBaseFilename=Ultra-Headcount-Manager-{#MyAppVersion}-{#MyAppArch}-setup
SetupIconFile=Assets\app.ico
UninstallDisplayIcon={app}\UltraHeadcountManager.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
AppMutex=UltraHeadcountManager.Desktop.SingleInstance
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany=xprezz
VersionInfoDescription=Ultra Headcount Manager installer
VersionInfoProductName=Ultra Headcount Manager

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "Dependencies\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsWebView2

[Icons]
Name: "{autoprograms}\Ultra Headcount Manager"; Filename: "{app}\UltraHeadcountManager.exe"
Name: "{autodesktop}\Ultra Headcount Manager"; Filename: "{app}\UltraHeadcountManager.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Installing the Microsoft WebView2 runtime..."; Flags: runhidden waituntilterminated; Check: NeedsWebView2
Filename: "{app}\UltraHeadcountManager.exe"; Description: "Open Ultra Headcount Manager"; Flags: nowait postinstall skipifsilent

[Code]
function HasWebView2InRoot(RootKey: Integer): Boolean;
var
  Version: String;
begin
  Result :=
    RegQueryStringValue(
      RootKey,
      'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F1E7EBA9-11E8-4F9C-97F4-56D9C5B9C9B2}',
      'pv',
      Version) and
    (Version <> '') and
    (Version <> '0.0.0.0');
end;

function NeedsWebView2: Boolean;
begin
  Result :=
    not HasWebView2InRoot(HKCU) and
    not HasWebView2InRoot(HKLM) and
    not HasWebView2InRoot(HKLM32) and
    not HasWebView2InRoot(HKLM64);
end;

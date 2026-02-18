#define Root SourcePath + "\.."

[Setup]
AppName=Discapture
AppVersion={#AppVersion}
AppPublisher=Discapture
DefaultDirName={localappdata}\Discapture
PrivilegesRequired=lowest
DefaultGroupName=Discapture
UninstallDisplayIcon={app}\bin\Discapture.exe
OutputDir={#Root}\{#OutputDir}
OutputBaseFilename=Discapture-win-x64-setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "{#Root}\{#BuildDir}\*"; DestDir: "{app}"; Flags: recursesubdirs

[Icons]
Name: "{group}\Discapture"; Filename: "{app}\bin\Discapture.exe"
Name: "{group}\Uninstall Discapture"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Discapture"; Filename: "{app}\bin\Discapture.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Setup]
AppName=Discapture
AppVersion={#AppVersion}
AppPublisher=Discapture
DefaultDirName={autopf}\Discapture
DefaultGroupName=Discapture
UninstallDisplayIcon={app}\Discapture.exe
OutputDir={#OutputDir}
OutputBaseFilename=Discapture-win-x64-setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "{#BuildDir}\*"; DestDir: "{app}"; Flags: recursesubdirs

[Icons]
Name: "{group}\Discapture"; Filename: "{app}\Discapture.exe"
Name: "{group}\Uninstall Discapture"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Discapture"; Filename: "{app}\Discapture.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

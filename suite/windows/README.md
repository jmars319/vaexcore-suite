# vaexcore Windows Build Kit

This kit is for building the current local vaexcore suite on Windows 11 with fewer manual steps.

Run from PowerShell at the top of the vaexcore container:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\suite\windows\Build-VaexcoreSuite.ps1 -InstallPrerequisites
```

If the prerequisites are already installed, use:

```powershell
.\suite\windows\Build-VaexcoreSuite.ps1
```

The script builds:

- Studio Tauri NSIS installer
- Pulse Tauri NSIS installer
- Console Electron NSIS/portable artifacts

Collected artifacts are written to:

```text
dist\windows-suite\
```

Install the generated artifacts in this order:

1. `studio`
2. `pulse`
3. `console`

After installation, launch the suite with:

```powershell
.\suite\windows\Launch-VaexcoreSuite.ps1
```

Or double-click:

```text
suite\windows\Start-VaexcoreSuite.cmd
```

To add Start Menu shortcuts and a desktop Suite shortcut using the suite logo,
double-click:

```text
suite\windows\Install-VaexcoreLaunchers.cmd
```

Individual app launchers are also included:

```text
suite\windows\Start-VaexcoreStudio.cmd
suite\windows\Start-VaexcorePulse.cmd
suite\windows\Start-VaexcoreConsole.cmd
```

Suite discovery on Windows is shared through:

```text
%APPDATA%\vaexcore\suite
```

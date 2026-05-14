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

Before a full build, you can check this Windows machine without installing or
building anything:

```powershell
.\suite\windows\Test-VaexcoreWindowsPrerequisites.ps1
```

To install/check prerequisites without starting dependency installs or app
builds, run:

```powershell
.\suite\windows\Build-VaexcoreSuite.ps1 -InstallPrerequisites -PrerequisitesOnly
```

When this repo sits beside sibling app repos named `vaexcore-studio`,
`vaexcore-pulse`, and `vaexcore-console`, the build script uses those existing
repos automatically. To point at a different app container, pass:

```powershell
.\suite\windows\Build-VaexcoreSuite.ps1 -AppsRoot C:\path\to\vaexcore
```

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
suite\windows\Start-VaexcoreSuite.vbs
```

To add Start Menu shortcuts and a desktop Suite shortcut using the suite logo,
double-click:

```text
suite\windows\Install-VaexcoreLaunchers.vbs
```

Individual app launchers are also included:

```text
suite\windows\Start-VaexcoreStudio.vbs
suite\windows\Start-VaexcorePulse.vbs
suite\windows\Start-VaexcoreConsole.vbs
```

Suite discovery on Windows is shared through:

```text
%APPDATA%\vaexcore\suite
```

## Handoff Pack

The machine-readable validation plan lives at:

```text
suite\windows\windows-validation-plan.json
```

Mac-side automation can report this handoff pack as code-ready, but it must not
mark Windows hardware validation complete. Archive the JSON plan with the
release-readiness JSON and Markdown reports, then attach Windows evidence for
capture devices, encoders, installers, launchers, signing, Twitch, and Discord
as each manual stage is completed.

Generate local release-readiness reports with:

```powershell
node scripts\release-readiness-report.mjs --skip-git --skip-remote --json --output .local\release-readiness.json
node scripts\release-readiness-report.mjs --skip-git --skip-remote --format markdown --output .local\release-readiness.md
```

## Full Twitch Test Sequence

Before testing Twitch, run the Windows prerequisite check:

```powershell
.\suite\windows\Test-VaexcoreWindowsPrerequisites.ps1
```

Then launch the Suite and confirm Studio, Pulse, and Console are all ready:

```powershell
.\suite\windows\Launch-VaexcoreSuite.ps1
.\suite\windows\Test-VaexcoreWindowsSuite.ps1
```

In Console, open `Settings -> Setup Guide`, connect Twitch with
`user:read:chat`, `user:write:chat`, and `channel:read:stream_key`. Create the
Twitch Developer App from any Twitch account you control; it does not need to be
the Bot Login or the Broadcaster Login. For the first full Suite test, use the
same Twitch account for Broadcaster Login and Bot Login, then click
`Connect Twitch` while logged into that account. Send a test message and start
the bot. Type `!ping` in Twitch chat and wait for `LIVE CHAT CONFIRMED`.

In Studio, import the Twitch stream key from Console, select Twitch as the
stream destination, enable `Twitch bandwidth test`, and start streaming. The
bandwidth test publishes to Twitch ingest without going publicly live.

After the stream test, stop streaming in Studio, stop the bot in Console, then
hand the saved recording to Pulse for media inspection and clip preview.

## Windows Launch Warnings

The apps and installers must be Authenticode-signed before Windows can show a
verified publisher. Unsigned local builds can still trigger SmartScreen or
unknown-publisher warnings even when the app code is behaving correctly. Store
distribution is the cleanest long-term route; direct downloads need every EXE
and installer signed with a trusted, consistent publisher identity.

Check the current installed apps with:

```powershell
.\suite\windows\Test-VaexcoreWindowsSigning.ps1
```

Include release artifacts too with:

```powershell
.\suite\windows\Test-VaexcoreWindowsSigning.ps1 -IncludeBuildArtifacts
```

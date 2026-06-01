[CmdletBinding()]
param(
  [switch]$InstallPrerequisites,
  [switch]$PrerequisitesOnly,
  [switch]$SkipAppUpdate,
  [switch]$SkipDependencyInstall,
  [switch]$SkipBuild,
  [switch]$LaunchAfterBuild,
  [string]$AppsRoot,
  [string]$ArtifactDir
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Resolve-Path (Join-Path $ScriptDir "..\..")
if (-not $ArtifactDir) {
  $ArtifactDir = Join-Path $RootDir "dist\windows-suite"
}
if (-not $AppsRoot -and $env:VAEXCORE_APPS_ROOT) {
  $AppsRoot = $env:VAEXCORE_APPS_ROOT
}

$AppsConfig = Get-Content -Raw (Join-Path $RootDir "apps.json") | ConvertFrom-Json
$AppConfigs = @($AppsConfig.apps)
$ResolvedAppDirs = @{}

$BuildModuleDir = Join-Path $ScriptDir "build-modules"
. (Join-Path $BuildModuleDir "Common.ps1")
. (Join-Path $BuildModuleDir "Prerequisites.ps1")
. (Join-Path $BuildModuleDir "Repositories.ps1")
. (Join-Path $BuildModuleDir "BuildInstallers.ps1")
. (Join-Path $BuildModuleDir "Artifacts.ps1")

Ensure-Prerequisites
if ($PrerequisitesOnly) {
  Write-Host "Windows prerequisites are ready." -ForegroundColor Green
  exit 0
}
Ensure-Repositories
Install-Dependencies
Build-Installers
Copy-Artifacts

$manifestArgs = @("scripts\dist-windows-manifest.mjs", "--artifact-dir", $ArtifactDir, "--arch", "x64")
foreach ($app in $AppConfigs) {
  $manifestArgs += @("--app-dir", "$($app.id)=$(Resolve-AppDirectory $app)")
}
Invoke-Checked $RootDir "node" $manifestArgs
Invoke-Checked $RootDir "node" @("scripts\validate-release-manifest.mjs", (Join-Path $ArtifactDir "manifest.json"))

if ($LaunchAfterBuild) {
  & (Join-Path $ScriptDir "Launch-VaexcoreSuite.ps1")
}

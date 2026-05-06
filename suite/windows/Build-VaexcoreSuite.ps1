[CmdletBinding()]
param(
  [switch]$InstallPrerequisites,
  [switch]$SkipAppUpdate,
  [switch]$SkipDependencyInstall,
  [switch]$SkipBuild,
  [switch]$LaunchAfterBuild,
  [string]$ArtifactDir
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Resolve-Path (Join-Path $ScriptDir "..\..")
if (-not $ArtifactDir) {
  $ArtifactDir = Join-Path $RootDir "dist\windows-suite"
}

$AppsConfig = Get-Content -Raw (Join-Path $RootDir "apps.json") | ConvertFrom-Json
$AppConfigs = @($AppsConfig.apps)

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Checked {
  param(
    [string]$WorkingDirectory,
    [string]$FilePath,
    [string[]]$Arguments
  )

  Write-Host "[$WorkingDirectory] $FilePath $($Arguments -join ' ')"
  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$FilePath exited with code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Invoke-CommandLine {
  param(
    [string]$WorkingDirectory,
    [string]$CommandLine
  )

  Write-Host "[$WorkingDirectory] $CommandLine"
  Push-Location $WorkingDirectory
  try {
    & cmd.exe /d /s /c $CommandLine
    if ($LASTEXITCODE -ne 0) {
      throw "$CommandLine exited with code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Test-CommandAvailable {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WithWinget {
  param(
    [string]$Id,
    [string[]]$ExtraArguments = @()
  )

  if (-not (Test-CommandAvailable "winget")) {
    throw "winget is required for -InstallPrerequisites. Install App Installer from Microsoft Store, then rerun."
  }

  $arguments = @("install", "--id", $Id, "--exact", "--accept-package-agreements", "--accept-source-agreements") + $ExtraArguments
  Write-Host "winget $($arguments -join ' ')"
  & winget @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "winget install failed for $Id"
  }
}

function Test-VisualCppTools {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) {
    return $false
  }

  $installPath = & $vswhere -products * -requires Microsoft.VisualStudio.Workload.VCTools -property installationPath -latest
  return -not [string]::IsNullOrWhiteSpace($installPath)
}

function Ensure-Prerequisites {
  if ($InstallPrerequisites) {
    Write-Step "Installing common Windows prerequisites with winget"
    if (-not (Test-CommandAvailable "node")) {
      Install-WithWinget "OpenJS.NodeJS.LTS"
    }
    if (-not (Test-CommandAvailable "rustup")) {
      Install-WithWinget "Rustlang.Rustup"
    }
    if (-not (Test-CommandAvailable "python")) {
      Install-WithWinget "Python.Python.3.12"
    }
    if (-not (Test-CommandAvailable "ffmpeg")) {
      Install-WithWinget "Gyan.FFmpeg"
    }
    Install-WithWinget "Microsoft.EdgeWebView2Runtime"

    if (-not (Test-VisualCppTools)) {
      Install-WithWinget "Microsoft.VisualStudio.2022.BuildTools" @(
        "--override",
        "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
      )
    }
  }

  Write-Step "Checking prerequisites"
  $missing = New-Object System.Collections.Generic.List[string]
  foreach ($command in @("node", "npm", "cargo", "rustup", "python")) {
    if (-not (Test-CommandAvailable $command)) {
      $missing.Add($command)
    }
  }

  if (-not (Test-VisualCppTools)) {
    $missing.Add("Visual Studio Build Tools C++ workload")
  }

  if ($missing.Count -gt 0) {
    throw "Missing prerequisites: $($missing -join ', '). Rerun with -InstallPrerequisites or install them manually."
  }

  & rustup target add x86_64-pc-windows-msvc
  if ($LASTEXITCODE -ne 0) {
    throw "rustup target add x86_64-pc-windows-msvc failed"
  }

  if (Test-CommandAvailable "corepack") {
    & corepack enable
    & corepack prepare pnpm@10.32.1 --activate
  }

  if (-not (Test-CommandAvailable "pnpm")) {
    Invoke-Checked $RootDir "npm" @("install", "-g", "pnpm@10.32.1")
  }
}

function Ensure-Repositories {
  if (-not $SkipAppUpdate) {
    Clone-OrUpdateAppRepos
  }

  foreach ($app in $AppConfigs) {
    $path = Join-Path $RootDir $app.path
    if (-not (Test-Path $path)) {
      throw "Missing repo folder: $path"
    }
  }
}

function Clone-OrUpdateAppRepos {
  Write-Step "Cloning or updating app repositories"
  foreach ($app in $AppConfigs) {
    Clone-OrUpdateApp $app.name $app.repo $app.path $app.branch
  }
}

function Clone-OrUpdateApp {
  param(
    [string]$Name,
    [string]$Repo,
    [string]$RelativePath,
    [string]$Branch
  )

  $target = Join-Path $RootDir $RelativePath
  if (Test-Path (Join-Path $target ".git")) {
    Write-Host "Updating $Name..."
    Invoke-Checked $target "git" @("fetch", "origin")
    Invoke-Checked $target "git" @("checkout", $Branch)
    Invoke-Checked $target "git" @("pull", "--ff-only", "origin", $Branch)
    return
  }

  if (Test-Path $target) {
    throw "Cannot clone $Name; $target exists but is not a git repo."
  }

  Write-Host "Cloning $Name..."
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  Invoke-Checked $RootDir "git" @("clone", "--branch", $Branch, $Repo, $target)
}

function Install-Dependencies {
  if ($SkipDependencyInstall) {
    return
  }

  foreach ($app in $AppConfigs) {
    Write-Step "Installing $($app.name) dependencies"
    Invoke-CommandLine (Join-Path $RootDir $app.path) $app.dependencyInstallCommand
  }
}

function Build-Installers {
  if ($SkipBuild) {
    return
  }

  foreach ($app in $AppConfigs) {
    Write-Step "Building $($app.name) Windows artifacts"
    Invoke-CommandLine (Join-Path $RootDir $app.path) $app.windowsDistCommand
  }
}

function Copy-Artifacts {
  Write-Step "Collecting Windows artifacts"
  $installersDir = Join-Path $ArtifactDir "installers"
  $scriptsDir = Join-Path $ArtifactDir "scripts"
  New-Item -ItemType Directory -Force -Path $installersDir, $scriptsDir | Out-Null

  foreach ($app in $AppConfigs) {
    Copy-ProjectArtifacts $app.artifactFolder @($app.windowsArtifactPatterns)
  }

  Copy-Item -Force (Join-Path $ScriptDir "Launch-VaexcoreSuite.ps1") (Join-Path $scriptsDir "Launch-VaexcoreSuite.ps1")
  Copy-Item -Force (Join-Path $ScriptDir "Launch-VaexcoreApp.ps1") (Join-Path $scriptsDir "Launch-VaexcoreApp.ps1")
  Copy-Item -Force (Join-Path $ScriptDir "Install-VaexcoreLaunchers.ps1") (Join-Path $scriptsDir "Install-VaexcoreLaunchers.ps1")
  Copy-Item -Force (Join-Path $ScriptDir "Test-VaexcoreWindowsSuite.ps1") (Join-Path $scriptsDir "Test-VaexcoreWindowsSuite.ps1")
  foreach ($launcher in @(
    "Install-VaexcoreLaunchers.cmd",
    "Start-VaexcoreSuite.cmd",
    "Start-VaexcoreStudio.cmd",
    "Start-VaexcorePulse.cmd",
    "Start-VaexcoreConsole.cmd"
  )) {
    Copy-Item -Force (Join-Path $ScriptDir $launcher) (Join-Path $scriptsDir $launcher)
  }
  $assetTarget = Join-Path $scriptsDir "assets"
  New-Item -ItemType Directory -Force -Path $assetTarget | Out-Null
  Copy-Item -Force (Join-Path $ScriptDir "assets\vaexcore-suite.ico") (Join-Path $assetTarget "vaexcore-suite.ico")
  Copy-Item -Force (Join-Path $ScriptDir "assets\vaexcore-suite.jpg") (Join-Path $assetTarget "vaexcore-suite.jpg")

  $builtAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $summary = @'
# vaexcore Windows Suite

Built: __BUILT_AT__

Install order:

1. installers\studio
2. installers\pulse
3. installers\console

After installing, run:

```powershell
.\scripts\Install-VaexcoreLaunchers.ps1
.\scripts\Launch-VaexcoreSuite.ps1
.\scripts\Start-VaexcoreSuite.cmd
.\scripts\Test-VaexcoreWindowsSuite.ps1
```

Suite discovery path:

```text
%APPDATA%\vaexcore\suite
```
'@.Replace("__BUILT_AT__", $builtAt)
  Set-Content -Encoding UTF8 -Path (Join-Path $ArtifactDir "README.md") -Value $summary
  Write-Host "Artifacts collected at $ArtifactDir" -ForegroundColor Green
}

function Copy-ProjectArtifacts {
  param(
    [string]$Name,
    [string[]]$Patterns
  )

  $target = Join-Path (Join-Path $ArtifactDir "installers") $Name
  New-Item -ItemType Directory -Force -Path $target | Out-Null

  $files = @()
  foreach ($pattern in $Patterns) {
    $found = Get-ChildItem -Path (Join-Path $RootDir $pattern) -File -ErrorAction SilentlyContinue
    if ($found) {
      $files += $found
    }
  }

  if ($files.Count -eq 0) {
    Write-Warning "No artifacts found for $Name"
    return
  }

  foreach ($file in $files) {
    Copy-Item -Force $file.FullName $target
    Write-Host "  ${Name}: $($file.Name)"
  }
}

Ensure-Prerequisites
Ensure-Repositories
Install-Dependencies
Build-Installers
Copy-Artifacts
Invoke-Checked $RootDir "node" @("scripts\dist-windows-manifest.mjs", "--artifact-dir", $ArtifactDir, "--arch", "x64")
Invoke-Checked $RootDir "node" @("scripts\validate-release-manifest.mjs", (Join-Path $ArtifactDir "manifest.json"))

if ($LaunchAfterBuild) {
  & (Join-Path $ScriptDir "Launch-VaexcoreSuite.ps1")
}

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

function Test-ExecutableAvailable {
  param(
    [string]$Name,
    [string[]]$KnownPaths = @()
  )

  if (Test-CommandAvailable $Name) {
    return $true
  }

  foreach ($path in $KnownPaths) {
    if (Test-Path $path) {
      return $true
    }
  }

  return $false
}

function Get-WinGetFfmpegBinPaths {
  $paths = New-Object System.Collections.Generic.List[string]
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    return $paths.ToArray()
  }

  $packagesRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  if (-not (Test-Path -LiteralPath $packagesRoot)) {
    return $paths.ToArray()
  }

  $packages = Get-ChildItem -LiteralPath $packagesRoot -Directory -Filter "Gyan.FFmpeg_*" -ErrorAction SilentlyContinue
  foreach ($package in $packages) {
    $children = Get-ChildItem -LiteralPath $package.FullName -Directory -ErrorAction SilentlyContinue
    foreach ($child in $children) {
      $bin = Join-Path $child.FullName "bin"
      if (Test-Path -LiteralPath $bin) {
        $paths.Add($bin)
      }
    }
  }

  return $paths.ToArray()
}

function Get-FFmpegBinPaths {
  $paths = New-Object System.Collections.Generic.List[string]
  foreach ($entry in @(
    "C:\ffmpeg\bin",
    "C:\Program Files\ffmpeg\bin",
    "C:\ProgramData\chocolatey\bin",
    (Join-Path $env:USERPROFILE "scoop\shims"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links")
  )) {
    if (-not [string]::IsNullOrWhiteSpace($entry)) {
      $paths.Add($entry)
    }
  }

  foreach ($entry in Get-WinGetFfmpegBinPaths) {
    $paths.Add($entry)
  }

  return $paths.ToArray()
}

function Get-FFmpegKnownExecutablePaths {
  param([string]$Name)

  $paths = New-Object System.Collections.Generic.List[string]
  $executable = if ($Name.EndsWith(".exe", [StringComparison]::OrdinalIgnoreCase)) {
    $Name
  } else {
    "$Name.exe"
  }

  foreach ($bin in Get-FFmpegBinPaths) {
    $paths.Add((Join-Path $bin $executable))
  }

  return $paths.ToArray()
}

function Update-ProcessPath {
  $paths = New-Object System.Collections.Generic.List[string]
  foreach ($scope in @("Machine", "User", "Process")) {
    $value = [Environment]::GetEnvironmentVariable("Path", $scope)
    if ([string]::IsNullOrWhiteSpace($value)) {
      continue
    }
    foreach ($entry in $value.Split(";")) {
      if (-not [string]::IsNullOrWhiteSpace($entry) -and -not $paths.Contains($entry)) {
        $paths.Add($entry)
      }
    }
  }

  $extraPathEntries = @(
    "C:\Program Files\nodejs",
    (Join-Path $env:USERPROFILE ".cargo\bin"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\Scripts"),
    "C:\ffmpeg\bin",
    "C:\Program Files\ffmpeg\bin"
  ) + (Get-FFmpegBinPaths)

  foreach ($entry in $extraPathEntries) {
    if ((Test-Path $entry) -and -not $paths.Contains($entry)) {
      $paths.Add($entry)
    }
  }

  $env:Path = $paths -join ";"
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
  Update-ProcessPath

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
    if (-not (Test-ExecutableAvailable "ffmpeg" (Get-FFmpegKnownExecutablePaths "ffmpeg"))) {
      Install-WithWinget "Gyan.FFmpeg"
    }
    Install-WithWinget "Microsoft.EdgeWebView2Runtime"

    if (-not (Test-VisualCppTools)) {
      Install-WithWinget "Microsoft.VisualStudio.2022.BuildTools" @(
        "--override",
        "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
      )
    }

    Update-ProcessPath
  }

  Update-ProcessPath
  Write-Step "Checking prerequisites"
  $missing = New-Object System.Collections.Generic.List[string]
  foreach ($command in @("node", "npm", "cargo", "rustup", "python")) {
    if (-not (Test-CommandAvailable $command)) {
      $missing.Add($command)
    }
  }
  if (-not (Test-ExecutableAvailable "ffmpeg" (Get-FFmpegKnownExecutablePaths "ffmpeg"))) {
    $missing.Add("ffmpeg")
  }
  if (-not (Test-ExecutableAvailable "ffprobe" (Get-FFmpegKnownExecutablePaths "ffprobe"))) {
    $missing.Add("ffprobe")
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

  if (-not (Test-CommandAvailable "pnpm")) {
    if (Test-CommandAvailable "corepack") {
      & corepack prepare pnpm@10.32.1 --activate
      if ($LASTEXITCODE -ne 0) {
        Write-Warning "corepack could not activate pnpm; falling back to npm global install."
      }
      Update-ProcessPath
    }
  }

  if (-not (Test-CommandAvailable "pnpm")) {
    Invoke-CommandLine $RootDir "npm install -g pnpm@10.32.1"
  }
}

function Ensure-Repositories {
  if (-not $SkipAppUpdate) {
    Clone-OrUpdateAppRepos
  }

  foreach ($app in $AppConfigs) {
    $path = Resolve-AppDirectory $app
    if (-not (Test-Path $path)) {
      throw "Missing repo folder: $path"
    }
  }
}

function Clone-OrUpdateAppRepos {
  Write-Step "Cloning or updating app repositories"
  foreach ($app in $AppConfigs) {
    Clone-OrUpdateApp $app
  }
}

function Clone-OrUpdateApp {
  param([object]$App)

  $target = Resolve-AppDirectory $App
  if (Test-Path (Join-Path $target ".git")) {
    Write-Host "Updating $($App.name) at $target..."
    Invoke-Checked $target "git" @("fetch", "origin")
    Invoke-Checked $target "git" @("checkout", $App.branch)
    Invoke-Checked $target "git" @("pull", "--ff-only", "origin", $App.branch)
    return
  }

  if (Test-Path $target) {
    throw "Cannot clone $($App.name); $target exists but is not a git repo."
  }

  Write-Host "Cloning $($App.name) into $target..."
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  Invoke-Checked $RootDir "git" @("clone", "--branch", $App.branch, $App.repo, $target)
}

function Resolve-AppDirectory {
  param([object]$App)

  $key = $App.id
  if ($ResolvedAppDirs.ContainsKey($key)) {
    return $ResolvedAppDirs[$key]
  }

  $candidates = New-Object System.Collections.Generic.List[string]
  $configuredPath = Join-Path $RootDir $App.path
  $repoFolder = Get-RepoFolderName $App

  if ($AppsRoot) {
    $appsRootPath = Resolve-RequiredDirectory $AppsRoot "AppsRoot"
    $candidates.Add((Join-Path $appsRootPath $repoFolder))
    $candidates.Add((Join-Path $appsRootPath $App.path))
  }

  $suiteParent = Split-Path -Parent $RootDir
  $candidates.Add((Join-Path $suiteParent $repoFolder))
  $candidates.Add($configuredPath)

  foreach ($candidate in $candidates) {
    if (Test-Path (Join-Path $candidate ".git")) {
      $resolved = (Resolve-Path $candidate).Path
      $ResolvedAppDirs[$key] = $resolved
      Write-Host "Using $($App.name) repo: $resolved"
      return $resolved
    }
  }

  if (Test-Path $configuredPath) {
    $resolved = (Resolve-Path $configuredPath).Path
    $ResolvedAppDirs[$key] = $resolved
    return $resolved
  }

  $ResolvedAppDirs[$key] = $configuredPath
  return $configuredPath
}

function Resolve-RequiredDirectory {
  param(
    [string]$Path,
    [string]$Label
  )

  if (-not (Test-Path $Path)) {
    throw "$Label does not exist: $Path"
  }

  return (Resolve-Path $Path).Path
}

function Get-RepoFolderName {
  param([object]$App)

  $repoName = [System.IO.Path]::GetFileNameWithoutExtension(([string]$App.repo).TrimEnd("/"))
  if ([string]::IsNullOrWhiteSpace($repoName)) {
    return $App.id
  }
  return $repoName
}

function Install-Dependencies {
  if ($SkipDependencyInstall) {
    return
  }

  foreach ($app in $AppConfigs) {
    Write-Step "Installing $($app.name) dependencies"
    Invoke-CommandLine (Resolve-AppDirectory $app) $app.dependencyInstallCommand
  }
}

function Build-Installers {
  if ($SkipBuild) {
    return
  }

  foreach ($app in $AppConfigs) {
    Write-Step "Building $($app.name) Windows artifacts"
    Invoke-CommandLine (Resolve-AppDirectory $app) $app.windowsDistCommand
  }
}

function Copy-Artifacts {
  Write-Step "Collecting Windows artifacts"
  $installersDir = Join-Path $ArtifactDir "installers"
  $scriptsDir = Join-Path $ArtifactDir "scripts"
  $contractDir = Join-Path $ArtifactDir "suite"
  New-Item -ItemType Directory -Force -Path $installersDir, $scriptsDir, $contractDir | Out-Null

  foreach ($app in $AppConfigs) {
    Copy-ProjectArtifacts $app $app.artifactFolder @($app.windowsArtifactPatterns)
  }

  Copy-Item -Force (Join-Path $RootDir "suite\contract.json") (Join-Path $contractDir "contract.json")
  Copy-Item -Force (Join-Path $ScriptDir "Launch-VaexcoreSuite.ps1") (Join-Path $scriptsDir "Launch-VaexcoreSuite.ps1")
  Copy-Item -Force (Join-Path $ScriptDir "Launch-VaexcoreApp.ps1") (Join-Path $scriptsDir "Launch-VaexcoreApp.ps1")
  Copy-Item -Force (Join-Path $ScriptDir "Install-VaexcoreLaunchers.ps1") (Join-Path $scriptsDir "Install-VaexcoreLaunchers.ps1")
  Copy-Item -Force (Join-Path $ScriptDir "Test-VaexcoreWindowsPrerequisites.ps1") (Join-Path $scriptsDir "Test-VaexcoreWindowsPrerequisites.ps1")
  Copy-Item -Force (Join-Path $ScriptDir "Test-VaexcoreWindowsSuite.ps1") (Join-Path $scriptsDir "Test-VaexcoreWindowsSuite.ps1")
  foreach ($launcher in @(
    "Install-VaexcoreLaunchers.cmd",
    "Install-VaexcoreLaunchers.vbs",
    "Start-VaexcoreSuite.cmd",
    "Start-VaexcoreSuite.vbs",
    "Start-VaexcoreStudio.cmd",
    "Start-VaexcoreStudio.vbs",
    "Start-VaexcorePulse.cmd",
    "Start-VaexcorePulse.vbs",
    "Start-VaexcoreConsole.cmd",
    "Start-VaexcoreConsole.vbs"
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
.\scripts\Start-VaexcoreSuite.vbs
.\scripts\Test-VaexcoreWindowsPrerequisites.ps1
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
    [object]$App,
    [string]$Name,
    [string[]]$Patterns
  )

  $target = Join-Path (Join-Path $ArtifactDir "installers") $Name
  New-Item -ItemType Directory -Force -Path $target | Out-Null

  $files = @()
  foreach ($pattern in $Patterns) {
    $found = Get-ChildItem -Path (Resolve-AppArtifactPattern $App $pattern) -File -ErrorAction SilentlyContinue
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

function Resolve-AppArtifactPattern {
  param(
    [object]$App,
    [string]$Pattern
  )

  $appDir = Resolve-AppDirectory $App
  $configuredPrefix = ([string]$App.path).Replace("/", "\").TrimEnd("\")
  $normalizedPattern = $Pattern.Replace("/", "\")
  $relativePattern = $normalizedPattern

  if ($normalizedPattern -eq $configuredPrefix) {
    $relativePattern = ""
  } elseif ($normalizedPattern.StartsWith("$configuredPrefix\")) {
    $relativePattern = $normalizedPattern.Substring($configuredPrefix.Length + 1)
  }

  if ([string]::IsNullOrWhiteSpace($relativePattern)) {
    return $appDir
  }

  return Join-Path $appDir $relativePattern
}

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

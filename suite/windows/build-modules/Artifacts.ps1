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
  Copy-Item -Force (Join-Path $ScriptDir "windows-validation-plan.json") (Join-Path $contractDir "windows-validation-plan.json")
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

Windows validation plan:

```text
suite\windows-validation-plan.json
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

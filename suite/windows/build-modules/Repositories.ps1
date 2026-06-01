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

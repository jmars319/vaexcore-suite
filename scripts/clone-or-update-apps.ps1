[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RootDir = Resolve-Path (Join-Path (Split-Path -Parent $PSCommandPath) "..")

function Invoke-Checked {
  param(
    [string]$WorkingDirectory,
    [string]$FilePath,
    [string[]]$Arguments
  )

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

function Clone-OrUpdate {
  param(
    [string]$Name,
    [string]$Repo,
    [string]$Path,
    [string]$Branch
  )

  $target = Join-Path $RootDir $Path
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

$AppsConfig = Get-Content -Raw (Join-Path $RootDir "apps.json") | ConvertFrom-Json
foreach ($app in $AppsConfig.apps) {
  Clone-OrUpdate $app.name $app.repo $app.path $app.branch
}

Write-Host "vaexcore app repos are current." -ForegroundColor Green

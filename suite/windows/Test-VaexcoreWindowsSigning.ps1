[CmdletBinding()]
param(
  [string]$AppsRoot,
  [switch]$IncludeBuildArtifacts,
  [switch]$FailOnUnsigned
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $PSCommandPath
if ([string]::IsNullOrWhiteSpace($AppsRoot)) {
  $AppsRoot = (Resolve-Path (Join-Path $ScriptDir "..\..\..")).Path
} else {
  $AppsRoot = (Resolve-Path $AppsRoot).Path
}

function Add-Target {
  param(
    [System.Collections.Generic.List[object]]$Targets,
    [string]$Name,
    [string]$Path
  )

  $Targets.Add([pscustomobject]@{
    Name = $Name
    Path = $Path
  }) | Out-Null
}

function Add-ArtifactTargets {
  param(
    [System.Collections.Generic.List[object]]$Targets,
    [string]$Name,
    [string]$Pattern
  )

  $matches = @(Get-ChildItem -Path $Pattern -File -ErrorAction SilentlyContinue)
  foreach ($match in $matches) {
    Add-Target $Targets $Name $match.FullName
  }
}

function Add-DirectoryTargets {
  param(
    [System.Collections.Generic.List[object]]$Targets,
    [string]$Name,
    [string]$Directory
  )

  if (-not (Test-Path -LiteralPath $Directory)) {
    Add-Target $Targets $Name $Directory
    return
  }

  $signableExtensions = @(".exe", ".dll", ".node", ".msi")
  $matches = @(Get-ChildItem -LiteralPath $Directory -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $signableExtensions.Contains($_.Extension.ToLowerInvariant()) })
  if ($matches.Count -eq 0) {
    Add-Target $Targets $Name $Directory
    return
  }

  foreach ($match in $matches) {
    Add-Target $Targets "$Name $($match.Name)" $match.FullName
  }
}

function Test-TargetSignature {
  param(
    [string]$Name,
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return [pscustomobject]@{
      Name = $Name
      State = "missing"
      Status = "Missing"
      Signer = ""
      Path = $Path
    }
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  $signer = if ($signature.SignerCertificate) {
    $signature.SignerCertificate.Subject
  } else {
    ""
  }

  $state = if ($signature.Status -eq "Valid") {
    "pass"
  } else {
    "fail"
  }

  return [pscustomobject]@{
    Name = $Name
    State = $state
    Status = [string]$signature.Status
    Signer = $signer
    Path = $Path
  }
}

$targets = New-Object System.Collections.Generic.List[object]

Add-DirectoryTargets $targets "Console installed" (Join-Path $env:LOCALAPPDATA "Programs\vaexcore console")
Add-DirectoryTargets $targets "Studio installed" (Join-Path $env:LOCALAPPDATA "vaexcore studio")
Add-DirectoryTargets $targets "Pulse installed" (Join-Path $env:LOCALAPPDATA "vaexcore pulse")

if ($IncludeBuildArtifacts) {
  Add-ArtifactTargets $targets "Console setup artifact" (Join-Path $AppsRoot "vaexcore-console\release\vaexcore-console-*-setup.exe")
  Add-ArtifactTargets $targets "Console portable artifact" (Join-Path $AppsRoot "vaexcore-console\release\vaexcore-console-*-portable.exe")
  Add-Target $targets "Studio release EXE" (Join-Path $AppsRoot "vaexcore-studio\target\release\vaexcore-studio.exe")
  Add-Target $targets "Studio media runner" (Join-Path $AppsRoot "vaexcore-studio\target\release\media-runner.exe")
  Add-ArtifactTargets $targets "Studio installer artifact" (Join-Path $AppsRoot "vaexcore-studio\target\release\bundle\nsis\*.exe")
  Add-Target $targets "Pulse release EXE" (Join-Path $AppsRoot "vaexcore-pulse\apps\desktopapp\src-tauri\target\release\vaexcore-pulse.exe")
  Add-ArtifactTargets $targets "Pulse installer artifact" (Join-Path $AppsRoot "vaexcore-pulse\apps\desktopapp\src-tauri\target\release\bundle\nsis\*.exe")
}

$uniqueTargets = $targets | Sort-Object Path -Unique
$results = foreach ($target in $uniqueTargets) {
  Test-TargetSignature $target.Name $target.Path
}

$results | Sort-Object Name, Path | Format-Table Name, State, Status, Signer, Path -AutoSize

$failures = @($results | Where-Object { $_.State -eq "fail" })
$missing = @($results | Where-Object { $_.State -eq "missing" })

if ($failures.Count -gt 0) {
  Write-Host ""
  Write-Host "Windows signing check found unsigned or untrusted files." -ForegroundColor Yellow
  Write-Host "Sign every shipped EXE and installer with the same trusted publisher identity before public Windows distribution."
  if ($FailOnUnsigned) {
    exit 1
  }
}

if ($missing.Count -gt 0) {
  Write-Host ""
  Write-Host "Some targets were missing. Install/build those apps before treating this as a complete signing check." -ForegroundColor Yellow
}

if ($failures.Count -eq 0 -and $missing.Count -eq 0) {
  Write-Host ""
  Write-Host "Windows signing check passed." -ForegroundColor Green
}

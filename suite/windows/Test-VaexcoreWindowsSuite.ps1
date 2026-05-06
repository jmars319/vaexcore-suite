[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$SuiteDir = Join-Path $env:APPDATA "vaexcore\suite"
$Expected = @(
  "vaexcore-studio.json",
  "vaexcore-pulse.json",
  "vaexcore-console.json"
)

Write-Host "Suite discovery: $SuiteDir"

if (-not (Test-Path $SuiteDir)) {
  Write-Warning "Suite discovery folder does not exist yet. Launch the apps first."
  exit 1
}

$status = 0
foreach ($file in $Expected) {
  $path = Join-Path $SuiteDir $file
  if (-not (Test-Path $path)) {
    Write-Warning "Missing heartbeat: $file"
    $status = 1
    continue
  }

  $json = Get-Content -Raw $path | ConvertFrom-Json
  $age = (Get-Date) - (Get-Item $path).LastWriteTime
  $state = if ($json.localRuntime) { $json.localRuntime.state } else { "unknown" }
  Write-Host "$file app=$($json.appName) pid=$($json.pid) age=$([int]$age.TotalSeconds)s localRuntime=$state"
}

exit $status


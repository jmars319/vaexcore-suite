[CmdletBinding()]
param(
  [switch]$StrictHeartbeat
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Resolve-Path (Join-Path $ScriptDir "..\..")
$Contract = Get-Content -Raw (Join-Path $RootDir "suite\contract.json") | ConvertFrom-Json
$SuiteDir = Join-Path $env:APPDATA "vaexcore\suite"
$Expected = @($Contract.apps)
$HeartbeatStaleMs = [int]$Contract.discovery.heartbeatStaleMs

Write-Host "Suite discovery: $SuiteDir"

if (-not (Test-Path $SuiteDir)) {
  Write-Warning "Suite discovery folder does not exist yet. Launch the apps first."
  exit 1
}

$status = 0
foreach ($app in $Expected) {
  $file = $app.discoveryFile
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
  if ($StrictHeartbeat -and $age.TotalMilliseconds -gt $HeartbeatStaleMs) {
    Write-Warning "Stale heartbeat: $file age=$([int]$age.TotalSeconds)s max=${HeartbeatStaleMs}ms"
    $status = 1
  }
}

exit $status

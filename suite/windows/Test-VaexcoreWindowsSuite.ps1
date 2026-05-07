[CmdletBinding()]
param(
  [switch]$StrictHeartbeat
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $PSCommandPath
$ArtifactRoot = Resolve-Path (Join-Path $ScriptDir "..")
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$ContractPath = @(
  (Join-Path $ArtifactRoot "suite\contract.json"),
  (Join-Path $RepoRoot "suite\contract.json")
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($ContractPath) {
  $Contract = Get-Content -Raw $ContractPath | ConvertFrom-Json
} else {
  $ManifestPath = Join-Path $ArtifactRoot "manifest.json"
  if (-not (Test-Path $ManifestPath)) {
    throw "Could not find suite contract or manifest for heartbeat validation."
  }
  $Manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
  $Contract = [pscustomobject]@{
    apps = @($Manifest.apps)
    discovery = [pscustomobject]@{
      heartbeatStaleMs = 30000
    }
  }
}
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

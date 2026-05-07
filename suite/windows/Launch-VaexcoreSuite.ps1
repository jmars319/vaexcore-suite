[CmdletBinding()]
param(
  [switch]$ResolveOnly
)

$ErrorActionPreference = "Stop"

$Apps = @(
  "vaexcore studio",
  "vaexcore pulse",
  "vaexcore console"
)

$Launcher = Join-Path (Split-Path -Parent $PSCommandPath) "Launch-VaexcoreApp.ps1"

foreach ($app in $Apps) {
  if ($ResolveOnly) {
    & $Launcher $app -ResolveOnly
  } else {
    & $Launcher $app
  }
}

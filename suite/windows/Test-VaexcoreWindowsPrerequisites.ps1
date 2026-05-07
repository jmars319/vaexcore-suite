[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RequiredNode = [version]"22.0.0"
$RequiredPnpm = [version]"10.32.1"
$RequiredRust = [version]"1.95.0"
$RequiredPython = [version]"3.11.0"

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

function Add-Check {
  param(
    [System.Collections.Generic.List[object]]$Checks,
    [string]$Name,
    [string]$State,
    [string]$Detail,
    [string]$Fix
  )

  $Checks.Add([pscustomobject]@{
    Name = $Name
    State = $State
    Detail = $Detail
    Fix = $Fix
  }) | Out-Null
}

function Find-CommandPath {
  param([string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  return $null
}

function Find-Executable {
  param(
    [string]$Name,
    [string[]]$KnownPaths = @()
  )

  $commandPath = Find-CommandPath $Name
  if ($commandPath) {
    return $commandPath
  }

  foreach ($path in $KnownPaths) {
    if (Test-Path $path) {
      return $path
    }
  }

  return $null
}

function Invoke-VersionCommand {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  try {
    $output = & $FilePath @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) {
      return $null
    }
    return ($output | Select-Object -First 1)
  } catch {
    return $null
  }
}

function Read-Version {
  param([string]$Value)

  if (-not $Value) {
    return $null
  }

  $match = [regex]::Match($Value, "\d+(\.\d+){1,3}")
  if (-not $match.Success) {
    return $null
  }

  try {
    return [version]$match.Value
  } catch {
    return $null
  }
}

function Add-ToolVersionCheck {
  param(
    [System.Collections.Generic.List[object]]$Checks,
    [string]$Name,
    [string]$CommandName,
    [string[]]$VersionArguments,
    [version]$MinimumVersion,
    [string]$Fix
  )

  $path = Find-CommandPath $CommandName
  if (-not $path) {
    Add-Check $Checks $Name "fail" "$CommandName was not found on PATH." $Fix
    return
  }

  $rawVersion = Invoke-VersionCommand $path $VersionArguments
  $version = Read-Version $rawVersion
  if (-not $version) {
    Add-Check $Checks $Name "warn" "$path found, but version could not be parsed from '$rawVersion'." $Fix
    return
  }

  if ($version -lt $MinimumVersion) {
    Add-Check $Checks $Name "fail" "$path version $version is older than $MinimumVersion." $Fix
    return
  }

  Add-Check $Checks $Name "pass" "$path version $version." ""
}

function Test-VisualCppTools {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) {
    return $null
  }

  $installPath = & $vswhere -products * -requires Microsoft.VisualStudio.Workload.VCTools -property installationPath -latest
  if ([string]::IsNullOrWhiteSpace($installPath)) {
    return $null
  }

  return $installPath
}

function Test-WebView2Runtime {
  $paths = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\*",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\*"
  )

  foreach ($path in $paths) {
    $match = Get-ItemProperty $path -ErrorAction SilentlyContinue |
      Where-Object { $_.name -eq "Microsoft Edge WebView2 Runtime" } |
      Select-Object -First 1
    if ($match) {
      return "$($match.name) $($match.pv)"
    }
  }

  return $null
}

Update-ProcessPath

$checks = New-Object System.Collections.Generic.List[object]

$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
if ($os.Caption -match "Windows 11" -and $computer.SystemType -match "x64") {
  Add-Check $checks "Windows" "pass" "$($os.Caption) build $($os.BuildNumber), $($computer.SystemType)." ""
} else {
  Add-Check $checks "Windows" "warn" "$($os.Caption) build $($os.BuildNumber), $($computer.SystemType)." "Use Windows 11 x64 for the primary supported build path."
}

$longPaths = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -ErrorAction SilentlyContinue
if ($longPaths.LongPathsEnabled -eq 1) {
  Add-Check $checks "Long paths" "pass" "LongPathsEnabled is 1." ""
} else {
  Add-Check $checks "Long paths" "fail" "LongPathsEnabled is not enabled." "Enable Win32 long paths before building Node/Rust workspaces."
}

Add-ToolVersionCheck $checks "Node.js" "node" @("--version") $RequiredNode "Install Node.js 22 or newer."
Add-ToolVersionCheck $checks "pnpm" "pnpm" @("--version") $RequiredPnpm "Run corepack prepare pnpm@10.32.1 --activate, or install pnpm 10.32.1."
Add-ToolVersionCheck $checks "Rust cargo" "cargo" @("--version") $RequiredRust "Install Rust through rustup and let rust-toolchain.toml select 1.95.0."
Add-ToolVersionCheck $checks "Python" "python" @("--version") $RequiredPython "Install Python 3.11 or newer."

$rustup = Find-CommandPath "rustup"
if ($rustup) {
  Add-Check $checks "rustup" "pass" "$rustup found." ""
} else {
  Add-Check $checks "rustup" "fail" "rustup was not found on PATH." "Install Rust with rustup."
}

$npm = Find-CommandPath "npm"
if ($npm) {
  Add-Check $checks "npm" "pass" "$npm found." ""
} else {
  Add-Check $checks "npm" "fail" "npm was not found on PATH." "Install Node.js 22 or newer."
}

$git = Find-CommandPath "git"
if ($git) {
  Add-Check $checks "Git" "pass" "$git found." ""
} else {
  Add-Check $checks "Git" "fail" "git was not found on PATH." "Install Git for Windows."
}

$bash = Find-Executable "bash" @("C:\Program Files\Git\bin\bash.exe", "C:\Program Files\Git\usr\bin\bash.exe")
if ($bash) {
  Add-Check $checks "Git Bash" "pass" "$bash found." ""
} else {
  Add-Check $checks "Git Bash" "warn" "bash was not found." "Install Git for Windows or add Git Bash to PATH for Pulse dev scripts."
}

$ffmpeg = Find-Executable "ffmpeg" (Get-FFmpegKnownExecutablePaths "ffmpeg")
if ($ffmpeg) {
  Add-Check $checks "FFmpeg" "pass" "$ffmpeg found." ""
} else {
  Add-Check $checks "FFmpeg" "fail" "ffmpeg was not found on PATH or in standard Windows locations." "Install FFmpeg with winget/chocolatey/scoop, add it to PATH, or place it at C:\ffmpeg\bin\ffmpeg.exe."
}

$ffprobe = Find-Executable "ffprobe" (Get-FFmpegKnownExecutablePaths "ffprobe")
if ($ffprobe) {
  Add-Check $checks "FFprobe" "pass" "$ffprobe found." ""
} else {
  Add-Check $checks "FFprobe" "fail" "ffprobe was not found on PATH or in standard Windows locations." "Install the full FFmpeg build with ffprobe included."
}

$webView2 = Test-WebView2Runtime
if ($webView2) {
  Add-Check $checks "WebView2" "pass" $webView2 ""
} else {
  Add-Check $checks "WebView2" "fail" "Microsoft Edge WebView2 Runtime was not found." "Install Microsoft Edge WebView2 Runtime."
}

$vcTools = Test-VisualCppTools
if ($vcTools) {
  Add-Check $checks "VC++ tools" "pass" $vcTools ""
} else {
  Add-Check $checks "VC++ tools" "fail" "Visual Studio Build Tools C++ workload was not found." "Install Visual Studio 2022 Build Tools with Microsoft.VisualStudio.Workload.VCTools."
}

$checks | Sort-Object Name | Format-Table -AutoSize

$failed = @($checks | Where-Object { $_.State -eq "fail" })
$warned = @($checks | Where-Object { $_.State -eq "warn" })

if ($failed.Count -gt 0) {
  Write-Host ""
  Write-Host "Missing Windows prerequisites:" -ForegroundColor Red
  foreach ($item in $failed) {
    Write-Host "- $($item.Name): $($item.Fix)"
  }
  exit 1
}

if ($warned.Count -gt 0) {
  Write-Host ""
  Write-Host "Windows prerequisites passed with warnings." -ForegroundColor Yellow
  exit 0
}

Write-Host ""
Write-Host "Windows prerequisites passed." -ForegroundColor Green

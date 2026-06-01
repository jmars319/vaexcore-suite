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

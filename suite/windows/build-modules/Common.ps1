function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Checked {
  param(
    [string]$WorkingDirectory,
    [string]$FilePath,
    [string[]]$Arguments
  )

  Write-Host "[$WorkingDirectory] $FilePath $($Arguments -join ' ')"
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

function Invoke-CommandLine {
  param(
    [string]$WorkingDirectory,
    [string]$CommandLine
  )

  Write-Host "[$WorkingDirectory] $CommandLine"
  Push-Location $WorkingDirectory
  try {
    & cmd.exe /d /s /c $CommandLine
    if ($LASTEXITCODE -ne 0) {
      throw "$CommandLine exited with code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

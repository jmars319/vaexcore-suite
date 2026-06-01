function Install-Dependencies {
  if ($SkipDependencyInstall) {
    return
  }

  foreach ($app in $AppConfigs) {
    Write-Step "Installing $($app.name) dependencies"
    Invoke-CommandLine (Resolve-AppDirectory $app) $app.dependencyInstallCommand
  }
}

function Build-Installers {
  if ($SkipBuild) {
    return
  }

  foreach ($app in $AppConfigs) {
    Write-Step "Building $($app.name) Windows artifacts"
    Invoke-CommandLine (Resolve-AppDirectory $app) $app.windowsDistCommand
  }
}

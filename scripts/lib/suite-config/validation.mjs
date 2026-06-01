import { existsSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { readJsonFile } from "./files.mjs";
import {
  dependencyInstallCommandMatchesPackageManager,
  packageScriptForCommand,
} from "./package-commands.mjs";
import { appAbsolutePath, suiteRoot } from "./paths.mjs";
import { appPackageJsonPath, loadSuiteConfig } from "./apps.mjs";

export function validateSuiteConfig(options = {}) {
  const root = options.root ?? suiteRoot;
  const requireLocalRepos = Boolean(options.requireLocalRepos);
  const { appsConfig, contract, apps, services } = loadSuiteConfig(root);
  const errors = [];
  const warnings = [];

  const requireString = (value, label) => {
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`${label} must be a non-empty string.`);
      return false;
    }
    return true;
  };

  const requirePositiveInteger = (value, label) => {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`${label} must be a positive integer.`);
      return false;
    }
    return true;
  };

  const checkUnique = (values, label) => {
    const seen = new Set();
    for (const value of values) {
      if (seen.has(value)) {
        errors.push(`${label} must be unique: ${value}`);
      }
      seen.add(value);
    }
  };

  if (appsConfig.schemaVersion !== 1) {
    errors.push("apps.json schemaVersion must be 1.");
  }
  if (contract.schemaVersion !== 1) {
    errors.push("suite/contract.json schemaVersion must be 1.");
  }
  requireString(contract.suiteName, "contract.suiteName");

  if (!Array.isArray(appsConfig.apps) || appsConfig.apps.length === 0) {
    errors.push("apps.json apps must be a non-empty array.");
  }
  if (!Array.isArray(contract.apps) || contract.apps.length === 0) {
    errors.push("suite/contract.json apps must be a non-empty array.");
  }

  const appIds = (appsConfig.apps ?? []).map((app) => app.id);
  const contractIds = (contract.apps ?? []).map((app) => app.id);
  const serviceIds = (appsConfig.services ?? []).map((service) => service.id);
  const contractServiceIds = (contract.services ?? []).map(
    (service) => service.id,
  );
  checkUnique(appIds, "apps.json app ids");
  checkUnique(serviceIds, "apps.json service ids");
  checkUnique([...appIds, ...serviceIds], "project ids");
  checkUnique(contractIds, "suite contract app ids");
  checkUnique(contractServiceIds, "suite contract service ids");
  checkUnique(
    (contract.apps ?? []).map((app) => app.bundleId),
    "bundle ids",
  );
  checkUnique(
    (contract.apps ?? []).map((app) => app.discoveryFile),
    "discovery files",
  );

  for (const id of appIds) {
    if (!contractIds.includes(id)) {
      errors.push(`apps.json app ${id} is missing from suite/contract.json.`);
    }
  }
  for (const id of contractIds) {
    if (!appIds.includes(id)) {
      errors.push(`suite/contract.json app ${id} is missing from apps.json.`);
    }
  }
  for (const id of serviceIds) {
    if (!contractServiceIds.includes(id)) {
      errors.push(
        `apps.json service ${id} is missing from suite/contract.json.`,
      );
    }
  }
  for (const id of contractServiceIds) {
    if (!serviceIds.includes(id)) {
      errors.push(
        `suite/contract.json service ${id} is missing from apps.json.`,
      );
    }
  }

  requireString(
    contract.discovery?.macOSDirectory,
    "contract.discovery.macOSDirectory",
  );
  requireString(
    contract.discovery?.windowsDirectory,
    "contract.discovery.windowsDirectory",
  );
  requirePositiveInteger(
    contract.discovery?.heartbeatStaleMs,
    "contract.discovery.heartbeatStaleMs",
  );
  if (contract.discovery?.schemaVersion !== 1) {
    errors.push("contract.discovery.schemaVersion must be 1.");
  }

  requireString(
    contract.handoffs?.macOSDirectory,
    "contract.handoffs.macOSDirectory",
  );
  requireString(
    contract.handoffs?.windowsDirectory,
    "contract.handoffs.windowsDirectory",
  );
  requireString(
    contract.handoffs?.pulseRecordingIntakeFile,
    "contract.handoffs.pulseRecordingIntakeFile",
  );

  requireString(contract.markerContract?.name, "contract.markerContract.name");
  if (contract.markerContract?.schemaVersion !== 1) {
    errors.push("contract.markerContract.schemaVersion must be 1.");
  }
  const markerRequired = contract.markerContract?.requiredMetadataFields ?? [];
  for (const field of [
    "contract",
    "schemaVersion",
    "eventType",
    "source",
    "createdAt",
  ]) {
    if (!markerRequired.includes(field)) {
      errors.push(
        `contract.markerContract.requiredMetadataFields must include ${field}.`,
      );
    }
  }

  validateApps({
    apps,
    root,
    requireLocalRepos,
    requireString,
    checkUnique,
    errors,
    warnings,
  });
  validateServices({
    services,
    root,
    requireLocalRepos,
    requireString,
    checkUnique,
    errors,
    warnings,
  });

  return { errors, warnings };
}

function validateApps(context) {
  const {
    apps,
    root,
    requireLocalRepos,
    requireString,
    checkUnique,
    errors,
    warnings,
  } = context;
  const healthPorts = new Map();
  for (const app of apps) {
    const label = `app ${app.id ?? "(missing id)"}`;
    requireString(app.id, `${label}.id`);
    if (app.id && !/^vaexcore-[a-z0-9-]+$/.test(app.id)) {
      errors.push(`${label}.id must use the vaexcore-* slug format.`);
    }

    requireString(app.configName, `${label}.apps.json name`);
    requireString(app.contractName, `${label}.contract name`);
    if (
      app.configName &&
      app.contractName &&
      app.configName !== app.contractName
    ) {
      errors.push(
        `${label} name mismatch: apps.json has "${app.configName}", contract has "${app.contractName}".`,
      );
    }

    validateCommonProjectFields({
      project: app,
      label,
      root,
      requireString,
      checkUnique,
      errors,
      warnings,
    });
    validateAppArtifactFields(app, label, root, requireString, errors);
    validateAppInstallFields(app, label, healthPorts, requireString, errors);

    if (requireLocalRepos) {
      validateLocalAppRepo(app, label, root, errors);
    }
  }
}

function validateServices(context) {
  const {
    services,
    root,
    requireLocalRepos,
    requireString,
    checkUnique,
    errors,
    warnings,
  } = context;
  for (const service of services) {
    const label = `service ${service.id ?? "(missing id)"}`;
    requireString(service.id, `${label}.id`);
    if (service.id && !/^vaexcore-[a-z0-9-]+$/.test(service.id)) {
      errors.push(`${label}.id must use the vaexcore-* slug format.`);
    }
    requireString(service.configName, `${label}.apps.json name`);
    requireString(service.contractName, `${label}.contract name`);
    if (
      service.configName &&
      service.contractName &&
      service.configName !== service.contractName
    ) {
      errors.push(
        `${label} name mismatch: apps.json has "${service.configName}", contract has "${service.contractName}".`,
      );
    }
    validateCommonProjectFields({
      project: service,
      label,
      root,
      requireString,
      checkUnique,
      errors,
      warnings,
    });
    requireString(service.checkCommand, `${label}.checkCommand`);
    requireString(service.deployment, `${label}.deployment`);

    if (requireLocalRepos) {
      validateLocalServiceRepo(service, label, root, errors, warnings);
    }
  }
}

function validateCommonProjectFields(context) {
  const { project, label, root, requireString, checkUnique, errors, warnings } =
    context;
  requireString(project.repo, `${label}.repo`);
  if (
    project.repo &&
    !/^https:\/\/github\.com\/jmars319\/vaexcore-[a-z0-9-]+$/.test(
      project.repo,
    )
  ) {
    warnings.push(
      `${label}.repo is outside the expected jmars319/vaexcore-* GitHub namespace.`,
    );
  }

  requireString(project.path, `${label}.path`);
  if (
    project.path &&
    (isAbsolute(project.path) ||
      relative(root, resolve(root, project.path)).startsWith(".."))
  ) {
    errors.push(`${label}.path must stay inside the suite repository.`);
  }
  requireString(project.branch, `${label}.branch`);
  requireString(project.packageManager, `${label}.packageManager`);
  if (
    project.packageManager &&
    !["npm", "pnpm"].includes(project.packageManager)
  ) {
    errors.push(`${label}.packageManager must be npm or pnpm.`);
  }
  requireString(
    project.dependencyInstallCommand,
    `${label}.dependencyInstallCommand`,
  );
  if (
    project.packageManager &&
    project.dependencyInstallCommand &&
    !dependencyInstallCommandMatchesPackageManager(
      project.dependencyInstallCommand,
      project.packageManager,
    )
  ) {
    errors.push(
      `${label}.dependencyInstallCommand must use ${project.packageManager}.`,
    );
  }
  if (
    !Array.isArray(project.capabilities) ||
    project.capabilities.length === 0
  ) {
    errors.push(`${label}.capabilities must be a non-empty array.`);
  } else {
    checkUnique(project.capabilities, `${label}.capabilities`);
  }
}

function validateAppArtifactFields(app, label, root, requireString, errors) {
  requireString(app.macBuildCommand, `${label}.macBuildCommand`);
  requireString(app.windowsDistCommand, `${label}.windowsDistCommand`);
  requireString(app.macArtifactSearchDir, `${label}.macArtifactSearchDir`);
  if (
    app.macArtifactSearchDir &&
    (isAbsolute(app.macArtifactSearchDir) ||
      app.macArtifactSearchDir.split(/[\\/]+/).includes(".."))
  ) {
    errors.push(
      `${label}.macArtifactSearchDir must be a relative path inside the app repo.`,
    );
  }
  requireString(app.artifactFolder, `${label}.artifactFolder`);
  if (app.artifactFolder && /[\\/]/.test(app.artifactFolder)) {
    errors.push(`${label}.artifactFolder must be a single folder name.`);
  }
  if (
    !Array.isArray(app.windowsArtifactPatterns) ||
    app.windowsArtifactPatterns.length === 0
  ) {
    errors.push(`${label}.windowsArtifactPatterns must be a non-empty array.`);
  } else {
    const appWindowsPath = app.path?.replaceAll("/", "\\");
    for (const [index, pattern] of app.windowsArtifactPatterns.entries()) {
      if (!requireString(pattern, `${label}.windowsArtifactPatterns[${index}]`)) {
        continue;
      }
      if (isAbsolute(pattern) || pattern.split(/[\\/]+/).includes("..")) {
        errors.push(
          `${label}.windowsArtifactPatterns[${index}] must be relative.`,
        );
      }
      if (!pattern.includes("*")) {
        errors.push(
          `${label}.windowsArtifactPatterns[${index}] must include a wildcard.`,
        );
      }
      if (appWindowsPath && !pattern.startsWith(`${appWindowsPath}\\`)) {
        errors.push(
          `${label}.windowsArtifactPatterns[${index}] must start with ${appWindowsPath}\\.`,
        );
      }
    }
  }
}

function validateAppInstallFields(app, label, healthPorts, requireString, errors) {
  requireString(app.bundleId, `${label}.bundleId`);
  if (app.bundleId && !/^[A-Za-z0-9.-]+$/.test(app.bundleId)) {
    errors.push(`${label}.bundleId contains invalid characters.`);
  }
  requireString(app.macOSInstallPath, `${label}.macOSInstallPath`);
  if (
    app.macOSInstallPath &&
    (!app.macOSInstallPath.startsWith("/Applications/") ||
      !app.macOSInstallPath.endsWith(".app"))
  ) {
    errors.push(`${label}.macOSInstallPath must be an /Applications .app path.`);
  }
  requireString(app.windowsInstallPath, `${label}.windowsInstallPath`);
  if (
    app.windowsInstallPath &&
    !app.windowsInstallPath.toLowerCase().endsWith(".exe")
  ) {
    errors.push(`${label}.windowsInstallPath must point at an .exe.`);
  }
  const windowsExecutableName = app.windowsInstallPath?.split(/[\\/]/).pop();
  if (windowsExecutableName && windowsExecutableName !== `${app.id}.exe`) {
    errors.push(`${label}.windowsInstallPath executable must be ${app.id}.exe.`);
  }
  requireString(app.launchName, `${label}.launchName`);
  if (
    app.launchName &&
    app.macOSInstallPath &&
    basename(app.macOSInstallPath) !== `${app.launchName}.app`
  ) {
    errors.push(`${label}.macOSInstallPath basename must match launchName.`);
  }
  requireString(app.discoveryFile, `${label}.discoveryFile`);
  if (app.discoveryFile && app.discoveryFile !== `${app.id}.json`) {
    errors.push(`${label}.discoveryFile must be ${app.id}.json.`);
  }
  requireString(app.healthEndpoint, `${label}.healthEndpoint`);
  validateHealthEndpoint(app, label, healthPorts, errors);
}

function validateHealthEndpoint(app, label, healthPorts, errors) {
  if (!app.healthEndpoint) {
    return;
  }
  try {
    const url = new URL(app.healthEndpoint);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(url.hostname)
    ) {
      errors.push(`${label}.healthEndpoint must be a localhost http URL.`);
    }
    const port = url.port || "80";
    if (healthPorts.has(port)) {
      errors.push(
        `${label}.healthEndpoint port ${port} is already used by ${healthPorts.get(port)}.`,
      );
    }
    healthPorts.set(port, app.id);
  } catch {
    errors.push(`${label}.healthEndpoint must be a valid URL.`);
  }
}

function validateLocalAppRepo(app, label, root, errors) {
  const appDir = appAbsolutePath(root, app);
  if (!existsSync(join(appDir, ".git"))) {
    errors.push(`${label}.path does not point at a local git repo: ${appDir}`);
  }
  const packagePath = appPackageJsonPath(root, app);
  if (!existsSync(packagePath)) {
    errors.push(`${label} is missing package.json at ${packagePath}.`);
  } else {
    const packageJson = readJsonFile(packagePath);
    for (const [commandKey, command] of [
      ["macBuildCommand", app.macBuildCommand],
      ["windowsDistCommand", app.windowsDistCommand],
    ]) {
      validatePackageScriptReference(
        command,
        app.packageManager,
        packageJson,
        `${label}.${commandKey}`,
        errors,
      );
    }
  }
}

function validateLocalServiceRepo(service, label, root, errors, warnings) {
  const serviceDir = appAbsolutePath(root, service);
  if (!existsSync(join(serviceDir, ".git"))) {
    warnings.push(
      `${label}.path does not point at a local git repo yet: ${serviceDir}`,
    );
    return;
  }
  const packagePath = appPackageJsonPath(root, service);
  if (!existsSync(packagePath)) {
    errors.push(`${label} is missing package.json at ${packagePath}.`);
  } else {
    const packageJson = readJsonFile(packagePath);
    validatePackageScriptReference(
      service.checkCommand,
      service.packageManager,
      packageJson,
      `${label}.checkCommand`,
      errors,
    );
  }
}

function validatePackageScriptReference(
  command,
  packageManager,
  packageJson,
  label,
  errors,
) {
  const scriptName = packageScriptForCommand(command, packageManager);
  if (!scriptName) {
    errors.push(`${label} must call a ${packageManager} package script.`);
  } else if (!packageJson.scripts?.[scriptName]) {
    errors.push(`${label} references missing package script: ${scriptName}`);
  }
}

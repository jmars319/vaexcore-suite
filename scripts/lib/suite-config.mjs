import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

export const suiteRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);

export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadSuiteConfig(root = suiteRoot) {
  const appsConfig = readJsonFile(join(root, "apps.json"));
  const contract = readJsonFile(join(root, "suite/contract.json"));
  const contractById = new Map(
    (contract.apps ?? []).map((app) => [app.id, app]),
  );
  const serviceContractById = new Map(
    (contract.services ?? []).map((service) => [service.id, service]),
  );
  const apps = (appsConfig.apps ?? []).map((app) => {
    const contractApp = contractById.get(app.id);
    return {
      ...app,
      ...(contractApp ?? {}),
      configName: app.name,
      contractName: contractApp?.name,
      contractApp,
    };
  });
  const services = (appsConfig.services ?? []).map((service) => {
    const contractService = serviceContractById.get(service.id);
    return {
      ...service,
      ...(contractService ?? {}),
      configName: service.name,
      contractName: contractService?.name,
      contractService,
    };
  });

  return { root, appsConfig, contract, apps, services };
}

export function appById(config, id) {
  return config.apps.find((app) => app.id === id);
}

export function appAbsolutePath(root, app) {
  return resolve(root, app.path);
}

export function appPackageJsonPath(root, app) {
  return join(appAbsolutePath(root, app), "package.json");
}

export function appVersion(root, app) {
  const packagePath = appPackageJsonPath(root, app);
  if (!existsSync(packagePath)) {
    return null;
  }
  return readJsonFile(packagePath).version ?? null;
}

export function gitSha(path) {
  try {
    return execFileSync("git", ["-C", path, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function gitDirty(path) {
  try {
    return (
      execFileSync("git", ["-C", path, "status", "--short"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim().length > 0
    );
  } catch {
    return null;
  }
}

export function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

export function fileSize(path) {
  return statSync(path).size;
}

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

    requireString(app.repo, `${label}.repo`);
    if (
      app.repo &&
      !/^https:\/\/github\.com\/jmars319\/vaexcore-[a-z0-9-]+$/.test(app.repo)
    ) {
      warnings.push(
        `${label}.repo is outside the expected jmars319/vaexcore-* GitHub namespace.`,
      );
    }

    requireString(app.path, `${label}.path`);
    if (
      app.path &&
      (isAbsolute(app.path) ||
        relative(root, resolve(root, app.path)).startsWith(".."))
    ) {
      errors.push(`${label}.path must stay inside the suite repository.`);
    }
    requireString(app.branch, `${label}.branch`);
    requireString(app.packageManager, `${label}.packageManager`);
    if (app.packageManager && !["npm", "pnpm"].includes(app.packageManager)) {
      errors.push(`${label}.packageManager must be npm or pnpm.`);
    }
    requireString(
      app.dependencyInstallCommand,
      `${label}.dependencyInstallCommand`,
    );
    if (
      app.packageManager &&
      app.dependencyInstallCommand &&
      !dependencyInstallCommandMatchesPackageManager(
        app.dependencyInstallCommand,
        app.packageManager,
      )
    ) {
      errors.push(
        `${label}.dependencyInstallCommand must use ${app.packageManager}.`,
      );
    }
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
      errors.push(
        `${label}.windowsArtifactPatterns must be a non-empty array.`,
      );
    } else {
      const appWindowsPath = app.path?.replaceAll("/", "\\");
      for (const [index, pattern] of app.windowsArtifactPatterns.entries()) {
        if (
          !requireString(pattern, `${label}.windowsArtifactPatterns[${index}]`)
        ) {
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
      errors.push(
        `${label}.macOSInstallPath must be an /Applications .app path.`,
      );
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
      errors.push(
        `${label}.windowsInstallPath executable must be ${app.id}.exe.`,
      );
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
    if (app.healthEndpoint) {
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
    if (!Array.isArray(app.capabilities) || app.capabilities.length === 0) {
      errors.push(`${label}.capabilities must be a non-empty array.`);
    } else {
      checkUnique(app.capabilities, `${label}.capabilities`);
    }

    if (requireLocalRepos) {
      const appDir = appAbsolutePath(root, app);
      if (!existsSync(join(appDir, ".git"))) {
        errors.push(
          `${label}.path does not point at a local git repo: ${appDir}`,
        );
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
          const scriptName = packageScriptForCommand(
            command,
            app.packageManager,
          );
          if (!scriptName) {
            errors.push(
              `${label}.${commandKey} must call a ${app.packageManager} package script.`,
            );
          } else if (!packageJson.scripts?.[scriptName]) {
            errors.push(
              `${label}.${commandKey} references missing package script: ${scriptName}`,
            );
          }
        }
      }
    }
  }

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
    requireString(service.repo, `${label}.repo`);
    if (
      service.repo &&
      !/^https:\/\/github\.com\/jmars319\/vaexcore-[a-z0-9-]+$/.test(
        service.repo,
      )
    ) {
      warnings.push(
        `${label}.repo is outside the expected jmars319/vaexcore-* GitHub namespace.`,
      );
    }
    requireString(service.path, `${label}.path`);
    if (
      service.path &&
      (isAbsolute(service.path) ||
        relative(root, resolve(root, service.path)).startsWith(".."))
    ) {
      errors.push(`${label}.path must stay inside the suite repository.`);
    }
    requireString(service.branch, `${label}.branch`);
    requireString(service.packageManager, `${label}.packageManager`);
    if (
      service.packageManager &&
      !["npm", "pnpm"].includes(service.packageManager)
    ) {
      errors.push(`${label}.packageManager must be npm or pnpm.`);
    }
    requireString(
      service.dependencyInstallCommand,
      `${label}.dependencyInstallCommand`,
    );
    if (
      service.packageManager &&
      service.dependencyInstallCommand &&
      !dependencyInstallCommandMatchesPackageManager(
        service.dependencyInstallCommand,
        service.packageManager,
      )
    ) {
      errors.push(
        `${label}.dependencyInstallCommand must use ${service.packageManager}.`,
      );
    }
    requireString(service.checkCommand, `${label}.checkCommand`);
    requireString(service.deployment, `${label}.deployment`);
    if (
      !Array.isArray(service.capabilities) ||
      service.capabilities.length === 0
    ) {
      errors.push(`${label}.capabilities must be a non-empty array.`);
    } else {
      checkUnique(service.capabilities, `${label}.capabilities`);
    }

    if (requireLocalRepos) {
      const serviceDir = appAbsolutePath(root, service);
      if (!existsSync(join(serviceDir, ".git"))) {
        warnings.push(
          `${label}.path does not point at a local git repo yet: ${serviceDir}`,
        );
        continue;
      }
      const packagePath = appPackageJsonPath(root, service);
      if (!existsSync(packagePath)) {
        errors.push(`${label} is missing package.json at ${packagePath}.`);
      } else {
        const packageJson = readJsonFile(packagePath);
        const scriptName = packageScriptForCommand(
          service.checkCommand,
          service.packageManager,
        );
        if (!scriptName) {
          errors.push(
            `${label}.checkCommand must call a ${service.packageManager} package script.`,
          );
        } else if (!packageJson.scripts?.[scriptName]) {
          errors.push(
            `${label}.checkCommand references missing package script: ${scriptName}`,
          );
        }
      }
    }
  }

  return { errors, warnings };
}

function dependencyInstallCommandMatchesPackageManager(
  command,
  packageManager,
) {
  const parts = shellWords(command);
  if (packageManager === "npm") {
    return parts[0] === "npm" && ["ci", "install"].includes(parts[1]);
  }
  if (packageManager === "pnpm") {
    return parts[0] === "pnpm" && parts[1] === "install";
  }
  return false;
}

function packageScriptForCommand(command, packageManager) {
  const parts = shellWords(command);
  if (
    packageManager === "npm" &&
    parts[0] === "npm" &&
    parts[1] === "run" &&
    parts[2]
  ) {
    return parts[2];
  }
  if (packageManager === "pnpm" && parts[0] === "pnpm") {
    if (parts[1] === "run" && parts[2]) {
      return parts[2];
    }
    if (parts[1] && !parts[1].startsWith("-") && parts[1] !== "install") {
      return parts[1];
    }
  }
  return null;
}

function shellWords(command) {
  return String(command ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function expandedMacDirectory(value) {
  if (!value.startsWith("~/")) {
    return value;
  }
  return join(process.env.HOME ?? "", value.slice(2));
}

export function dirnameForUrl(importMetaUrl) {
  return dirname(fileURLToPath(importMetaUrl));
}

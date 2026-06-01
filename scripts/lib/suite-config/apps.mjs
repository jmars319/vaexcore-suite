import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJsonFile } from "./files.mjs";
import { appAbsolutePath, suiteRoot } from "./paths.mjs";

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

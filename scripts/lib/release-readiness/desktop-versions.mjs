import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appAbsolutePath, suiteRoot } from "../suite-config.mjs";

export function readDesktopVersions(app) {
  const appRoot = appAbsolutePath(suiteRoot, app);
  const versions = {};
  const tauriCandidates = [
    join(appRoot, "apps/desktop/src-tauri/tauri.conf.json"),
    join(appRoot, "apps/desktopapp/src-tauri/tauri.conf.json"),
  ];
  for (const path of tauriCandidates) {
    if (existsSync(path)) {
      versions.tauri = JSON.parse(readFileSync(path, "utf8")).version ?? null;
    }
  }
  const cargoCandidates = [
    join(appRoot, "apps/desktop/src-tauri/Cargo.toml"),
    join(appRoot, "apps/desktopapp/src-tauri/Cargo.toml"),
  ];
  for (const path of cargoCandidates) {
    if (existsSync(path)) {
      versions.cargo =
        readFileSync(path, "utf8").match(/^version = "([^"]+)"/m)?.[1] ??
        null;
    }
  }
  return versions;
}

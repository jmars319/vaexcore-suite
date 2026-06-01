import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const suiteRoot = resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
);

export function appAbsolutePath(root, app) {
  return resolve(root, app.path);
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

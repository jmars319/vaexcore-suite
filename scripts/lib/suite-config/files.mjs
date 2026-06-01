import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

export function fileSize(path) {
  return statSync(path).size;
}

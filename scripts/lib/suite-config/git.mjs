import { execFileSync } from "node:child_process";

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

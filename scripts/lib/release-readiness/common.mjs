import { execFileSync } from "node:child_process";
import { suiteRoot } from "../suite-config.mjs";

export function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ");
}

export function outputTail(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-12)
    .join("\n");
}

export function relativePath(path) {
  return path.startsWith(suiteRoot) ? path.slice(suiteRoot.length + 1) : path;
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function runNode(argsForNode) {
  try {
    return {
      ok: true,
      output: execFileSync("node", argsForNode, {
        cwd: suiteRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

export function git(repoPath, argsForGit, allowFailure = false) {
  try {
    return execFileSync("git", ["-C", repoPath, ...argsForGit], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    if (allowFailure) {
      return "";
    }
    throw error;
  }
}

export function redact(value) {
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
      .replace(/(token|secret|authorization)=([^&\s]+)/gi, "$1=[redacted]");
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /token|secret|authorization|stream_key/i.test(key)
          ? "[redacted]"
          : redact(item),
      ]),
    );
  }
  return value;
}

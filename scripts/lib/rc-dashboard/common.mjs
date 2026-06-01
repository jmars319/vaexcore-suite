import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { suiteRoot } from "../suite-config.mjs";

export function runCommand(command, argsForCommand, options = {}) {
  const started = Date.now();
  try {
    const stdout = execFileSync(command, argsForCommand, {
      cwd: options.cwd ?? suiteRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      ok: true,
      durationMs: Date.now() - started,
      stdout,
      stderr: "",
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? error.message ?? error),
    };
  }
}

export function readOptionalJson(path) {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function parseJsonOutput(output) {
  const text = String(output ?? "").trim();
  if (!text) {
    return null;
  }
  const start = text.indexOf("{");
  if (start < 0) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

export function outputTail(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-14)
    .join("\n");
}

export function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ");
}

export function relativeToSuite(path) {
  const resolved = resolve(path);
  return resolved.startsWith(suiteRoot)
    ? relative(suiteRoot, resolved).replaceAll("\\", "/")
    : resolved;
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

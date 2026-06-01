export function dependencyInstallCommandMatchesPackageManager(
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

export function packageScriptForCommand(command, packageManager) {
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

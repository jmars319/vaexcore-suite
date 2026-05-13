#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  appAbsolutePath,
  loadSuiteConfig,
  readJsonFile,
  suiteRoot,
} from "./lib/suite-config.mjs";

const node = process.execPath;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const reportPath = join(suiteRoot, ".local/bot-readiness-report.json");
const config = loadSuiteConfig();
const consoleProject = config.apps.find((app) => app.id === "vaexcore-console");
const relayProject = config.services.find(
  (service) => service.id === "vaexcore-relay",
);
const commands = [];
const checks = [];

if (!consoleProject) {
  checks.push(
    fail("console-config", "vaexcore-console is missing from apps.json."),
  );
} else {
  const consolePath = appAbsolutePath(suiteRoot, consoleProject);
  checks.push(pathCheck("console-path", "Console repo path", consolePath));
  checks.push(packageScriptCheck(consolePath, "bot:readiness"));
  commands.push(
    runCommand("Console bot readiness", consolePath, npm, [
      "run",
      "bot:readiness",
    ]),
  );
}

if (!relayProject) {
  checks.push(
    fail("relay-config", "vaexcore-relay is missing from apps.json services."),
  );
} else {
  const relayPath = appAbsolutePath(suiteRoot, relayProject);
  checks.push(pathCheck("relay-path", "Relay repo path", relayPath));
  checks.push(packageScriptCheck(relayPath, "ci"));
  checks.push(
    relayProject.deployment === "cloudflare-worker"
      ? pass(
          "relay-deployment",
          "Relay is registered as a Cloudflare Worker service.",
        )
      : fail(
          "relay-deployment",
          "Relay service deployment should be cloudflare-worker.",
        ),
  );
  commands.push(runCommand("Relay CI", relayPath, npm, ["run", "ci"]));
}

commands.push(
  runCommand("Suite config validation", suiteRoot, node, [
    "scripts/validate-suite-config.mjs",
    "--require-local-repos",
  ]),
  runCommand("Suite repo checks", suiteRoot, node, [
    "scripts/check-suite-repos.mjs",
  ]),
  runCommand("Suite service checks", suiteRoot, node, [
    "scripts/check-suite-services.mjs",
  ]),
  runCommand("Suite protocol check", suiteRoot, node, [
    "scripts/generate-suite-protocol.mjs",
    "--check",
  ]),
);

checks.push(...windowsHandoffChecks(config));

const consoleOutput = commands.find(
  (command) => command.name === "Console bot readiness",
)?.stdout;
const todoCount = countMatches(consoleOutput ?? "", /^- TODO /gm);
const warnCount = countMatches(consoleOutput ?? "", /^- WARN /gm);
const failedCommands = commands.filter((command) => command.status !== "pass");
const failedChecks = checks.filter((check) => check.status !== "pass");

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  summary: {
    status:
      failedCommands.length || failedChecks.length
        ? "failed"
        : "pass-with-todos",
    todoCount,
    warnCount,
    failedCommandCount: failedCommands.length,
    failedCheckCount: failedChecks.length,
  },
  checks,
  commands: commands.map((command) => ({
    name: command.name,
    cwd: relativeToSuite(command.cwd),
    status: command.status,
    durationMs: command.durationMs,
    stdoutTail: tail(command.stdout),
    stderrTail: tail(command.stderr),
  })),
  handoff: {
    phase6Required: true,
    remainingLiveActions: [
      "Add Twitch callback URL in the Twitch Developer Console.",
      "Complete bot and broadcaster OAuth grants.",
      "Register Twitch EventSub from Console.",
      "Send a Relay test chat message and confirm Twitch lists vaexcorebot as Chat Bot.",
      "Set Discord Worker secrets and Interactions Endpoint.",
      "Register Discord slash commands and test /suggest plus announcement commands.",
    ],
  },
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(redact(report), null, 2)}\n`);

console.log("VaexCore bot readiness aggregation");
console.log(`Report: ${relativeToSuite(reportPath)}`);
console.log(
  `Summary: ${commands.length - failedCommands.length}/${commands.length} commands passed, ${checks.length - failedChecks.length}/${checks.length} static checks passed, ${todoCount} credential/live TODOs, ${warnCount} warnings.`,
);

if (failedCommands.length || failedChecks.length) {
  for (const check of failedChecks) {
    console.error(`error: ${check.id}: ${check.detail}`);
  }
  for (const command of failedCommands) {
    console.error(`error: ${command.name} failed`);
    if (command.stderr) console.error(tail(command.stderr));
    if (command.stdout) console.error(tail(command.stdout));
  }
  process.exit(1);
}

console.log(
  "Bot code readiness checks passed. Remaining TODOs are credential, portal, deployment, or live-service validation actions.",
);

function runCommand(name, cwd, command, args) {
  const started = Date.now();
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      name,
      cwd,
      status: "pass",
      durationMs: Date.now() - started,
      stdout,
      stderr: "",
    };
  } catch (error) {
    return {
      name,
      cwd,
      status: "fail",
      durationMs: Date.now() - started,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? error.message ?? error),
    };
  }
}

function windowsHandoffChecks({ apps, services }) {
  const consoleApp = apps.find((app) => app.id === "vaexcore-console");
  const relay = services.find((service) => service.id === "vaexcore-relay");
  return [
    consoleApp?.path === "console"
      ? pass(
          "windows-console-path",
          "Console repo path is normalized to console.",
        )
      : fail("windows-console-path", "Console repo path must be console."),
    relay?.path === "relay"
      ? pass("windows-relay-path", "Relay service path is relay.")
      : fail("windows-relay-path", "Relay service path must be relay."),
    relay?.checkCommand === "npm run ci"
      ? pass(
          "relay-check-command",
          "Relay service check command is npm run ci.",
        )
      : fail(
          "relay-check-command",
          "Relay service check command must be npm run ci.",
        ),
    relay?.remoteOptional === true
      ? pass(
          "relay-not-packaged",
          "Relay is registered as a service and is not packaged as a desktop app.",
        )
      : fail(
          "relay-not-packaged",
          "Relay should be remoteOptional service metadata.",
        ),
    browserSetupUrlsCanBeGenerated()
      ? pass(
          "setup-url-generation",
          "Browser setup URLs can be generated from Relay base URL plus installation ID.",
        )
      : fail("setup-url-generation", "Relay setup URL generation failed."),
  ];
}

function browserSetupUrlsCanBeGenerated() {
  const baseUrl = "https://relay.vaexil.tv";
  const installationId = "00000000-0000-4000-8000-000000000000";
  const callback = `${baseUrl}/oauth/twitch/callback`;
  const bot = `${baseUrl}/oauth/twitch/start?installationId=${encodeURIComponent(installationId)}&kind=bot`;
  const broadcaster = `${baseUrl}/oauth/twitch/start?installationId=${encodeURIComponent(installationId)}&kind=broadcaster`;
  const discord = `${baseUrl}/webhooks/discord/interactions`;
  return [callback, bot, broadcaster, discord].every((url) =>
    /^https:\/\/relay\.vaexil\.tv\//.test(url),
  );
}

function pathCheck(id, label, path) {
  return existsSync(join(path, ".git"))
    ? pass(id, `${label} is a local git repo at ${relativeToSuite(path)}.`)
    : fail(id, `${label} is not a local git repo at ${relativeToSuite(path)}.`);
}

function packageScriptCheck(projectPath, scriptName) {
  const packagePath = join(projectPath, "package.json");
  if (!existsSync(packagePath)) {
    return fail(
      `${scriptName}-script`,
      `${relativeToSuite(projectPath)} is missing package.json.`,
    );
  }
  const packageJson = readJsonFile(packagePath);
  return packageJson.scripts?.[scriptName]
    ? pass(
        `${scriptName}-script`,
        `${relativeToSuite(projectPath)} has npm script ${scriptName}.`,
      )
    : fail(
        `${scriptName}-script`,
        `${relativeToSuite(projectPath)} is missing npm script ${scriptName}.`,
      );
}

function pass(id, detail) {
  return { id, status: "pass", detail };
}

function fail(id, detail) {
  return { id, status: "fail", detail };
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function tail(value, max = 1400) {
  const clean = redact(String(value ?? ""));
  return clean.length > max ? clean.slice(-max) : clean;
}

function relativeToSuite(path) {
  return resolve(path).startsWith(suiteRoot)
    ? path.replace(`${suiteRoot}/`, "")
    : path;
}

function redact(value) {
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
      .replace(
        /(console token|client secret|bot token)([^:\n]*):[^\n]*/gi,
        "$1$2: [redacted]",
      );
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /token|secret|authorization/i.test(key) ? "[redacted]" : redact(item),
      ]),
    );
  }
  return value;
}

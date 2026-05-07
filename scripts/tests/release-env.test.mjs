import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { suiteRoot } from "../lib/suite-config.mjs";

const baseEnv = {
  ...process.env,
  VAEXCORE_MAC_SIGN: "",
  VAEXCORE_MAC_SIGNING_IDENTITY: "",
  VAEXCORE_MAC_NOTARIZE: "",
  VAEXCORE_APPLE_ID: "",
  VAEXCORE_APPLE_APP_SPECIFIC_PASSWORD: "",
  VAEXCORE_APPLE_TEAM_ID: "",
};

test("release env check allows unsigned local artifact validation", () => {
  const output = execFileSync("node", ["scripts/check-release-env.mjs"], {
    cwd: suiteRoot,
    env: baseEnv,
    encoding: "utf8",
  });

  assert.match(output, /signing and notarization are disabled/);
});

test("release env check requires signing identity when signing is enabled", () => {
  const output = failedReleaseEnv({
    ...baseEnv,
    VAEXCORE_MAC_SIGN: "1",
  });

  assert.match(output, /VAEXCORE_MAC_SIGNING_IDENTITY is required/);
});

test("release env check validates notarization credentials", () => {
  const missing = failedReleaseEnv({
    ...baseEnv,
    VAEXCORE_MAC_NOTARIZE: "1",
  });
  assert.match(missing, /VAEXCORE_MAC_SIGNING_IDENTITY is required/);
  assert.match(missing, /VAEXCORE_APPLE_ID is required/);
  assert.match(missing, /VAEXCORE_APPLE_APP_SPECIFIC_PASSWORD is required/);
  assert.match(missing, /VAEXCORE_APPLE_TEAM_ID is required/);

  const malformed = failedReleaseEnv({
    ...baseEnv,
    VAEXCORE_MAC_NOTARIZE: "1",
    VAEXCORE_MAC_SIGNING_IDENTITY: "Developer ID Application: Example",
    VAEXCORE_APPLE_ID: "not-an-email",
    VAEXCORE_APPLE_APP_SPECIFIC_PASSWORD: "abcd efgh",
    VAEXCORE_APPLE_TEAM_ID: "SHORT",
  });
  assert.match(malformed, /Apple ID email address/);
  assert.match(malformed, /10-character Apple team id/);
  assert.match(malformed, /must not contain whitespace/);
});

test("release env check accepts complete notarization credentials", () => {
  const output = execFileSync("node", ["scripts/check-release-env.mjs"], {
    cwd: suiteRoot,
    env: {
      ...baseEnv,
      VAEXCORE_MAC_NOTARIZE: "1",
      VAEXCORE_MAC_SIGNING_IDENTITY: "Developer ID Application: Example Org (TEAMID1234)",
      VAEXCORE_APPLE_ID: "developer@example.com",
      VAEXCORE_APPLE_APP_SPECIFIC_PASSWORD: "abcd-efgh-ijkl-mnop",
      VAEXCORE_APPLE_TEAM_ID: "TEAMID1234",
    },
    encoding: "utf8",
  });

  assert.match(output, /complete for signing and notarization/);
});

function failedReleaseEnv(env) {
  try {
    execFileSync("node", ["scripts/check-release-env.mjs"], {
      cwd: suiteRoot,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.fail("release env check unexpectedly passed");
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

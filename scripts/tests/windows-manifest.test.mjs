import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { suiteRoot } from "../lib/suite-config.mjs";

test("windows manifest generation normalizes paths and validates checksums", () => {
  const dir = mkdtempSync(join(tmpdir(), "vaexcore-windows-manifest-"));
  mkdirSync(join(dir, "installers", "nested"), { recursive: true });
  const installer = join(dir, "installers", "nested", "vaexcore-console-0.1.2-x64.exe");
  writeFileSync(installer, "installer\n");

  execFileSync("node", ["scripts/dist-windows-manifest.mjs", "--artifact-dir", dir, "--arch", "x64"], {
    cwd: suiteRoot,
    stdio: "pipe",
  });

  const manifestPath = join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.platform, "Windows");
  assert.equal(manifest.artifacts[0].file, "installers/nested/vaexcore-console-0.1.2-x64.exe");

  assert.doesNotThrow(() => {
    execFileSync("node", ["scripts/validate-release-manifest.mjs", manifestPath], {
      cwd: suiteRoot,
      stdio: "pipe",
    });
  });

  writeFileSync(installer, "changed\n");
  assert.match(validateManifest(manifestPath), /checksum mismatch/);
});

test("windows manifest validation catches missing installers and compatibility drift", () => {
  const dir = mkdtempSync(join(tmpdir(), "vaexcore-windows-manifest-"));
  const installer = join(dir, "vaexcore-pulse-0.2.0-x64.exe");
  writeFileSync(installer, "installer\n");
  execFileSync("node", ["scripts/dist-windows-manifest.mjs", "--artifact-dir", dir, "--arch", "x64"], {
    cwd: suiteRoot,
    stdio: "pipe",
  });
  const manifestPath = join(dir, "manifest.json");

  unlinkSync(installer);
  assert.match(validateManifest(manifestPath), /artifact is missing on disk/);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  writeFileSync(installer, "installer\n");
  manifest.release.compatibleApps["vaexcore-pulse"] = "9.9.9";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.match(validateManifest(manifestPath), /does not match release compatibility 9\.9\.9/);
});

function validateManifest(manifestPath) {
  try {
    execFileSync("node", ["scripts/validate-release-manifest.mjs", manifestPath], {
      cwd: suiteRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.fail("manifest validation unexpectedly passed");
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

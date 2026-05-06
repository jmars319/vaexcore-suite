import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkSuiteAppRepos, normalizeGitUrl } from "../lib/git-repo-checks.mjs";

test("git URL normalization compares HTTPS and SSH GitHub origins", () => {
  assert.equal(normalizeGitUrl("git@github.com:jmars319/vaexcore-studio.git"), "https://github.com/jmars319/vaexcore-studio");
  assert.equal(normalizeGitUrl("https://github.com/jmars319/vaexcore-studio.git"), "https://github.com/jmars319/vaexcore-studio");
});

test("suite app repo check rejects detached HEAD", () => {
  const root = mkdtempSync(join(tmpdir(), "vaexcore-suite-repos-"));
  try {
    mkdirSync(join(root, "studio/.git"), { recursive: true });
    const { errors } = checkSuiteAppRepos(root, [appFixture()], fakeGit({ branch: "HEAD" }));

    assert.ok(errors.some((error) => error.includes("detached")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("suite app repo check rejects wrong upstream", () => {
  const root = mkdtempSync(join(tmpdir(), "vaexcore-suite-repos-"));
  try {
    mkdirSync(join(root, "studio/.git"), { recursive: true });
    const { errors } = checkSuiteAppRepos(root, [appFixture()], fakeGit({ upstream: "origin/release" }));

    assert.ok(errors.some((error) => error.includes("tracks origin/release")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function appFixture() {
  return {
    id: "vaexcore-studio",
    path: "studio",
    branch: "main",
    repo: "https://github.com/jmars319/vaexcore-studio",
  };
}

function fakeGit({ branch = "main", upstream = "origin/main" } = {}) {
  return (_repoPath, args) => {
    const command = args.join(" ");
    if (command === "rev-parse --abbrev-ref HEAD") {
      return branch;
    }
    if (command === "remote get-url origin") {
      return "git@github.com:jmars319/vaexcore-studio.git";
    }
    if (command === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
      return upstream;
    }
    throw new Error(`unexpected git command: ${command}`);
  };
}

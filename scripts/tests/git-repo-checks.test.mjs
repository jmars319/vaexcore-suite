import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGitUrl } from "../lib/git-repo-checks.mjs";

test("git URL normalization compares HTTPS and SSH GitHub origins", () => {
  assert.equal(normalizeGitUrl("git@github.com:jmars319/vaexcore-studio.git"), "https://github.com/jmars319/vaexcore-studio");
  assert.equal(normalizeGitUrl("https://github.com/jmars319/vaexcore-studio.git"), "https://github.com/jmars319/vaexcore-studio");
});

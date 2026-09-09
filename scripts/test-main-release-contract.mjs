#!/usr/bin/env node
import assert from "node:assert/strict";
import { classifyMainRelease, isNotionManagedPath } from "./main-release-contract.mjs";

assert.equal(isNotionManagedPath("content/posts/example/index.md"), true);
assert.equal(isNotionManagedPath("data/homepage_runtime.toml"), true);
assert.equal(isNotionManagedPath(".notion-sync-manifest.json"), true);
assert.equal(isNotionManagedPath("assets/css/custom.css"), false);
assert.equal(isNotionManagedPath("package-lock.json"), false);

assert.deepEqual(
  classifyMainRelease({
    actor: "huikai79",
    commitMessage: "Fix article layout",
    changedPaths: ["assets/css/custom.css", "layouts/_default/single.html"],
  }).deploy,
  true,
);

assert.deepEqual(
  classifyMainRelease({
    actor: "huikai79",
    commitMessage: "Update article",
    changedPaths: ["content/posts/example/index.md"],
  }).reason,
  "notion-managed-change",
);

assert.deepEqual(
  classifyMainRelease({
    actor: "huikai79",
    commitMessage: "Mixed change",
    changedPaths: ["assets/css/custom.css", "content/posts/example/index.md"],
  }).reason,
  "mixed-notion-and-code-change",
);

assert.deepEqual(
  classifyMainRelease({
    actor: "github-actions[bot]",
    commitMessage: "🔄 Sync site state (2026-09-10T00:00:00Z)",
    changedPaths: ["content/posts/example/index.md", "package-lock.json"],
  }).reason,
  "notion-sync-owned",
);

assert.equal(
  classifyMainRelease({
    actor: "huikai79",
    commitMessage: "Update dependencies",
    changedPaths: ["package-lock.json"],
  }).deploy,
  true,
);

assert.equal(
  classifyMainRelease({
    actor: "github-actions[bot]",
    commitMessage: "Automated workflow maintenance",
    changedPaths: [".github/workflows/example.yml"],
  }).deploy,
  true,
);

assert.equal(
  classifyMainRelease({ actor: "huikai79", commitMessage: "No-op", changedPaths: [] }).reason,
  "no-changed-paths",
);

console.log("main release contract tests: PASS");

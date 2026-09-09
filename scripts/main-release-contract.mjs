#!/usr/bin/env node
import fs from "node:fs";

const MANAGED_EXACT_PATHS = new Set([
  ".notion-sync-manifest.json",
  ".notion-sync-deps.sha256",
  "data/homepage_runtime.toml",
]);

export function isNotionManagedPath(filePath = "") {
  const normalized = String(filePath || "").trim().replace(/^\.\//, "");
  return normalized === "content/posts" || normalized.startsWith("content/posts/") || MANAGED_EXACT_PATHS.has(normalized);
}

export function classifyMainRelease({ actor = "", commitMessage = "", changedPaths = [] } = {}) {
  const paths = [...new Set((changedPaths || []).map(path => String(path || "").trim()).filter(Boolean))];
  const syncOwned = actor === "github-actions[bot]" && /^🔄 Sync site state\b/.test(String(commitMessage || ""));
  const managedPaths = paths.filter(isNotionManagedPath);
  const unmanagedPaths = paths.filter(path => !isNotionManagedPath(path));

  if (syncOwned) {
    return {
      deploy: false,
      reason: "notion-sync-owned",
      managedPaths,
      unmanagedPaths,
      changedPaths: paths,
    };
  }

  if (!paths.length) {
    return {
      deploy: false,
      reason: "no-changed-paths",
      managedPaths,
      unmanagedPaths,
      changedPaths: paths,
    };
  }

  if (managedPaths.length) {
    return {
      deploy: false,
      reason: unmanagedPaths.length ? "mixed-notion-and-code-change" : "notion-managed-change",
      managedPaths,
      unmanagedPaths,
      changedPaths: paths,
    };
  }

  return {
    deploy: true,
    reason: "code-only-main-change",
    managedPaths,
    unmanagedPaths,
    changedPaths: paths,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const changedPaths = fs.readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
  const result = classifyMainRelease({
    actor: process.env.GITHUB_ACTOR || "",
    commitMessage: process.env.HEAD_COMMIT_MESSAGE || "",
    changedPaths,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

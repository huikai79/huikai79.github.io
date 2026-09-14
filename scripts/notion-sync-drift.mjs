#!/usr/bin/env node
import fs from "node:fs/promises";

const publicationPath = process.argv[2] || "/tmp/notion-publication-contract.json";
const manifestPath = process.argv[3] || ".notion-sync-manifest.json";
const outputPath = process.argv[4] || "/tmp/notion-sync-drift.json";

const publication = JSON.parse(await fs.readFile(publicationPath, "utf8"));
if (publication.status !== "pass") {
  throw new Error(`Publication report must pass before drift detection; received ${publication.status}`);
}

let manifest = null;
try {
  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const reasons = [];
const changedPageIds = new Set();
const productionRows = (publication.pages ?? []).filter(row => row?.visibility === "Public");
const currentPages = manifest?.pages && typeof manifest.pages === "object" ? manifest.pages : {};

if (!manifest) {
  reasons.push("manifest-missing");
} else if (manifest.version !== 2) {
  reasons.push(`manifest-version:${manifest.version ?? "missing"}`);
}

const reportById = new Map(productionRows.filter(row => row?.pageId).map(row => [row.pageId, row]));
const manifestIds = Object.keys(currentPages).sort();
const reportIds = [...reportById.keys()].sort();

for (const pageId of reportIds) {
  const row = reportById.get(pageId);
  const previous = currentPages[pageId];
  if (!previous) {
    changedPageIds.add(pageId);
    reasons.push(`page-added:${pageId}`);
    continue;
  }

  const comparisons = [
    ["slug", row.slug ?? "", previous.slug ?? ""],
    ["language", row.language ?? "", previous.language ?? ""],
    ["translationGroup", row.translationGroup ?? "", previous.translationGroup ?? ""],
    ["lastEditedTime", row.lastEditedTime ?? "", previous.lastEditedTime ?? ""],
    ["presentationFingerprint", row.presentationFingerprint ?? "", previous.presentationFingerprint ?? ""]
  ];

  for (const [field, next, before] of comparisons) {
    if (next !== before) {
      changedPageIds.add(pageId);
      reasons.push(`${field}-changed:${pageId}`);
    }
  }
}

for (const pageId of manifestIds) {
  if (!reportById.has(pageId)) {
    changedPageIds.add(pageId);
    reasons.push(`page-removed:${pageId}`);
  }
}

const result = {
  status: "complete",
  needsSync: reasons.length > 0,
  productionCount: productionRows.length,
  manifestCount: manifestIds.length,
  changedPageIds: [...changedPageIds].sort(),
  reasons: [...new Set(reasons)].sort()
};

await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);

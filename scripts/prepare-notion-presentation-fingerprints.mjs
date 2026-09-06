#!/usr/bin/env node
import fs from "node:fs/promises";
import { prepareManifestForPresentationSync } from "./notion-presentation-fingerprint.mjs";

const publicationReportPath = process.argv[2] || "/tmp/notion-publication-contract.json";
const driftReportPath = process.argv[3] || "/tmp/notion-presentation-fingerprints.json";
const manifestPath = ".notion-sync-manifest.json";

const publication = JSON.parse(await fs.readFile(publicationReportPath, "utf8"));
if (publication.status !== "pass") {
  throw new Error(`Publication report is not pass: ${publication.status}`);
}

let manifest = { pages: {} };
try {
  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const prepared = prepareManifestForPresentationSync(manifest, publication.pages ?? []);
if (prepared.invalidated.length) {
  await fs.writeFile(manifestPath, `${JSON.stringify(prepared.manifest, null, 2)}\n`);
}

await fs.writeFile(
  driftReportPath,
  `${JSON.stringify({ status: "complete", invalidated: prepared.invalidated, fingerprints: prepared.fingerprints }, null, 2)}\n`
);

console.log(
  `Notion presentation fingerprint prepare: PASS (invalidated=${prepared.invalidated.length}, report=${driftReportPath})`
);
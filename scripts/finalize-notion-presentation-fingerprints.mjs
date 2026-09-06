#!/usr/bin/env node
import fs from "node:fs/promises";
import { finalizeManifestPresentationFingerprints } from "./notion-presentation-fingerprint.mjs";

const publicationReportPath = process.argv[2] || "/tmp/notion-publication-contract.json";
const manifestPath = ".notion-sync-manifest.json";

const publication = JSON.parse(await fs.readFile(publicationReportPath, "utf8"));
if (publication.status !== "pass") {
  throw new Error(`Publication report is not pass: ${publication.status}`);
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const finalized = finalizeManifestPresentationFingerprints(manifest, publication.pages ?? []);
await fs.writeFile(manifestPath, `${JSON.stringify(finalized.manifest, null, 2)}\n`);

console.log(
  `Notion presentation fingerprint finalize: PASS (applied=${finalized.applied.length})`
);
#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "notion-sync-drift-"));
const script = new URL("./notion-sync-drift.mjs", import.meta.url).pathname;

async function runCase(name, publication, manifest) {
  const publicationPath = path.join(tmp, `${name}-publication.json`);
  const manifestPath = path.join(tmp, `${name}-manifest.json`);
  const outputPath = path.join(tmp, `${name}-out.json`);
  await fs.writeFile(publicationPath, JSON.stringify(publication));
  if (manifest !== null) await fs.writeFile(manifestPath, JSON.stringify(manifest));

  const result = spawnSync(process.execPath, [script, publicationPath, manifestPath, outputPath], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`${name} failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(await fs.readFile(outputPath, "utf8"));
}

const row = {
  pageId: "page-1",
  visibility: "Public",
  slug: "example",
  language: "zh-TW",
  translationGroup: "example",
  lastEditedTime: "2026-09-14T00:00:00.000Z",
  presentationFingerprint: "cover-a"
};
const publication = { status: "pass", pages: [row] };
const manifest = {
  version: 2,
  pages: {
    "page-1": {
      slug: "example",
      language: "zh-TW",
      translationGroup: "example",
      lastEditedTime: "2026-09-14T00:00:00.000Z",
      presentationFingerprint: "cover-a"
    }
  }
};

assert.equal((await runCase("stable", publication, manifest)).needsSync, false);

const edited = structuredClone(publication);
edited.pages[0].lastEditedTime = "2026-09-14T00:01:00.000Z";
assert.equal((await runCase("edited", edited, manifest)).needsSync, true);

const coverChanged = structuredClone(publication);
coverChanged.pages[0].presentationFingerprint = "cover-b";
assert.equal((await runCase("cover", coverChanged, manifest)).needsSync, true);

const added = structuredClone(publication);
added.pages.push({ ...row, pageId: "page-2", slug: "second", translationGroup: "second" });
assert.equal((await runCase("added", added, manifest)).needsSync, true);

const removedManifest = structuredClone(manifest);
removedManifest.pages["page-2"] = {
  slug: "second",
  language: "zh-TW",
  translationGroup: "second",
  lastEditedTime: "2026-09-14T00:00:00.000Z",
  presentationFingerprint: "cover-a"
};
assert.equal((await runCase("removed", publication, removedManifest)).needsSync, true);

assert.equal((await runCase("missing-manifest", publication, null)).needsSync, true);

await fs.rm(tmp, { recursive: true, force: true });
console.log("Notion sync drift tests: PASS");

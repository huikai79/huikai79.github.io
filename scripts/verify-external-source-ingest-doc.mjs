#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const doc = fs.readFileSync("docs/external-reading-ingestion-v1.md", "utf8");
assert.match(doc, /paste only `Source URL`/);
assert.match(doc, /Translation remains a separate, manually approved Transmith step/);
assert.match(doc, /Automatic translation, approval or publication/);
assert.match(doc, /`status = Draft`/);
assert.match(doc, /`Visibility = Test`/);

console.log("external ingestion documentation boundary: ok");

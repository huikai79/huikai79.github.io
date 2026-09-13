#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/external-source-ingest.yml", "utf8");

assert.match(workflow, /schedule:\s*\n\s*- cron: "\*\/15 \* \* \* \*"/);
assert.match(workflow, /ref: main/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /permissions:\s*\n\s*contents: read/);
assert.match(workflow, /node scripts\/verify-external-source-ingest-contract\.mjs/);
assert.match(workflow, /node scripts\/verify-external-source-inbox-contract\.mjs/);
assert.match(workflow, /run: node scripts\/external-source-ingest\.mjs/);
assert.doesNotMatch(workflow, /OPENAI_API_KEY|TRANSLATION_APPLY|generate-translation-drafts|responses\/v1/i);
assert.doesNotMatch(workflow, /contents:\s*write/);

console.log("external source ingestion workflow safety: ok");

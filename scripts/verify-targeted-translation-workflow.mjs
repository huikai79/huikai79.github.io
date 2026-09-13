#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/translation-drafts.yml", "utf8");

assert.match(workflow, /source_page_id:/);
assert.match(workflow, /Required when apply=true/);
assert.match(workflow, /Resolve manually approved translation source/);
assert.match(workflow, /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.apply \}\}/);
assert.match(workflow, /TRANSLATION_APPLY: "1"/);
assert.match(workflow, /TRANSLATION_SOURCE_PAGE_ID: \$\{\{ inputs\.source_page_id \}\}/);
assert.match(workflow, /node scripts\/resolve-targeted-translation-source\.mjs/);
assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.apply && '1' \|\| '0'/);
assert.ok(!workflow.includes("TRANSLATION_SOURCE_GROUP: ${{ inputs."), "user input must not set Translation Source Group directly");

const resolveStep = workflow.indexOf("Resolve manually approved translation source");
const generatorStep = workflow.indexOf("Preflight translation plan or create manually approved drafts");
assert.ok(resolveStep >= 0 && generatorStep > resolveStep, "resolver must run before generator");

console.log("Targeted translation workflow verification: PASS");

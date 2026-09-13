#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/translation-auto-drafts.yml", "utf8");

assert.match(workflow, /name: "Notion automatic translation drafts"/);
assert.match(workflow, /schedule:/);
assert.match(workflow, /cron: "\*\/15 \* \* \* \*"/);
assert.match(workflow, /workflow_run:/);
assert.match(workflow, /Notion sync -> validated main commit/);
assert.match(workflow, /TRANSLATION_APPLY: "1"/);
assert.match(workflow, /TRANSLATION_AUTOMATIC: "1"/);
assert.match(workflow, /TRANSLATION_MAX_GENERATED: "2"/);
assert.match(workflow, /node scripts\/generate-translation-drafts\.mjs/);
assert.ok(!workflow.includes("source_page_id"), "automatic queue must not depend on manual source selectors");
assert.ok(!workflow.includes("Translation Status: Approved"), "automatic queue must never approve translations");
assert.ok(!workflow.includes("status: Published"), "automatic queue must never publish translations");
assert.ok(!workflow.includes("Visibility: Public"), "automatic queue must never make translations public");

console.log("Automatic translation workflow verification: PASS");

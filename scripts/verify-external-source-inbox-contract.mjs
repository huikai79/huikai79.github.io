#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildExternalIngestionCandidateFilter,
  externalInboxViewFilterDescription
} from "./external-source-inbox-contract.mjs";

assert.deepEqual(buildExternalIngestionCandidateFilter(), {
  and: [
    { property: "Source URL", url: { is_not_empty: true } },
    { property: "Title", title: { is_empty: true } },
    { property: "Ingestion Status", select: { is_empty: true } },
    { property: "Translation Source", relation: { is_empty: true } }
  ]
});
assert.match(externalInboxViewFilterDescription(), /Title is empty/);
assert.match(externalInboxViewFilterDescription(), /Ingestion Status is set/);

console.log("external source inbox contract: ok");

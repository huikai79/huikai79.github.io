import assert from "node:assert/strict";
import {
  publicationRightsAdvisory,
  VALID_SOURCE_USES
} from "./notion-rights-audit.mjs";

assert.deepEqual([...VALID_SOURCE_USES], [
  "Original / Reference",
  "Excerpt",
  "Translation",
  "Republication",
  "Adaptation"
]);

assert.equal(
  publicationRightsAdvisory({ visibility: "Public", sourceUrl: "", sourceUse: "" }).findings.length,
  0,
  "own/original rows without an external source must not be forced into rights migration"
);

assert.match(
  publicationRightsAdvisory({
    visibility: "Public",
    sourceUrl: "https://example.com/source",
    sourceUse: ""
  }).findings[0].code,
  /source-use-missing/
);

const translationUnknown = publicationRightsAdvisory({
  visibility: "Public",
  sourceUrl: "https://example.com/source",
  sourceUse: "Translation",
  rightsStatus: "Needs Review"
}, { fullTranslation: "permission-required" });
assert.equal(translationUnknown.reviewRequired, true);
assert.match(translationUnknown.findings[0].message, /permission-required/);

assert.equal(publicationRightsAdvisory({
  visibility: "Public",
  sourceUrl: "https://example.com/source",
  sourceUse: "Translation",
  rightsStatus: "Permission Granted"
}, { fullTranslation: "permission-required" }).findings.length, 0);

assert.equal(publicationRightsAdvisory({
  visibility: "Public",
  sourceUrl: "https://example.com/reference",
  sourceUse: "Original / Reference",
  rightsStatus: ""
}).findings.length, 0);

assert.equal(publicationRightsAdvisory({
  visibility: "Test",
  sourceUrl: "https://example.com/source",
  sourceUse: "Translation",
  rightsStatus: "Unknown"
}, { fullTranslation: "unknown" }).findings.length, 0);

console.log("Notion rights advisory tests: PASS");

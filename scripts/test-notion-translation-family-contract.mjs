#!/usr/bin/env node
import assert from "node:assert/strict";
import { translationFamilyContractIssues } from "./notion-translation-family-contract.mjs";

const sourceId = "source-en";
const approved = {
  pageId: "translation-zh-tw",
  title: "寫作建議",
  language: "zh-TW",
  translationStatus: "Approved",
  translationSourceIds: [sourceId]
};
const sourceRecords = new Map([[sourceId, {
  pageId: sourceId,
  language: "en",
  translationGroup: "writing-advice",
  translationStatus: "Source",
  notionStatus: "Published",
  visibility: "Public"
}]]);

assert.deepEqual(
  translationFamilyContractIssues({
    group: "writing-advice",
    members: [approved],
    sourceRecordsById: sourceRecords
  }),
  []
);

assert.match(
  translationFamilyContractIssues({
    group: "writing-advice",
    members: [{ ...approved, translationSourceIds: ["different-source"] }],
    sourceRecordsById: sourceRecords
  })[0],
  /could not be resolved/
);

assert.match(
  translationFamilyContractIssues({
    group: "writing-advice",
    members: [approved],
    sourceRecordsById: new Map([[sourceId, { ...sourceRecords.get(sourceId), translationStatus: "Approved" }]])
  })[0],
  /Translation Status Approved/
);

assert.match(
  translationFamilyContractIssues({
    group: "writing-advice",
    members: [approved],
    sourceRecordsById: new Map([[sourceId, { ...sourceRecords.get(sourceId), translationGroup: "other" }]])
  })[0],
  /expected writing-advice/
);

assert.match(
  translationFamilyContractIssues({
    group: "writing-advice",
    members: [
      approved,
      { ...approved, pageId: "translation-zh-cn", language: "zh-CN", translationSourceIds: ["source-two"] }
    ],
    sourceRecordsById: new Map()
  })[0],
  /exactly one canonical Source; found 2/
);

console.log("Translation family contract tests: PASS");

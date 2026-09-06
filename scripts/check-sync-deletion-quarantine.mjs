#!/usr/bin/env node
import fs from "node:fs/promises";
import { shouldQuarantineDeletion } from "./notion-content-contract.mjs";

const reportPath = process.argv[2] || ".notion-sync-report.json";
const allow = process.env.ALLOW_NOTION_DELETION_QUARANTINE_BYPASS === "true";
const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

if (report?.status !== "complete") {
  throw new Error(`Notion sync report is not complete: ${reportPath}`);
}

const currentCount = Number(report.published ?? 0);
const deleted = Array.isArray(report.deleted) ? report.deleted : [];
const deletedCount = deleted.length;
const previousCount = currentCount + deletedCount;
const quarantined = shouldQuarantineDeletion({ previousCount, deletedCount });

if (quarantined && !allow) {
  throw new Error(
    `Deletion quarantine blocked this sync: previous=${previousCount}, current=${currentCount}, deleted=${deletedCount}. ` +
    `Review the Notion filter/status/visibility transition before retrying. ` +
    `Only an explicitly approved migration may set ALLOW_NOTION_DELETION_QUARANTINE_BYPASS=true.`
  );
}

if (quarantined && allow) {
  console.warn(
    `⚠️ Deletion quarantine explicitly bypassed: previous=${previousCount}, current=${currentCount}, deleted=${deletedCount}`
  );
} else {
  console.log(
    `Deletion quarantine: PASS (previous=${previousCount}, current=${currentCount}, deleted=${deletedCount})`
  );
}

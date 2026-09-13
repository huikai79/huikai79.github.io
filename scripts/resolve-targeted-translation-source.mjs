#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { Client } from "@notionhq/client";
import { extractEditorialFields } from "./notion-content-contract.mjs";
import { buildTranslationCandidateFilter, translationReadinessIssues } from "./translation-readiness-contract.mjs";
import { approvedTranslationSourceSelection, normalizeTranslationSourcePageId } from "./translation-source-selection-contract.mjs";

const token = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;
const requestedApply = process.env.TRANSLATION_APPLY === "1";
const rawSourcePageId = process.env.TRANSLATION_SOURCE_PAGE_ID || "";

if (!token) throw new Error("NOTION_TOKEN 未設定");
if (!databaseId) throw new Error("NOTION_DATABASE_ID 未設定");

const selectedSourcePageId = approvedTranslationSourceSelection({ requestedApply, rawSourcePageId });
if (!selectedSourcePageId) {
  console.log("No targeted translation source requested; keeping full preflight scope.");
  process.exit(0);
}

const notion = new Client({ auth: token });
const page = await notion.pages.retrieve({ page_id: selectedSourcePageId });
const properties = page.properties ?? {};
const title = properties.Title?.title?.map(item => item.plain_text).join("").trim() ?? "";
const explicitGroup = properties["Translation Group"]?.rich_text?.map(item => item.plain_text).join("").trim() ?? "";
if (!explicitGroup) throw new Error("Selected Translation Source must have an explicit Translation Group");

const editorial = extractEditorialFields(properties);
const readinessIssues = translationReadinessIssues({ pageId: page.id, title, editorial });
if (readinessIssues.length) {
  throw new Error(`Selected Translation Source is not ready: ${readinessIssues.join("; ")}`);
}

const matches = [];
let cursor;
do {
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: buildTranslationCandidateFilter(explicitGroup),
    page_size: 100,
    start_cursor: cursor
  });
  matches.push(...response.results);
  cursor = response.has_more ? response.next_cursor : undefined;
} while (cursor);

const normalizedSelected = normalizeTranslationSourcePageId(page.id);
const matchingIds = matches.map(item => normalizeTranslationSourcePageId(item.id));
if (!matchingIds.includes(normalizedSelected)) {
  throw new Error("Selected Translation Source is not a candidate in NOTION_DATABASE_ID");
}
if (matches.length !== 1) {
  throw new Error(`Translation Group ${explicitGroup} resolves to ${matches.length} candidates; expected exactly 1`);
}

if (process.env.GITHUB_ENV) {
  await appendFile(process.env.GITHUB_ENV, `TRANSLATION_SOURCE_GROUP=${explicitGroup}\n`);
}
console.log(`Targeted translation source resolved: page=${normalizedSelected}, group=${explicitGroup}`);

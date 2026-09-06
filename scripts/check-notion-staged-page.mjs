#!/usr/bin/env node
import { Client } from "@notionhq/client";
import fs from "node:fs/promises";
import {
  editorialFrontMatter,
  extractEditorialFields,
  publicationRecordMissing
} from "./notion-content-contract.mjs";

const token = process.env.NOTION_TOKEN;
const expectedDatabaseId = process.env.NOTION_DATABASE_ID;
const pageId = process.argv[2] || process.env.NOTION_STAGED_PAGE_ID;
const reportPath = process.argv[3] || "/tmp/notion-staged-page-contract.json";

if (!token) throw new Error("NOTION_TOKEN 未設定");
if (!pageId) throw new Error("Staged Notion page ID 未設定");

const notion = new Client({ auth: token });
const page = await notion.pages.retrieve({ page_id: pageId });
const props = page.properties ?? {};

const title = props.Title?.title?.map(item => item.plain_text).join("").trim() ?? "";
const rawSlug = props.slug?.rich_text?.map(item => item.plain_text).join("").trim() ?? "";
const slug = rawSlug.replace(/[^a-zA-Z0-9-_]/g, "-");
const date = props.date?.date?.start ?? "";
const status = props.status?.status?.name ?? "";
const editorial = extractEditorialFields(props);
const candidate = { title, slug, date, ...editorial };
const failures = [];

if (expectedDatabaseId) {
  const parentDatabaseId = page.parent?.database_id ?? "";
  const normalizedExpected = expectedDatabaseId.replace(/-/g, "").toLowerCase();
  const normalizedActual = parentDatabaseId.replace(/-/g, "").toLowerCase();
  if (normalizedActual && normalizedExpected !== normalizedActual) {
    failures.push(`page belongs to unexpected database: ${parentDatabaseId}`);
  }
}

const missing = publicationRecordMissing(candidate);
if (missing.length) failures.push(`missing staged publication metadata: ${missing.join(", ")}`);

if (status === "Published") {
  failures.push("staged page is already Published; staging preflight requires a non-production status");
}

let proposedFrontMatter = null;
if (!failures.length) proposedFrontMatter = editorialFrontMatter(candidate);

const report = {
  status: failures.length ? "blocked" : "pass",
  pageId: page.id,
  title,
  slug,
  date,
  notionStatus: status,
  ...editorial,
  failures,
  proposedFrontMatter
};

await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (failures.length) {
  for (const failure of failures) console.error(`::error::${failure}`);
  throw new Error(`Notion staged page contract blocked: ${failures.length} issue(s)`);
}

console.log(
  `Notion staged page contract: PASS (page=${page.id}, status=${status || "unset"}, report=${reportPath})`
);

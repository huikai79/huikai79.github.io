#!/usr/bin/env node
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import fs from "node:fs/promises";
import {
  buildNotionFilter,
  extractEditorialFields,
  productionMetadataMissing,
  productionTranslationIssues
} from "./notion-content-contract.mjs";
import {
  pageHasExplicitCover,
  resolveCoverReadiness
} from "./notion-cover-contract.mjs";
import { notionPresentationFingerprint } from "./notion-presentation-fingerprint.mjs";

const token = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;
const mode = process.argv[2] || "production";
const reportPath = process.argv[3] || "/tmp/notion-publication-contract.json";

if (!token) throw new Error("NOTION_TOKEN 未設定");
if (!databaseId) throw new Error("NOTION_DATABASE_ID 未設定");
if (!new Set(["production", "preview"]).has(mode)) {
  throw new Error(`Publication contract mode must be production or preview; received ${mode}`);
}

const notion = new Client({ auth: token });
const n2m = new NotionToMarkdown({ notionClient: notion });
const filter = buildNotionFilter(mode);
const pages = [];
let cursor;

do {
  const response = await notion.databases.query({
    database_id: databaseId,
    filter,
    page_size: 100,
    start_cursor: cursor
  });
  pages.push(...response.results);
  cursor = response.has_more ? response.next_cursor : undefined;
} while (cursor);

let manifest = { pages: {} };
try {
  manifest = JSON.parse(await fs.readFile(".notion-sync-manifest.json", "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const routeKeys = new Map();
const slugFamilies = new Map();
const familyMembers = new Map();
const failures = [];
const rows = [];

for (const page of pages) {
  const props = page.properties ?? {};
  const title = props.Title?.title?.map(item => item.plain_text).join("").trim() ?? "";
  const rawSlug = props.slug?.rich_text?.map(item => item.plain_text).join("").trim() ?? "";
  const slug = rawSlug.replace(/[^a-zA-Z0-9-_]/g, "-");
  const editorial = extractEditorialFields(props);
  let coverPlan = null;
  let presentationFingerprint = null;

  if (!title) failures.push(`${page.id}: missing Title`);
  if (!slug) failures.push(`${page.id}: missing slug`);

  const routeKey = `${editorial.language}\0${slug}`;
  if (slug && editorial.language) {
    if (routeKeys.has(routeKey)) {
      failures.push(
        `${page.id}: duplicate language route ${editorial.language}/${slug} with ${routeKeys.get(routeKey)}`
      );
    } else {
      routeKeys.set(routeKey, page.id);
    }
  }

  if (slug && editorial.translationGroup) {
    const previousGroup = slugFamilies.get(slug);
    if (previousGroup && previousGroup !== editorial.translationGroup) {
      failures.push(
        `${page.id}: shared slug ${slug} crosses Translation Groups ` +
        `${previousGroup} / ${editorial.translationGroup}`
      );
    } else {
      slugFamilies.set(slug, editorial.translationGroup);
    }
  }

  if (editorial.translationGroup) {
    const members = familyMembers.get(editorial.translationGroup) ?? [];
    members.push({ pageId: page.id, slug, ...editorial });
    familyMembers.set(editorial.translationGroup, members);
  }

  if (editorial.visibility === "Public") {
    const missing = productionMetadataMissing(editorial);
    if (missing.length) {
      failures.push(`${page.id}: missing production metadata: ${missing.join(", ")}`);
    }
    const translationIssues = productionTranslationIssues(editorial);
    for (const issue of translationIssues) {
      failures.push(`${page.id}: translation governance: ${issue}`);
    }

    const previous = manifest?.pages?.[page.id];
    if (previous?.slug && previous.slug !== slug) {
      failures.push(
        `${page.id}: public slug change blocked: ${previous.slug} -> ${slug}. ` +
        `Use an explicitly reviewed alias/migration plan before changing a public URL.`
      );
    }

    const fullPage = await notion.pages.retrieve({ page_id: page.id });
    presentationFingerprint = notionPresentationFingerprint(fullPage);

    let markdown = "";
    if (!pageHasExplicitCover(fullPage)) {
      const mdBlocks = await n2m.pageToMarkdown(page.id);
      markdown = n2m.toMarkdownString(mdBlocks).parent ?? "";
    }

    coverPlan = resolveCoverReadiness({
      page: fullPage,
      markdown,
      candidate: { title, slug, ...editorial }
    });

    if (mode === "production" && !coverPlan.ready) {
      failures.push(
        `${page.id}: semantic cover required before production publication. ` +
        `Set a Notion page cover or add an article image; generic procedural fallback is not publication-grade.`
      );
    }
  }

  rows.push({
    pageId: page.id,
    title,
    slug,
    lastEditedTime: page.last_edited_time ?? "",
    ...editorial,
    coverPlan,
    presentationFingerprint
  });
}

for (const [group, members] of familyMembers) {
  const byLanguage = new Map();
  for (const member of members) {
    if (byLanguage.has(member.language)) {
      failures.push(
        `${member.pageId}: Translation Group ${group} contains duplicate language ${member.language} ` +
        `with ${byLanguage.get(member.language)}`
      );
    } else {
      byLanguage.set(member.language, member.pageId);
    }
  }

  if (mode === "production") {
    const sourceMembers = members.filter(member => member.translationStatus === "Source");
    if (sourceMembers.length !== 1) {
      failures.push(
        `Translation Group ${group}: production family requires exactly one Source; found ${sourceMembers.length}`
      );
    } else {
      const sourceId = sourceMembers[0].pageId;
      for (const member of members.filter(item => item.translationStatus === "Approved")) {
        if (member.translationSourceIds.length !== 1 || member.translationSourceIds[0] !== sourceId) {
          failures.push(
            `${member.pageId}: Approved translation in ${group} must relate to canonical Source ${sourceId}`
          );
        }
      }
    }
  }
}

const report = {
  status: failures.length ? "blocked" : "pass",
  mode,
  count: rows.length,
  productionCount: rows.filter(row => row.visibility === "Public").length,
  coverReadyCount: rows.filter(row => row.coverPlan?.ready === true).length,
  semanticCoverNeededCount: rows.filter(row => row.coverPlan?.strategy === "semantic-cover-required").length,
  translationFamilyCount: familyMembers.size,
  failures,
  pages: rows
};

await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (failures.length) {
  for (const failure of failures) console.error(`::error::${failure}`);
  throw new Error(`Notion publication contract blocked: ${failures.length} issue(s)`);
}

console.log(
  `Notion publication contract: PASS ` +
  `(mode=${mode}, pages=${rows.length}, public=${report.productionCount}, ` +
  `families=${report.translationFamilyCount}, coverReady=${report.coverReadyCount}, ` +
  `semanticNeeded=${report.semanticCoverNeededCount}, report=${reportPath})`
);

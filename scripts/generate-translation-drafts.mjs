#!/usr/bin/env node
import { Client } from "@notionhq/client";
import fs from "node:fs/promises";
import {
  applyTranslations,
  collectTranslationSegments,
  copyablePageCover,
  copyablePageIcon,
  draftProperties,
  extractOpenAIOutputText,
  inspectBlockTree,
  sourceTranslationTargets,
  translationResponseSchema,
  validateSourceForTranslation,
  writableBlock
} from "./translation-draft-contract.mjs";
import { extractEditorialFields } from "./notion-content-contract.mjs";
import {
  TRANSMITH_RUNTIME_PROFILE,
  buildTranslationRequestInput,
  buildTransmithInstructions,
  normalizedTranslationBrief,
  translationConfigFingerprint
} from "./transmith-runtime-profile.mjs";

const token = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;
const requestedApply = process.env.TRANSLATION_APPLY === "1";
const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
const apply = requestedApply && Boolean(apiKey);
const model = process.env.OPENAI_TRANSLATION_MODEL || "gpt-5.6-luna";
const reportPath = process.env.TRANSLATION_REPORT_PATH || "/tmp/notion-translation-drafts.json";
const applyWarning = requestedApply && !apiKey
  ? "OPENAI_API_KEY is not configured; running translation preflight only and creating no drafts"
  : "";

if (!token) throw new Error("NOTION_TOKEN 未設定");
if (!databaseId) throw new Error("NOTION_DATABASE_ID 未設定");
if (applyWarning) console.warn(`::warning::${applyWarning}`);

const notion = new Client({ auth: token });

function titleValue(properties = {}) {
  return properties.Title?.title?.map(item => item.plain_text).join("").trim() ?? "";
}

function richTextValue(property) {
  return property?.rich_text?.map(item => item.plain_text).join("").trim() ?? "";
}

function sourceWithEffectiveGroup(source, group) {
  if (richTextValue(source.properties?.["Translation Group"])) return source;
  return {
    ...source,
    properties: {
      ...(source.properties ?? {}),
      "Translation Group": { rich_text: [{ plain_text: group }] }
    }
  };
}

async function queryAll(filter) {
  const results = [];
  let cursor;
  do {
    const response = await notion.databases.query({
      database_id: databaseId,
      filter,
      page_size: 100,
      start_cursor: cursor
    });
    results.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function listBlockTree(parentId) {
  const blocks = [];
  let cursor;
  do {
    const response = await notion.blocks.children.list({
      block_id: parentId,
      page_size: 100,
      start_cursor: cursor
    });
    for (const block of response.results) {
      const copy = JSON.parse(JSON.stringify(block));
      if (block.has_children) copy.children = await listBlockTree(block.id);
      blocks.push(copy);
    }
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

async function findExistingTarget(group, language) {
  return queryAll({
    and: [
      { property: "Translation Group", rich_text: { equals: group } },
      { property: "Language", select: { equals: language } }
    ]
  });
}

function existingTargetStaleReasons(page, { sourceRevision, configFingerprint }) {
  const properties = page?.properties ?? {};
  const existingSourceRevision = richTextValue(properties["Translation Source Revision"]);
  const existingConfigFingerprint = richTextValue(properties["Translation Config Fingerprint"]);
  const reasons = [];
  if (!existingSourceRevision || existingSourceRevision !== sourceRevision) {
    reasons.push("source revision differs from existing translation");
  }
  if (!existingConfigFingerprint) {
    reasons.push("existing translation has no Translation Config Fingerprint");
  } else if (existingConfigFingerprint !== configFingerprint) {
    reasons.push("translation configuration differs from existing translation");
  }
  return reasons;
}

async function translateSegments({
  sourceLanguage,
  targetLanguage,
  title,
  summary,
  blocks,
  segments,
  brief
}) {
  const instructions = buildTransmithInstructions({ sourceLanguage, targetLanguage, brief });
  const input = buildTranslationRequestInput({
    sourceLanguage,
    targetLanguage,
    title,
    summary,
    blocks,
    segments,
    brief
  });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions,
      input: JSON.stringify(input),
      max_output_tokens: 65536,
      text: {
        format: {
          type: "json_schema",
          name: "translation_segments",
          strict: true,
          schema: translationResponseSchema()
        }
      }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || JSON.stringify(payload).slice(0, 1000);
    throw new Error(`OpenAI Responses request failed (${response.status}): ${message}`);
  }
  return JSON.parse(extractOpenAIOutputText(payload));
}

async function appendChildren(pageId, blocks) {
  for (let offset = 0; offset < blocks.length; offset += 100) {
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks.slice(offset, offset + 100)
    });
  }
}

async function createDraft({ source, group, targetLanguage, translated, configFingerprint }) {
  const engine = `openai:${model}`;
  const properties = draftProperties({
    source: sourceWithEffectiveGroup(source, group),
    targetLanguage,
    translatedTitle: translated.title,
    translatedSummary: translated.summary,
    engine
  });
  properties["Translation Profile"] = {
    rich_text: [{ type: "text", text: { content: TRANSMITH_RUNTIME_PROFILE } }]
  };
  properties["Translation Config Fingerprint"] = {
    rich_text: [{ type: "text", text: { content: configFingerprint } }]
  };

  const request = {
    parent: { database_id: databaseId },
    properties
  };
  const icon = copyablePageIcon(source);
  const cover = copyablePageCover(source);
  if (icon) request.icon = icon;
  if (cover) request.cover = cover;

  const created = await notion.pages.create(request);
  try {
    const children = translated.blocks.map(writableBlock);
    await appendChildren(created.id, children);
  } catch (error) {
    try {
      await notion.pages.update({ page_id: created.id, archived: true });
    } catch (rollbackError) {
      throw new Error(
        `Draft body creation failed (${error.message}); rollback also failed (${rollbackError.message}). ` +
        `Inspect newly-created Notion page ${created.id}`
      );
    }
    throw error;
  }
  return { pageId: created.id, engine };
}

const sources = await queryAll({
  and: [
    { property: "status", status: { equals: "Published" } },
    {
      or: [
        { property: "Visibility", select: { equals: "Public" } },
        { property: "Visibility", select: { equals: "Test" } }
      ]
    },
    { property: "Translate To", multi_select: { is_not_empty: true } }
  ]
});

const report = {
  status: applyWarning ? "preflight" : "complete",
  requestedApply,
  apply,
  warning: applyWarning || null,
  provider: "openai-responses",
  model,
  translationProfile: TRANSMITH_RUNTIME_PROFILE,
  sourceCount: sources.length,
  requestedTargetCount: 0,
  planned: [],
  generated: [],
  skipped: [],
  blocked: []
};

for (const sourceStub of sources) {
  const source = await notion.pages.retrieve({ page_id: sourceStub.id });
  const properties = source.properties ?? {};
  const editorial = extractEditorialFields(properties);
  const title = titleValue(properties);
  const summary = richTextValue(properties.Summary);
  const group = editorial.translationGroup;
  const sourceErrors = validateSourceForTranslation({ pageId: source.id, editorial });
  if (!title) sourceErrors.push("missing Title");
  if (!summary) sourceErrors.push("missing Summary");

  let translationBrief = "";
  try {
    translationBrief = normalizedTranslationBrief(richTextValue(properties["Translation Brief"]));
  } catch (error) {
    sourceErrors.push(error.message);
  }

  const targets = sourceTranslationTargets(editorial);
  report.requestedTargetCount += targets.length;
  if (sourceErrors.length) {
    report.blocked.push({
      sourcePageId: source.id,
      title,
      targetLanguage: null,
      reasons: sourceErrors
    });
    continue;
  }

  for (const targetLanguage of targets) {
    const configFingerprint = translationConfigFingerprint({
      model,
      sourceLanguage: editorial.language,
      targetLanguage,
      brief: translationBrief
    });
    const existing = await findExistingTarget(group, targetLanguage);
    if (existing.length) {
      const stale = existing.map(page => ({
        pageId: page.id,
        reasons: existingTargetStaleReasons(page, {
          sourceRevision: source.last_edited_time ?? "",
          configFingerprint
        })
      }));
      report.skipped.push({
        sourcePageId: source.id,
        title,
        targetLanguage,
        reason: "target language already exists in Translation Group; automatic overwrite is disabled",
        existingPageIds: existing.map(page => page.id),
        stale: stale.some(item => item.reasons.length > 0),
        staleDetails: stale.filter(item => item.reasons.length > 0),
        translationProfile: TRANSMITH_RUNTIME_PROFILE,
        configFingerprint
      });
      continue;
    }

    const blocks = await listBlockTree(source.id);
    const inspection = inspectBlockTree(blocks);
    if (inspection.errors.length) {
      report.blocked.push({
        sourcePageId: source.id,
        title,
        targetLanguage,
        reasons: inspection.errors,
        warnings: inspection.warnings,
        blockCount: inspection.count
      });
      continue;
    }

    const collected = collectTranslationSegments({ title, summary, blocks });
    if (!collected.segments.length) {
      report.blocked.push({
        sourcePageId: source.id,
        title,
        targetLanguage,
        reasons: ["source contains no translatable text segments"]
      });
      continue;
    }

    report.planned.push({
      sourcePageId: source.id,
      title,
      sourceLanguage: editorial.language,
      targetLanguage,
      translationGroup: group,
      sourceRevision: source.last_edited_time ?? "",
      translationProfile: TRANSMITH_RUNTIME_PROFILE,
      configFingerprint,
      translationBriefApplied: Boolean(translationBrief),
      textSegmentCount: collected.segments.length,
      blockCount: inspection.count,
      warnings: inspection.warnings
    });

    if (!apply) continue;

    try {
      const translatedResponse = await translateSegments({
        sourceLanguage: editorial.language,
        targetLanguage,
        title,
        summary,
        blocks,
        segments: collected.segments,
        brief: translationBrief
      });
      const translated = applyTranslations({ title, summary, blocks }, translatedResponse);
      const result = await createDraft({
        source,
        group,
        targetLanguage,
        translated,
        configFingerprint
      });
      report.generated.push({
        sourcePageId: source.id,
        pageId: result.pageId,
        sourceLanguage: editorial.language,
        targetLanguage,
        translationGroup: group,
        sourceRevision: source.last_edited_time ?? "",
        engine: result.engine,
        translationProfile: TRANSMITH_RUNTIME_PROFILE,
        configFingerprint
      });
    } catch (error) {
      report.blocked.push({
        sourcePageId: source.id,
        title,
        targetLanguage,
        reasons: [error.message]
      });
    }
  }
}

if (apply && report.blocked.length) report.status = "partial";
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  `Translation drafts: ${report.status.toUpperCase()} ` +
  `(profile=${TRANSMITH_RUNTIME_PROFILE}, requestedApply=${requestedApply}, apply=${apply}, ` +
  `sources=${report.sourceCount}, requested=${report.requestedTargetCount}, ` +
  `planned=${report.planned.length}, generated=${report.generated.length}, ` +
  `skipped=${report.skipped.length}, blocked=${report.blocked.length}, report=${reportPath})`
);

if (apply && report.blocked.length) {
  for (const item of report.blocked) {
    console.error(
      `::error::Translation draft blocked: source=${item.sourcePageId}, target=${item.targetLanguage ?? "n/a"}, ` +
      `${(item.reasons ?? []).join("; ")}`
    );
  }
  process.exitCode = 1;
}

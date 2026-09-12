import {
  VALID_TRANSLATION_SOURCE_LANGUAGES,
  VALID_TRANSLATION_TARGET_LANGUAGES
} from "./notion-content-contract.mjs";
import {
  SAFE_EXTERNAL_MEDIA_BLOCK_TYPES,
  TRANSLATABLE_RICH_TEXT_BLOCK_TYPES
} from "./translation-draft-contract.mjs";

export const TRANSLATION_SUMMARY_MAX_CHARS = 150;

export function buildTranslationCandidateFilter() {
  return { property: "Translate To", multi_select: { is_not_empty: true } };
}

function normalizedTargets(editorial = {}) {
  return Array.isArray(editorial.translateTo)
    ? editorial.translateTo.map(value => String(value || "").trim()).filter(Boolean)
    : [];
}

export function translationReadinessIssues({ pageId = "", title = "", editorial = {} } = {}) {
  const issues = [];
  const sourceLanguage = String(editorial.language || "").trim();
  const targets = normalizedTargets(editorial);

  if (!pageId) issues.push("missing page id");
  if (!String(title || "").trim()) issues.push("missing Title");
  if (editorial.translationStatus !== "Source") issues.push("Translation Status must be Source");
  if (!sourceLanguage || !VALID_TRANSLATION_SOURCE_LANGUAGES.has(sourceLanguage)) {
    issues.push("unsupported source Language");
  }
  if (!String(editorial.translationGroup || "").trim()) issues.push("missing Translation Group");
  if (!targets.length) issues.push("Translate To must include at least one target language");

  for (const target of targets) {
    if (!VALID_TRANSLATION_TARGET_LANGUAGES.has(target)) {
      issues.push(`unsupported target language ${target}`);
    }
    if (sourceLanguage && target === sourceLanguage) {
      issues.push(`Translate To includes source language ${sourceLanguage}`);
    }
  }

  return [...new Set(issues)];
}

function richTextPlainText(richText = []) {
  return richText
    .map(item => item?.plain_text ?? item?.text?.content ?? "")
    .join("");
}

function summaryTextFromBlock(block) {
  const type = block?.type;
  const data = type ? block?.[type] : null;
  if (!data) return "";

  if (TRANSLATABLE_RICH_TEXT_BLOCK_TYPES.has(type)) {
    return richTextPlainText(data.rich_text ?? []);
  }
  if (type === "code" || type === "bookmark" || SAFE_EXTERNAL_MEDIA_BLOCK_TYPES.has(type)) {
    return richTextPlainText(data.caption ?? []);
  }
  return "";
}

export function deriveTranslationSummary(blocks = [], maxChars = TRANSLATION_SUMMARY_MAX_CHARS) {
  const pieces = [];

  function walk(items) {
    for (const block of Array.isArray(items) ? items : []) {
      const text = summaryTextFromBlock(block).replace(/\s+/g, " ").trim();
      if (text) pieces.push(text);
      if (Array.isArray(block.children)) walk(block.children);
    }
  }

  walk(blocks);
  const plain = pieces.join(" ").replace(/\s+/g, " ").trim();
  if (!plain) return "";

  const characters = [...plain];
  if (characters.length <= maxChars) return plain;
  return `${characters.slice(0, maxChars).join("").trimEnd()}…`;
}

export function effectiveTranslationSummary(explicitSummary = "", blocks = []) {
  const explicit = String(explicitSummary || "").replace(/\s+/g, " ").trim();
  if (explicit) return { summary: explicit, source: "explicit" };

  const derived = deriveTranslationSummary(blocks);
  if (derived) return { summary: derived, source: "derived" };
  return { summary: "", source: "empty" };
}

function richTextProperty(value) {
  return {
    rich_text: value
      ? [{ type: "text", text: { content: value } }]
      : []
  };
}

export function translationDraftProperties({
  source,
  group,
  targetLanguage,
  translatedTitle,
  translatedSummary = "",
  engine
}) {
  const p = source?.properties ?? {};
  const effectiveGroup = String(group || "").trim();
  if (!source?.id) throw new Error("Translation draft requires source page id");
  if (!effectiveGroup) throw new Error("Translation draft requires Translation Group");
  if (!VALID_TRANSLATION_TARGET_LANGUAGES.has(targetLanguage)) {
    throw new Error(`Unsupported translation target: ${targetLanguage}`);
  }

  const date = p.date?.date?.start ?? "";
  const slug = richTextPlainText(p.slug?.rich_text ?? []).trim();
  const category = p.Category?.select?.name ?? "";
  const entryType = p.Type?.select?.name ?? "";
  const tags = p.tags?.multi_select?.map(item => item.name).filter(Boolean) ?? [];
  const sourceLabel = richTextPlainText(p.Source?.rich_text ?? []).trim();
  const sourceUrl = p["Source URL"]?.url ?? "";

  const properties = {
    Title: { title: [{ type: "text", text: { content: translatedTitle } }] },
    status: { status: { name: "Draft" } },
    Visibility: { select: { name: "Test" } },
    Summary: richTextProperty(String(translatedSummary || "").trim()),
    Home: { select: { name: "None" } },
    Language: { select: { name: targetLanguage } },
    "Translation Group": richTextProperty(effectiveGroup),
    "Translate To": { multi_select: [] },
    "Translation Status": { select: { name: "Draft" } },
    "Translation Source": { relation: [{ id: source.id }] },
    "Translation Source Revision": richTextProperty(source.last_edited_time ?? ""),
    "Translation Engine": richTextProperty(String(engine || "").trim())
  };

  if (date) properties.date = { date: { start: date } };
  if (slug) properties.slug = richTextProperty(slug);
  if (category) properties.Category = { select: { name: category } };
  if (entryType) properties.Type = { select: { name: entryType } };
  if (tags.length) properties.tags = { multi_select: tags.map(name => ({ name })) };
  if (sourceLabel) properties.Source = richTextProperty(sourceLabel);
  if (sourceUrl) properties["Source URL"] = { url: sourceUrl };

  return properties;
}

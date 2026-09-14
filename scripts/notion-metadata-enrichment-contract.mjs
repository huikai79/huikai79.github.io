export const METADATA_CATEGORIES = Object.freeze(["科技", "學習", "創作", "生活"]);
export const METADATA_TYPES = Object.freeze(["文章", "札記", "紀錄"]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function sourceLabelFromUrl(value) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return "";
    return url.hostname.replace(/^www\./i, "").trim();
  } catch {
    return "";
  }
}

export function buildDeterministicMetadata({
  slug = "",
  translationGroup = "",
  translationStatus = "",
  translationSourceIds = [],
  source = "",
  sourceUrl = ""
} = {}) {
  const sourceIds = Array.isArray(translationSourceIds)
    ? translationSourceIds.map(clean).filter(Boolean)
    : [];
  const explicitStatus = clean(translationStatus);
  const canonical = sourceIds.length === 0 && (!explicitStatus || explicitStatus === "Source");
  if (!canonical) return {};

  const updates = {};
  const normalizedSlug = clean(slug);
  if (!clean(translationGroup) && normalizedSlug) updates.translationGroup = normalizedSlug;
  if (!explicitStatus) updates.translationStatus = "Source";
  if (!clean(source) && clean(sourceUrl)) {
    const label = sourceLabelFromUrl(sourceUrl);
    if (label) updates.source = label;
  }
  return updates;
}

export function aiMetadataMissing({ summary = "", category = "", entryType = "" } = {}) {
  const missing = [];
  if (!clean(summary)) missing.push("summary");
  if (!clean(category)) missing.push("category");
  if (!clean(entryType)) missing.push("entryType");
  return missing;
}

export function articleExcerpt(markdown, maxChars = 16000) {
  const text = String(markdown ?? "").trim();
  if (text.length <= maxChars) return text;
  const tailChars = Math.min(4000, Math.floor(maxChars / 4));
  const headChars = maxChars - tailChars;
  return `${text.slice(0, headChars)}\n\n[...中段省略...]\n\n${text.slice(-tailChars)}`;
}

export function metadataResponseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", minLength: 20, maxLength: 320 },
      category: { type: "string", enum: [...METADATA_CATEGORIES] },
      entryType: { type: "string", enum: [...METADATA_TYPES] }
    },
    required: ["summary", "category", "entryType"]
  };
}

export function validateMetadataProposal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("metadata proposal must be an object");
  }
  const summary = clean(value.summary);
  if (summary.length < 20 || summary.length > 320) {
    throw new Error(`summary length must be 20-320 characters; received ${summary.length}`);
  }
  const category = clean(value.category);
  if (!METADATA_CATEGORIES.includes(category)) {
    throw new Error(`unsupported category: ${category}`);
  }
  const entryType = clean(value.entryType);
  if (!METADATA_TYPES.includes(entryType)) {
    throw new Error(`unsupported type: ${entryType}`);
  }
  return { summary, category, entryType };
}

export function selectMetadataAutofill({ existing = {}, proposal } = {}) {
  const normalized = validateMetadataProposal(proposal);
  const updates = {};
  if (!clean(existing.summary)) updates.summary = normalized.summary;
  if (!clean(existing.category)) updates.category = normalized.category;
  if (!clean(existing.entryType)) updates.entryType = normalized.entryType;
  return { updates, proposal: normalized };
}

export function notionPropertiesFromMetadataUpdates(updates = {}) {
  const allowed = new Set([
    "summary",
    "category",
    "entryType",
    "source",
    "translationGroup",
    "translationStatus"
  ]);
  for (const key of Object.keys(updates)) {
    if (!allowed.has(key)) throw new Error(`unsupported metadata update key: ${key}`);
  }

  const properties = {};
  if (clean(updates.summary)) {
    properties.Summary = { rich_text: [{ type: "text", text: { content: clean(updates.summary) } }] };
  }
  if (clean(updates.category)) properties.Category = { select: { name: clean(updates.category) } };
  if (clean(updates.entryType)) properties.Type = { select: { name: clean(updates.entryType) } };
  if (clean(updates.source)) {
    properties.Source = { rich_text: [{ type: "text", text: { content: clean(updates.source) } }] };
  }
  if (clean(updates.translationGroup)) {
    properties["Translation Group"] = {
      rich_text: [{ type: "text", text: { content: clean(updates.translationGroup) } }]
    };
  }
  if (clean(updates.translationStatus)) {
    properties["Translation Status"] = { select: { name: clean(updates.translationStatus) } };
  }
  return properties;
}

const VALID_SYNC_MODES = new Set(["legacy", "production", "preview"]);
export const VALID_CONTENT_LANGUAGES = new Set(["zh-TW", "zh-CN", "en"]);
export const VALID_TRANSLATION_STATUSES = new Set(["Source", "Draft", "Review", "Approved", "Stale"]);

export function normalizeSyncMode(value = "legacy") {
  const mode = String(value || "legacy").trim().toLowerCase();
  if (!VALID_SYNC_MODES.has(mode)) {
    throw new Error(
      `NOTION_SYNC_MODE 必須是 legacy、production 或 preview；目前為 ${JSON.stringify(value)}`
    );
  }
  return mode;
}

export function buildNotionFilter(modeValue = "legacy") {
  const mode = normalizeSyncMode(modeValue);
  const published = { property: "status", status: { equals: "Published" } };

  if (mode === "legacy") return published;

  if (mode === "production") {
    return {
      and: [
        published,
        { property: "Visibility", select: { equals: "Public" } }
      ]
    };
  }

  return {
    and: [
      published,
      {
        or: [
          { property: "Visibility", select: { equals: "Public" } },
          { property: "Visibility", select: { equals: "Test" } }
        ]
      }
    ]
  };
}

function richTextValue(property) {
  return property?.rich_text?.map(item => item.plain_text).join("").trim() ?? "";
}

function selectValue(property) {
  return property?.select?.name?.trim() ?? "";
}

function multiSelectValues(property) {
  return property?.multi_select?.map(item => item.name?.trim()).filter(Boolean) ?? [];
}

function relationIds(property) {
  return property?.relation?.map(item => item.id?.trim()).filter(Boolean) ?? [];
}

export function extractEditorialFields(properties = {}) {
  return {
    visibility: selectValue(properties.Visibility),
    category: selectValue(properties.Category),
    entryType: selectValue(properties.Type),
    summary: richTextValue(properties.Summary),
    homePlacement: selectValue(properties.Home),
    language: selectValue(properties.Language),
    translationGroup: richTextValue(properties["Translation Group"]),
    translateTo: multiSelectValues(properties["Translate To"]),
    translationStatus: selectValue(properties["Translation Status"]),
    translationSourceIds: relationIds(properties["Translation Source"]),
    translationSourceRevision: richTextValue(properties["Translation Source Revision"]),
    translationEngine: richTextValue(properties["Translation Engine"])
  };
}

export function translationGovernanceIssues(candidate = {}) {
  const issues = [];
  const language = String(candidate.language || "").trim();
  const status = String(candidate.translationStatus || "").trim();
  const targets = Array.isArray(candidate.translateTo) ? candidate.translateTo : [];
  const sourceIds = Array.isArray(candidate.translationSourceIds) ? candidate.translationSourceIds : [];

  if (!status) {
    issues.push("Translation Status");
    return issues;
  }
  if (!VALID_TRANSLATION_STATUSES.has(status)) {
    issues.push(`Translation Status=${status}`);
  }

  for (const target of targets) {
    if (!VALID_CONTENT_LANGUAGES.has(target)) {
      issues.push(`Translate To=${target}`);
    }
    if (language && target === language) {
      issues.push(`Translate To includes source language ${language}`);
    }
  }
  if (new Set(targets).size !== targets.length) {
    issues.push("Translate To contains duplicates");
  }

  if (status === "Source") {
    if (sourceIds.length) issues.push("Source article must not have Translation Source");
    if (candidate.translationSourceRevision) issues.push("Source article must not have Translation Source Revision");
  } else if (VALID_TRANSLATION_STATUSES.has(status)) {
    if (sourceIds.length !== 1) issues.push("Translated article requires exactly one Translation Source");
    if (!candidate.translationSourceRevision) issues.push("Translation Source Revision");
    if (!candidate.translationEngine) issues.push("Translation Engine");
    if (targets.length) issues.push("Translated article must not set Translate To");
  }

  return issues;
}

export function productionTranslationIssues(candidate = {}) {
  const issues = translationGovernanceIssues(candidate);
  const status = String(candidate.translationStatus || "").trim();
  if (candidate.visibility === "Public" && status && !new Set(["Source", "Approved"]).has(status)) {
    issues.push(`Public translation lifecycle requires Source or Approved; found ${status}`);
  }
  return issues;
}

export function productionMetadataMissing(candidate) {
  const missing = [];
  if (candidate.visibility !== "Public") missing.push("Visibility=Public");
  if (!candidate.summary) missing.push("Summary");
  if (!candidate.category) missing.push("Category");
  if (!candidate.entryType) missing.push("Type");
  if (!candidate.language) {
    missing.push("Language");
  } else if (!VALID_CONTENT_LANGUAGES.has(candidate.language)) {
    missing.push(`Language=${candidate.language}`);
  }
  if (!candidate.translationGroup) missing.push("Translation Group");
  if (!candidate.translationStatus) missing.push("Translation Status");
  return missing;
}

export function publicationRecordMissing(candidate = {}) {
  const missing = productionMetadataMissing(candidate);
  if (!candidate.title) missing.push("Title");
  if (!candidate.slug) missing.push("slug");
  if (!candidate.date) missing.push("date");
  return missing;
}

export function editorialFrontMatter(candidate = {}) {
  const missing = publicationRecordMissing(candidate);
  const translationIssues = productionTranslationIssues(candidate);
  if (missing.length || translationIssues.length) {
    throw new Error(
      `Publication front matter missing/invalid: ${[...missing, ...translationIssues].join(", ")}`
    );
  }

  return {
    description: candidate.summary,
    categories: [candidate.category],
    entryType: candidate.entryType,
    contentVisibility: candidate.visibility,
    homePlacement: candidate.homePlacement || "None",
    contentLanguage: candidate.language,
    translationKey: candidate.translationGroup
  };
}

export function contentFilename(language) {
  if (language === "zh-TW") return "index.md";
  if (language === "zh-CN") return "index.zh-cn.md";
  if (language === "en") return "index.en.md";
  throw new Error(`Unsupported content language: ${JSON.stringify(language)}`);
}

export function shouldQuarantineDeletion({
  previousCount,
  deletedCount,
  minCount = 3,
  ratioThreshold = 0.15,
  hardCount = 10
}) {
  if (previousCount <= 0 || deletedCount <= 0) return false;
  if (deletedCount < minCount) return false;
  const ratio = deletedCount / previousCount;
  return ratio >= ratioThreshold || deletedCount >= hardCount;
}

export function publicSlugChangeBlocked(previous, candidate, allowChange = false) {
  if (allowChange || !previous || !candidate) return false;
  return (
    previous.visibility === "Public" &&
    candidate.visibility === "Public" &&
    Boolean(previous.slug) &&
    previous.slug !== candidate.slug
  );
}

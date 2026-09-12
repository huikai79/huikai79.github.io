export const TRANSLATABLE_RICH_TEXT_BLOCK_TYPES = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "quote",
  "to_do",
  "toggle",
  "callout"
]);

export const SAFE_PASSTHROUGH_BLOCK_TYPES = new Set([
  "divider",
  "equation",
  "bookmark",
  "embed"
]);

export const SAFE_EXTERNAL_MEDIA_BLOCK_TYPES = new Set([
  "image",
  "video",
  "audio",
  "file",
  "pdf"
]);

const SOURCE_LANGUAGE_LABELS = {
  "zh-TW": "Traditional Chinese used in Taiwan",
  "zh-CN": "Simplified Chinese",
  en: "English"
};

const TARGET_LANGUAGE_LABELS = {
  "zh-TW": "Traditional Chinese used in Taiwan",
  "zh-CN": "Simplified Chinese"
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isExternalFileObject(value) {
  return Boolean(value && value.type === "external" && value.external?.url);
}

function isSafeMediaBlock(block) {
  const data = block?.[block?.type];
  if (!data) return false;
  if (data.type === "external") return Boolean(data.external?.url);
  if (data.external?.url) return true;
  return false;
}

function isSafeIcon(icon) {
  return !icon || icon.type === "emoji" || (icon.type === "external" && icon.external?.url);
}

export function sourceTranslationTargets(editorial = {}) {
  const sourceLanguage = String(editorial.language || "").trim();
  const targets = Array.isArray(editorial.translateTo) ? editorial.translateTo : [];
  return [...new Set(targets.map(value => String(value || "").trim()).filter(Boolean))]
    .filter(target => target !== sourceLanguage);
}

export function validateSourceForTranslation({ pageId = "", editorial = {} } = {}) {
  const errors = [];
  if (!pageId) errors.push("missing page id");
  if (editorial.translationStatus !== "Source") errors.push("Translation Status must be Source");
  if (!new Set(["Test", "Public"]).has(editorial.visibility)) {
    errors.push("Visibility must be Test or Public");
  }
  if (!editorial.language || !SOURCE_LANGUAGE_LABELS[editorial.language]) errors.push("unsupported source Language");
  if (!editorial.translationGroup) errors.push("missing Translation Group");
  for (const target of sourceTranslationTargets(editorial)) {
    if (!TARGET_LANGUAGE_LABELS[target]) errors.push(`unsupported target language ${target}`);
  }
  return errors;
}

export function inspectBlockTree(blocks = []) {
  const errors = [];
  const warnings = [];
  let count = 0;

  function walk(items, path = "root") {
    if (!Array.isArray(items)) {
      errors.push(`${path}: children must be an array`);
      return;
    }
    if (items.length > 100) {
      if (path === "root") warnings.push(`${path}: contains ${items.length} children; creation will be chunked`);
      else errors.push(`${path}: nested child count ${items.length} exceeds safe Notion creation limit 100`);
    }

    items.forEach((block, index) => {
      count += 1;
      const blockPath = `${path}.${index}`;
      const type = block?.type;
      if (!type || !block[type]) {
        errors.push(`${blockPath}: invalid Notion block`);
        return;
      }

      if (TRANSLATABLE_RICH_TEXT_BLOCK_TYPES.has(type)) {
        if (type === "callout" && !isSafeIcon(block[type].icon)) {
          errors.push(`${blockPath}: callout uses a temporary/file icon that cannot be safely cloned`);
        }
      } else if (type === "code") {
        // code is intentionally preserved verbatim; captions may be translated
      } else if (SAFE_PASSTHROUGH_BLOCK_TYPES.has(type)) {
        // safe immutable payload
      } else if (SAFE_EXTERNAL_MEDIA_BLOCK_TYPES.has(type)) {
        if (!isSafeMediaBlock(block)) {
          errors.push(
            `${blockPath}: ${type} uses a Notion-hosted/file-upload asset; automatic translation draft ` +
            `will not copy temporary signed media URLs`
          );
        }
      } else {
        errors.push(`${blockPath}: unsupported block type ${type}`);
      }

      if (Array.isArray(block.children)) walk(block.children, `${blockPath}.children`);
    });
  }

  walk(blocks);
  return { errors, warnings, count };
}

function addRichTextSegments(richText, prefix, segments, refs) {
  if (!Array.isArray(richText)) return;
  richText.forEach((item, index) => {
    if (item?.type !== "text" || typeof item?.text?.content !== "string") return;
    const original = item.text.content;
    if (!original.trim()) return;
    const id = `${prefix}.rich_text.${index}`;
    segments.push({ id, text: original });
    refs.set(id, { item });
  });
}

export function collectTranslationSegments({ title = "", summary = "", blocks = [] } = {}) {
  const workingBlocks = clone(blocks);
  const segments = [];
  const refs = new Map();

  if (String(title).trim()) {
    segments.push({ id: "meta.title", text: String(title) });
    refs.set("meta.title", { meta: "title" });
  }
  if (String(summary).trim()) {
    segments.push({ id: "meta.summary", text: String(summary) });
    refs.set("meta.summary", { meta: "summary" });
  }

  function walk(items, path = "root") {
    items.forEach((block, index) => {
      const blockPath = `${path}.${index}`;
      const type = block.type;
      const data = block[type];
      if (TRANSLATABLE_RICH_TEXT_BLOCK_TYPES.has(type)) {
        addRichTextSegments(data.rich_text, blockPath, segments, refs);
      } else if (type === "code") {
        addRichTextSegments(data.caption, `${blockPath}.caption`, segments, refs);
      } else if (type === "bookmark") {
        addRichTextSegments(data.caption, `${blockPath}.caption`, segments, refs);
      } else if (SAFE_EXTERNAL_MEDIA_BLOCK_TYPES.has(type)) {
        addRichTextSegments(data.caption, `${blockPath}.caption`, segments, refs);
      }
      if (Array.isArray(block.children)) walk(block.children, `${blockPath}.children`);
    });
  }

  walk(workingBlocks);
  return { segments, refs, blocks: workingBlocks };
}

export function validateTranslationResponse(segments, response) {
  if (!response || !Array.isArray(response.translations)) {
    throw new Error("Translation response must contain a translations array");
  }
  const expected = new Map(segments.map(item => [item.id, item.text]));
  const actual = new Map();
  for (const item of response.translations) {
    if (!item || typeof item.id !== "string" || typeof item.text !== "string") {
      throw new Error("Each translation response item requires string id/text");
    }
    if (actual.has(item.id)) throw new Error(`Duplicate translation id: ${item.id}`);
    if (!expected.has(item.id)) throw new Error(`Unexpected translation id: ${item.id}`);
    if (!item.text.trim() && expected.get(item.id).trim()) {
      throw new Error(`Translation unexpectedly empty: ${item.id}`);
    }
    actual.set(item.id, item.text);
  }
  const missing = [...expected.keys()].filter(id => !actual.has(id));
  if (missing.length) throw new Error(`Missing translation ids: ${missing.join(", ")}`);
  return actual;
}

export function applyTranslations({ title = "", summary = "", blocks = [] }, response) {
  const collected = collectTranslationSegments({ title, summary, blocks });
  const translated = validateTranslationResponse(collected.segments, response);
  let translatedTitle = title;
  let translatedSummary = summary;

  for (const [id, ref] of collected.refs) {
    const value = translated.get(id);
    if (ref.meta === "title") translatedTitle = value;
    else if (ref.meta === "summary") translatedSummary = value;
    else if (ref.item?.text) {
      ref.item.text.content = value;
      if (Object.prototype.hasOwnProperty.call(ref.item, "plain_text")) ref.item.plain_text = value;
    }
  }
  return { title: translatedTitle, summary: translatedSummary, blocks: collected.blocks };
}

export function translationInstructions(sourceLanguage, targetLanguage) {
  const source = SOURCE_LANGUAGE_LABELS[sourceLanguage];
  const target = TARGET_LANGUAGE_LABELS[targetLanguage];
  if (!source || !target) throw new Error(`Unsupported translation direction: ${sourceLanguage} -> ${targetLanguage}`);
  return [
    `Translate the supplied text segments from ${source} to ${target}.`,
    "Preserve meaning, uncertainty, names, numbers, quotations and authorial stance.",
    "Do not add facts, commentary, headings, citations or explanations that are not in the source.",
    "For zh-TW, use natural Taiwan Traditional Chinese terminology rather than mechanical character conversion.",
    "For zh-CN, use natural Simplified Chinese terminology rather than mechanical character conversion.",
    "Return exactly one translation for every supplied id, with no missing, duplicate or extra ids."
  ].join(" ");
}

export function translationResponseSchema() {
  return {
    type: "object",
    properties: {
      translations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            text: { type: "string" }
          },
          required: ["id", "text"],
          additionalProperties: false
        }
      }
    },
    required: ["translations"],
    additionalProperties: false
  };
}

export function extractOpenAIOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text;
  for (const output of response?.output ?? []) {
    if (output?.type !== "message") continue;
    for (const item of output.content ?? []) {
      if (item?.type === "output_text" && typeof item.text === "string" && item.text.trim()) return item.text;
    }
  }
  throw new Error("OpenAI Responses payload did not contain output_text");
}

export function draftProperties({ source, targetLanguage, translatedTitle, translatedSummary, engine }) {
  const p = source.properties ?? {};
  const date = p.date?.date?.start ?? "";
  const slug = p.slug?.rich_text?.map(item => item.plain_text).join("").trim() ?? "";
  const group = p["Translation Group"]?.rich_text?.map(item => item.plain_text).join("").trim() ?? "";
  const category = p.Category?.select?.name ?? "";
  const entryType = p.Type?.select?.name ?? "";
  const tags = p.tags?.multi_select?.map(item => item.name).filter(Boolean) ?? [];
  const sourceLabel = p.Source?.rich_text?.map(item => item.plain_text).join("").trim() ?? "";
  const sourceUrl = p["Source URL"]?.url ?? "";
  if (!date || !slug || !group || !category || !entryType) {
    throw new Error("Source page is missing date/slug/Translation Group/Category/Type required for a draft");
  }

  return {
    Title: { title: [{ type: "text", text: { content: translatedTitle } }] },
    date: { date: { start: date } },
    slug: { rich_text: [{ type: "text", text: { content: slug } }] },
    status: { status: { name: "Draft" } },
    Visibility: { select: { name: "Test" } },
    Category: { select: { name: category } },
    Type: { select: { name: entryType } },
    Summary: { rich_text: [{ type: "text", text: { content: translatedSummary } }] },
    Home: { select: { name: "None" } },
    Language: { select: { name: targetLanguage } },
    "Translation Group": { rich_text: [{ type: "text", text: { content: group } }] },
    "Translate To": { multi_select: [] },
    "Translation Status": { select: { name: "Draft" } },
    "Translation Source": { relation: [{ id: source.id }] },
    "Translation Source Revision": {
      rich_text: [{ type: "text", text: { content: source.last_edited_time ?? "" } }]
    },
    "Translation Engine": { rich_text: [{ type: "text", text: { content: engine } }] },
    Source: { rich_text: sourceLabel ? [{ type: "text", text: { content: sourceLabel } }] : [] },
    "Source URL": { url: sourceUrl || null },
    tags: { multi_select: tags.map(name => ({ name })) }
  };
}

function writableAnnotations(annotations) {
  if (!annotations) return undefined;
  return {
    bold: Boolean(annotations.bold),
    italic: Boolean(annotations.italic),
    strikethrough: Boolean(annotations.strikethrough),
    underline: Boolean(annotations.underline),
    code: Boolean(annotations.code),
    color: annotations.color || "default"
  };
}

export function writableRichText(richText = []) {
  return richText.map(item => {
    const annotations = writableAnnotations(item.annotations);
    if (item.type === "text") {
      const result = {
        type: "text",
        text: {
          content: item.text?.content ?? item.plain_text ?? "",
          link: item.text?.link?.url ? { url: item.text.link.url } : null
        }
      };
      if (annotations) result.annotations = annotations;
      return result;
    }
    if (item.type === "equation" && item.equation?.expression) {
      const result = { type: "equation", equation: { expression: item.equation.expression } };
      if (annotations) result.annotations = annotations;
      return result;
    }
    if (item.type === "mention" && item.mention) {
      const result = { type: "mention", mention: clone(item.mention) };
      if (annotations) result.annotations = annotations;
      return result;
    }
    throw new Error(`Unsupported rich_text item type: ${item.type}`);
  });
}

function safeCalloutIcon(icon) {
  if (!icon) return undefined;
  if (icon.type === "emoji") return { type: "emoji", emoji: icon.emoji };
  if (icon.type === "external" && icon.external?.url) {
    return { type: "external", external: { url: icon.external.url } };
  }
  throw new Error("Callout icon cannot be safely cloned");
}

export function writableBlock(block) {
  const type = block.type;
  const data = block[type];
  let payload;

  if (TRANSLATABLE_RICH_TEXT_BLOCK_TYPES.has(type)) {
    payload = { rich_text: writableRichText(data.rich_text ?? []) };
    if (Object.prototype.hasOwnProperty.call(data, "color")) payload.color = data.color;
    if (type === "to_do" && Object.prototype.hasOwnProperty.call(data, "checked")) payload.checked = Boolean(data.checked);
    if (type === "callout" && data.icon) payload.icon = safeCalloutIcon(data.icon);
  } else if (type === "code") {
    payload = {
      rich_text: writableRichText(data.rich_text ?? []),
      caption: writableRichText(data.caption ?? []),
      language: data.language || "plain text"
    };
  } else if (type === "divider") {
    payload = {};
  } else if (type === "equation") {
    payload = { expression: data.expression };
  } else if (type === "bookmark") {
    payload = { url: data.url, caption: writableRichText(data.caption ?? []) };
  } else if (type === "embed") {
    payload = { url: data.url };
  } else if (SAFE_EXTERNAL_MEDIA_BLOCK_TYPES.has(type) && isSafeMediaBlock(block)) {
    const external = data.external ?? data[data.type];
    payload = { type: "external", external: { url: external.url } };
    if (Array.isArray(data.caption)) payload.caption = writableRichText(data.caption);
  } else {
    throw new Error(`Block type cannot be safely cloned: ${type}`);
  }

  if (Array.isArray(block.children) && block.children.length) {
    if (block.children.length > 100) {
      throw new Error(`Nested block ${block.id || type} has more than 100 children`);
    }
    payload.children = block.children.map(writableBlock);
  }
  return { object: "block", type, [type]: payload };
}

export function copyablePageIcon(source) {
  if (source?.icon?.type === "emoji") return { type: "emoji", emoji: source.icon.emoji };
  if (source?.icon?.type === "external" && source.icon.external?.url) {
    return { type: "external", external: { url: source.icon.external.url } };
  }
  return undefined;
}

export function copyablePageCover(source) {
  if (!isExternalFileObject(source?.cover)) return undefined;
  return { type: "external", external: { url: source.cover.external.url } };
}

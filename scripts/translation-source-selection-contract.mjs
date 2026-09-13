function dashedUuid(hex) {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeTranslationSourcePageId(raw = "") {
  const value = String(raw || "").trim();
  if (!value) return "";

  const compact = value.replaceAll("-", "");
  if (/^[0-9a-fA-F]{32}$/.test(compact)) return dashedUuid(compact.toLowerCase());

  let pathname = "";
  try {
    const url = new URL(value);
    const notionHost =
      /(?:^|\.)notion\.com$/i.test(url.hostname) ||
      /(?:^|\.)notion\.(?:so|site)$/i.test(url.hostname);
    if (!notionHost) throw new Error("not a Notion URL");
    pathname = url.pathname;
  } catch {
    throw new Error("Translation source selector must be a Notion page ID or Notion page URL");
  }

  const match = pathname.match(/([0-9a-fA-F]{32})(?:$|\/)/);
  if (!match) throw new Error("Translation source selector URL does not contain a Notion page ID");
  return dashedUuid(match[1].toLowerCase());
}

export function approvedTranslationSourceSelection({ requestedApply = false, rawSourcePageId = "" } = {}) {
  const sourcePageId = normalizeTranslationSourcePageId(rawSourcePageId);
  if (requestedApply && !sourcePageId) {
    throw new Error("A single Translation Source page ID is required when TRANSLATION_APPLY=1");
  }
  return sourcePageId;
}

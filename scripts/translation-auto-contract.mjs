export const DEFAULT_AUTO_TRANSLATION_MAX_GENERATED = 2;
export const MAX_AUTO_TRANSLATION_MAX_GENERATED = 5;

export function automaticTranslationMaxGenerated(
  raw = process.env.TRANSLATION_MAX_GENERATED
) {
  const value = String(raw ?? "").trim();
  if (!value) return DEFAULT_AUTO_TRANSLATION_MAX_GENERATED;
  if (!/^\d+$/.test(value)) {
    throw new Error("TRANSLATION_MAX_GENERATED must be a positive integer");
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < 1 || parsed > MAX_AUTO_TRANSLATION_MAX_GENERATED) {
    throw new Error(
      `TRANSLATION_MAX_GENERATED must be between 1 and ${MAX_AUTO_TRANSLATION_MAX_GENERATED}`
    );
  }
  return parsed;
}

export function sortAutomaticTranslationSources(sources = []) {
  return [...sources].sort((left, right) => {
    const leftTime = Date.parse(left?.last_edited_time ?? "") || 0;
    const rightTime = Date.parse(right?.last_edited_time ?? "") || 0;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
  });
}

export function automaticTranslationFatalBlockers(blocked = []) {
  return blocked.filter(item => item?.fatal === true);
}

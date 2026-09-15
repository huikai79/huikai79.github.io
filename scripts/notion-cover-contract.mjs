export const COVER_ASPECT_RATIO = "16:9";

export function pageHasExplicitCover(page) {
  const cover = page?.cover;
  if (!cover || typeof cover !== "object") return false;
  if (cover.type === "external") return Boolean(cover.external?.url);
  if (cover.type === "file") return Boolean(cover.file?.url);
  return false;
}

export function firstMarkdownImage(markdown = "") {
  const pattern = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of String(markdown).matchAll(pattern)) {
    const target = match[1]?.replace(/^<|>$/g, "").trim();
    if (target) return target;
  }
  return null;
}

function plainBodyExcerpt(markdown = "", maxLength = 420) {
  const plain = String(markdown)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[>*_~|-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

  if (!plain) return "";
  return plain.length > maxLength ? `${plain.slice(0, maxLength).trim()}…` : plain;
}

export function semanticCoverBrief(candidate = {}, markdown = "") {
  const title = String(candidate.title ?? "").trim();
  const summary = String(candidate.summary ?? "").trim();
  const category = String(candidate.category ?? "").trim();
  const entryType = String(candidate.entryType ?? "").trim();
  const bodyExcerpt = plainBodyExcerpt(markdown);

  return {
    aspectRatio: COVER_ASPECT_RATIO,
    title,
    summary,
    category,
    entryType,
    bodyExcerpt,
    visualDirection: [title, summary, category].filter(Boolean).join(" — "),
    requirements: [
      "Represent the article's central idea with a concrete editorial scene, subject, activity, or object when possible.",
      "Use the article meaning rather than a generic category illustration.",
      "Do not add text overlays unless the author explicitly requests them.",
      "Avoid generic abstract patterns when a concrete semantic image is available.",
      "Do not imply people, brands, events, claims, or facts that the article does not support."
    ],
    handoff: "Optional editorial visual brief. A production article may intentionally publish without a Hero image."
  };
}

export function resolveCoverReadiness({ page, markdown = "", candidate = {} } = {}) {
  const bodyImage = firstMarkdownImage(markdown);

  if (pageHasExplicitCover(page)) {
    return {
      ready: true,
      strategy: "notion-cover",
      bodyImage,
      semanticBrief: null
    };
  }

  return {
    ready: true,
    strategy: "no-hero",
    bodyImage,
    semanticBrief: semanticCoverBrief(candidate, markdown)
  };
}

export const LANGUAGE_BUNDLE_TOKENS = new Map([
  ["zh-TW", "zh-tw"],
  ["zh-CN", "zh-cn"],
  ["en", "en"]
]);

const WEBSITE_LANGUAGE_PRIORITY = new Map([
  ["zh-TW", 0],
  ["zh-CN", 1],
  ["en", 2]
]);

function value(record, key) {
  return String(record?.[key] ?? "").trim();
}

function assertSafeBundlePath(bundlePath, label) {
  if (!bundlePath) throw new Error(`${label}: bundle path is empty`);
  if (bundlePath === "." || bundlePath === ".." || bundlePath.includes("/") || bundlePath.includes("\\")) {
    throw new Error(`${label}: unsafe bundle path ${JSON.stringify(bundlePath)}`);
  }
}

function translatedFamilyOwner(members) {
  if (!members.length || members.some(member => member.translationStatus !== "Approved")) {
    return null;
  }
  return [...members].sort((a, b) => (
    (WEBSITE_LANGUAGE_PRIORITY.get(a.language) ?? 99) - (WEBSITE_LANGUAGE_PRIORITY.get(b.language) ?? 99) ||
    a.language.localeCompare(b.language) ||
    a.pageId.localeCompare(b.pageId)
  ))[0];
}

export function manifestBundlePath(entry = {}) {
  const slug = value(entry, "slug");
  const bundlePath = value(entry, "bundlePath") || slug;
  assertSafeBundlePath(bundlePath, `manifest:${slug || "unknown"}`);
  return bundlePath;
}

export function assignArticleBundlePaths(records = []) {
  if (!Array.isArray(records)) throw new Error("Article bundle records must be an array");

  const bySlug = new Map();
  const routeKeys = new Map();
  const pageIds = new Set();

  for (const record of records) {
    const pageId = value(record, "pageId");
    const slug = value(record, "slug");
    const language = value(record, "language");
    const translationGroup = value(record, "translationGroup");
    const translationStatus = value(record, "translationStatus");

    if (!pageId) throw new Error("Article bundle record is missing pageId");
    if (pageIds.has(pageId)) throw new Error(`Duplicate article bundle pageId: ${pageId}`);
    pageIds.add(pageId);
    if (!slug) throw new Error(`${pageId}: article bundle record is missing slug`);
    if (!language || !LANGUAGE_BUNDLE_TOKENS.has(language)) {
      throw new Error(`${pageId}: unsupported article language for bundle routing: ${language || "unset"}`);
    }

    const routeKey = `${language}\0${slug}`;
    if (routeKeys.has(routeKey)) {
      throw new Error(
        `${pageId}: duplicate language/slug route ${language}/${slug} with ${routeKeys.get(routeKey)}`
      );
    }
    routeKeys.set(routeKey, pageId);

    const members = bySlug.get(slug) ?? [];
    members.push({ pageId, slug, language, translationGroup, translationStatus });
    bySlug.set(slug, members);
  }

  const paths = new Map();
  const owners = new Map();
  const claim = (pageId, bundlePath) => {
    assertSafeBundlePath(bundlePath, pageId);
    if (owners.has(bundlePath)) {
      throw new Error(
        `${pageId}: internal bundle path ${bundlePath} collides with ${owners.get(bundlePath)}`
      );
    }
    owners.set(bundlePath, pageId);
    paths.set(pageId, bundlePath);
  };

  for (const [slug, members] of [...bySlug.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (members.length === 1) {
      claim(members[0].pageId, slug);
      continue;
    }

    const groups = new Set(members.map(member => member.translationGroup).filter(Boolean));
    if (groups.size !== 1 || members.some(member => !member.translationGroup)) {
      throw new Error(
        `Shared public slug ${slug} requires one non-empty Translation Group; found ` +
        `${[...groups].join(", ") || "none"}`
      );
    }

    const sources = members.filter(member => member.translationStatus === "Source");
    let owner;
    if (sources.length === 1) {
      owner = sources[0];
    } else if (sources.length === 0) {
      // A canonical Source may legitimately use a non-site language (for example English)
      // and therefore be absent from the website synchronization candidate set. The
      // publication-family contract resolves and validates that upstream Source. Here we
      // only need a deterministic physical bundle owner for the approved site languages.
      owner = translatedFamilyOwner(members);
      if (!owner) {
        throw new Error(
          `Shared public slug ${slug} has no in-scope canonical Source and is not an Approved-only translated family`
        );
      }
    } else {
      throw new Error(
        `Shared public slug ${slug} requires at most one in-scope canonical Source; found ${sources.length}`
      );
    }

    claim(owner.pageId, slug);

    for (const member of members
      .filter(item => item.pageId !== owner.pageId)
      .sort((a, b) => a.language.localeCompare(b.language) || a.pageId.localeCompare(b.pageId))) {
      const token = LANGUAGE_BUNDLE_TOKENS.get(member.language);
      claim(member.pageId, `${slug}--${token}`);
    }
  }

  return paths;
}

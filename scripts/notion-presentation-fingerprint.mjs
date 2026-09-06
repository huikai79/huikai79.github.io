import { createHash } from "node:crypto";

function stableUrl(url, stripQuery = false) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (stripQuery) parsed.search = "";
    return parsed.toString();
  } catch {
    return String(url);
  }
}

function fileIdentity(file) {
  if (!file || typeof file !== "object") return null;
  if (file.type === "external") {
    return { type: "external", url: stableUrl(file.external?.url, false) };
  }
  if (file.type === "file") {
    // Notion-hosted file URLs are signed and their query string can rotate even
    // when the underlying asset has not changed. The stable path identifies the
    // asset without causing a rebuild on signature refresh.
    return { type: "file", url: stableUrl(file.file?.url, true) };
  }
  return { type: String(file.type ?? "unknown") };
}

function iconIdentity(icon) {
  if (!icon || typeof icon !== "object") return null;
  if (icon.type === "emoji") return { type: "emoji", value: icon.emoji ?? "" };
  if (icon.type === "custom_emoji") {
    return {
      type: "custom_emoji",
      id: icon.custom_emoji?.id ?? "",
      name: icon.custom_emoji?.name ?? ""
    };
  }
  return fileIdentity(icon);
}

export function notionPresentationIdentity(page = {}) {
  return {
    cover: fileIdentity(page.cover),
    icon: iconIdentity(page.icon)
  };
}

export function notionPresentationFingerprint(page = {}) {
  const identity = notionPresentationIdentity(page);
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export function presentationFingerprintDrift(manifest = {}, fingerprints = {}) {
  const pages = manifest?.pages && typeof manifest.pages === "object" ? manifest.pages : {};
  const changed = [];

  for (const [pageId, fingerprint] of Object.entries(fingerprints).sort(([a], [b]) => a.localeCompare(b))) {
    if (pages[pageId]?.presentationFingerprint !== fingerprint) changed.push(pageId);
  }

  return changed;
}

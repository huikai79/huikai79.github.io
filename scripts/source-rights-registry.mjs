import fs from "node:fs/promises";

export const TRACKING_QUERY_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid"
]);

export function normalizedSourceUrl(rawUrl = "") {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) return "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  return url.toString().replace(/\/$/, "");
}

function canonicalHost(hostname = "") {
  return String(hostname).toLowerCase().replace(/^www\./, "");
}

function normalizedProfileUrl(rawUrl = "") {
  return normalizedSourceUrl(rawUrl);
}

export async function loadSourceRightsRegistry(path = "data/source-rights.json") {
  const registry = JSON.parse(await fs.readFile(path, "utf8"));
  if (registry?.version !== 1 || !Array.isArray(registry?.profiles) || !registry?.defaultPolicy) {
    throw new Error("Invalid source rights registry schema");
  }
  return registry;
}

export function resolveSourceRightsPolicy(rawUrl, registry) {
  const normalized = normalizedSourceUrl(rawUrl);
  if (!normalized) return { ...registry.defaultPolicy, matchType: "default", normalizedSourceUrl: "" };

  const url = new URL(normalized);
  const host = canonicalHost(url.hostname);
  const profiles = registry.profiles ?? [];

  for (const profile of profiles) {
    const exactUrls = profile?.match?.exactUrls ?? [];
    if (exactUrls.some(candidate => normalizedProfileUrl(candidate) === normalized)) {
      return { ...profile, matchType: "exact-url", normalizedSourceUrl: normalized };
    }
  }

  let bestPrefix = null;
  for (const profile of profiles) {
    const prefixes = profile?.match?.pathPrefixes ?? [];
    for (const prefix of prefixes) {
      const prefixHost = canonicalHost(prefix.host || "");
      const pathPrefix = String(prefix.path || "");
      if (!prefixHost || !pathPrefix || prefixHost !== host || !url.pathname.startsWith(pathPrefix)) continue;
      if (!bestPrefix || pathPrefix.length > bestPrefix.pathPrefix.length) {
        bestPrefix = { profile, pathPrefix };
      }
    }
  }
  if (bestPrefix) {
    return { ...bestPrefix.profile, matchType: "path-prefix", normalizedSourceUrl: normalized };
  }

  for (const profile of profiles) {
    const hosts = profile?.match?.hosts ?? [];
    if (hosts.some(candidate => canonicalHost(candidate) === host)) {
      return { ...profile, matchType: "host", normalizedSourceUrl: normalized };
    }
  }

  return { ...registry.defaultPolicy, matchType: "default", normalizedSourceUrl: normalized };
}

export function rightsPolicySummary(policy = {}) {
  return {
    id: policy.id || "unknown-source",
    matchType: policy.matchType || "default",
    fullTranslation: policy.fullTranslation || "unknown",
    fullRepublication: policy.fullRepublication || "unknown",
    media: policy.media || "separate-review",
    license: policy.license || "",
    obligations: Array.isArray(policy.obligations) ? policy.obligations : [],
    evidence: Array.isArray(policy.evidence) ? policy.evidence : []
  };
}

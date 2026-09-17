#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CONTENT_PREFIX = "content/posts/";
const CONTENT_FILES = new Map([
  ["index.md", "zh-TW"],
  ["index.zh-cn.md", "zh-CN"]
]);

export function articleRoute(slug, language) {
  if (!slug) return "";
  if (language === "zh-TW") return `/posts/${slug}/`;
  if (language === "zh-CN") return `/zh-cn/posts/${slug}/`;
  return "";
}

export function frontMatterSlug(text = "") {
  const source = String(text);
  const frontMatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontMatter) return "";

  const slugLine = frontMatter[1].match(/^slug:\s*(.*?)\s*$/m);
  if (!slugLine) return "";

  let value = slugLine[1].trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function articleBundleSlug(filePath = "") {
  const normalized = String(filePath).replaceAll("\\", "/");
  if (!normalized.startsWith(CONTENT_PREFIX)) return "";
  const rest = normalized.slice(CONTENT_PREFIX.length);
  const slash = rest.indexOf("/");
  return slash > 0 ? rest.slice(0, slash) : "";
}

export function articlePathInfo(filePath = "", routeSlug = "") {
  const normalized = String(filePath).replaceAll("\\", "/");
  if (!normalized.startsWith(CONTENT_PREFIX)) return null;
  const rest = normalized.slice(CONTENT_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const bundleSlug = rest.slice(0, slash);
  const relative = rest.slice(slash + 1);
  if (!bundleSlug || !relative) return null;
  const language = CONTENT_FILES.get(relative) || "";
  const slug = routeSlug || bundleSlug;
  return { slug, relative, language, route: language ? articleRoute(slug, language) : "" };
}

export function parseNameStatus(text = "") {
  const changes = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const parts = rawLine.split("\t");
    const status = parts[0] || "";
    if (/^[RC]\d+/.test(status)) {
      if (parts[1] && parts[2]) changes.push({ status, oldPath: parts[1], path: parts[2] });
    } else if (parts[1]) {
      changes.push({ status, path: parts[1] });
    }
  }
  return changes;
}

function addRoute(target, slug, language, reason, sourcePath) {
  const route = articleRoute(slug, language);
  if (!route) return;
  const existing = target.get(route);
  if (existing) {
    existing.reasons = [...new Set([...existing.reasons, reason])];
    existing.sourcePaths = [...new Set([...existing.sourcePaths, sourcePath].filter(Boolean))];
    return;
  }
  target.set(route, {
    route,
    slug,
    language,
    reasons: [reason],
    sourcePaths: sourcePath ? [sourcePath] : []
  });
}

export function planChangedArticleRoutes(changes = [], currentPaths = [], routeSlugs = new Map()) {
  const current = new Set(currentPaths.map(value => String(value).replaceAll("\\", "/")));
  const slugs = routeSlugs instanceof Map ? routeSlugs : new Map(Object.entries(routeSlugs || {}));
  const touchedBundles = new Map();
  const deletedContent = [];

  function resolvedInfo(filePath) {
    const normalized = String(filePath).replaceAll("\\", "/");
    return articlePathInfo(normalized, slugs.get(normalized) || "");
  }

  function touch(filePath, reason) {
    const info = resolvedInfo(filePath);
    const bundleSlug = articleBundleSlug(filePath);
    if (!info || !bundleSlug) return;
    const entry = touchedBundles.get(bundleSlug) ?? { reasons: new Set(), paths: new Set() };
    entry.reasons.add(reason);
    entry.paths.add(String(filePath).replaceAll("\\", "/"));
    touchedBundles.set(bundleSlug, entry);
  }

  for (const change of changes) {
    if (change.oldPath) touch(change.oldPath, `git:${change.status}:old`);
    if (change.path) touch(change.path, `git:${change.status}`);

    if (change.status.startsWith("D") && change.path) {
      const info = resolvedInfo(change.path);
      const bundleSlug = articleBundleSlug(change.path);
      if (info?.language && bundleSlug) deletedContent.push({ ...info, bundleSlug, status: change.status });
    }
    if (/^R\d+/.test(change.status) && change.oldPath) {
      const oldInfo = resolvedInfo(change.oldPath);
      const newInfo = resolvedInfo(change.path);
      const bundleSlug = articleBundleSlug(change.oldPath);
      if (oldInfo?.language && bundleSlug && (!newInfo || oldInfo.route !== newInfo.route)) {
        deletedContent.push({ ...oldInfo, bundleSlug, status: change.status });
      }
    }
  }

  const present = new Map();
  const absent = new Map();

  for (const [bundleSlug, touched] of touchedBundles) {
    for (const [filename, language] of CONTENT_FILES) {
      const sourcePath = `${CONTENT_PREFIX}${bundleSlug}/${filename}`;
      if (!current.has(sourcePath)) continue;
      const routeSlug = slugs.get(sourcePath) || bundleSlug;
      addRoute(
        present,
        routeSlug,
        language,
        [...touched.reasons].join(","),
        sourcePath
      );
    }
  }

  for (const deleted of deletedContent) {
    const currentPath = `${CONTENT_PREFIX}${deleted.bundleSlug}/${deleted.relative}`;
    if (current.has(currentPath)) continue;
    addRoute(absent, deleted.slug, deleted.language, `deleted:${deleted.status}`, deleted.path);
  }

  for (const route of present.keys()) absent.delete(route);

  return {
    present: [...present.values()].sort((a, b) => a.route.localeCompare(b.route)),
    absent: [...absent.values()].sort((a, b) => a.route.localeCompare(b.route))
  };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function slugAtRef(ref, filePath) {
  if (!ref || !filePath) return "";
  try {
    return frontMatterSlug(git("show", `${ref}:${filePath}`));
  } catch {
    return "";
  }
}

function buildRouteSlugMap({ base, head, changes, currentFiles }) {
  const slugs = new Map();

  for (const filePath of currentFiles) {
    const info = articlePathInfo(filePath);
    if (!info?.language) continue;
    const slug = slugAtRef(head, filePath);
    if (slug) slugs.set(filePath, slug);
  }

  for (const change of changes) {
    const oldPath = change.oldPath || (change.status.startsWith("D") ? change.path : "");
    if (!oldPath || slugs.has(oldPath)) continue;
    const info = articlePathInfo(oldPath);
    if (!info?.language) continue;
    const slug = slugAtRef(base, oldPath);
    if (slug) slugs.set(oldPath, slug);
  }

  return slugs;
}

export function buildPlanFromGit({ base = process.env.CHANGED_ROUTE_BASE || "HEAD^", head = "HEAD" } = {}) {
  const diff = git("diff", "--name-status", "-M", base, head, "--", "content/posts");
  const changes = parseNameStatus(diff);
  const currentFiles = git("ls-files", "content/posts").split(/\r?\n/).filter(Boolean);
  const routeSlugs = buildRouteSlugMap({ base, head, changes, currentFiles });
  const plan = planChangedArticleRoutes(changes, currentFiles, routeSlugs);
  return {
    version: 2,
    base,
    head,
    generatedAt: new Date().toISOString(),
    ...plan
  };
}

async function main() {
  const outputPath = process.argv[2] || "live-reader-qa/changed-routes.json";
  const plan = buildPlanFromGit();
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(
    `Changed article route plan: present=${plan.present.length}, absent=${plan.absent.length}, ` +
    `base=${plan.base}, head=${plan.head}, output=${outputPath}`
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

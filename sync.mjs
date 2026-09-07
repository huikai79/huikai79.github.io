#!/usr/bin/env node
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import fetch from "node-fetch";
import pLimit from "p-limit";
import { notionVideoMarkdown } from "./scripts/notion-video-transformer.mjs";
import { notionAudioMarkdown } from "./scripts/notion-audio-transformer.mjs";
import {
  buildNotionFilter,
  contentFilename,
  editorialFrontMatter,
  extractEditorialFields,
  normalizeSyncMode,
  productionMetadataMissing
} from "./scripts/notion-content-contract.mjs";
import {
  assignArticleBundlePaths,
  manifestBundlePath
} from "./scripts/article-bundle-contract.mjs";

/* ---------- 基本設定 ---------- */
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });
n2m.setCustomTransformer("video", notionVideoMarkdown);
n2m.setCustomTransformer("audio", notionAudioMarkdown);

const DB_ID = process.env.NOTION_DATABASE_ID;
const OUT_DIR = "content/posts";
const STAGING_DIR = `content/.posts-staging-${process.pid}`;
const BACKUP_DIR = `content/.posts-backup-${process.pid}`;
const REPORT_FILE = ".notion-sync-report.json";
const MANIFEST_FILE = ".notion-sync-manifest.json";
const MANIFEST_VERSION = 2;
const ALLOW_EMPTY = process.env.ALLOW_EMPTY_NOTION_SYNC === "true";
const SYNC_MODE = normalizeSyncMode(process.env.NOTION_SYNC_MODE || "legacy");
const filter = buildNotionFilter(SYNC_MODE);
const dl = pLimit(5);
const SECTION_INDEXES = new Map([
  ["_index.md", '---\ntitle: "文章"\ndescription: "莊輝愷的文章與筆記。"\n---\n'],
  ["_index.zh-cn.md", '---\ntitle: "文章"\ndescription: "庄辉恺的文章与笔記。"\n---\n']
]);

/* ---------- 工具函式 ---------- */
const safeSlug = s => (s ?? "").replace(/[^a-zA-Z0-9-_]/g, "-");
const yamlString = value => JSON.stringify(String(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const candidateLanguage = candidate => candidate.editorial.language || "zh-TW";
const candidateContentFile = candidate => contentFilename(candidateLanguage(candidate));
const candidateBundlePath = candidate => candidate.bundlePath;

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function fileTextEquals(file, expected) {
  try {
    return await fs.readFile(file, "utf8") === expected;
  } catch {
    return false;
  }
}

async function sectionIndexesCurrent(root) {
  for (const [file, expected] of SECTION_INDEXES) {
    if (!(await fileTextEquals(path.join(root, file), expected))) return false;
  }
  return true;
}

async function writeSectionIndexes(root) {
  for (const [file, content] of SECTION_INDEXES) {
    await fs.writeFile(path.join(root, file), content);
  }
}

async function generatorHash() {
  const hash = createHash("sha256");
  for (const source of [
    new URL(import.meta.url),
    new URL("./scripts/notion-video-transformer.mjs", import.meta.url),
    new URL("./scripts/notion-audio-transformer.mjs", import.meta.url),
    new URL("./scripts/notion-content-contract.mjs", import.meta.url),
    new URL("./scripts/article-bundle-contract.mjs", import.meta.url)
  ]) {
    hash.update(await fs.readFile(source));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function directoryHash(dir) {
  const files = [];

  async function walk(current, relativeBase = "") {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = path.posix.join(relativeBase, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        files.push({ full, rel });
      }
    }
  }

  await walk(dir);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.rel);
    hash.update("\0");
    hash.update(await fs.readFile(file.full));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function loadManifest(currentGeneratorHash) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(MANIFEST_FILE, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(`⚠️  無法讀取舊同步 manifest，將完整重建：${error.message}`);
    }
    return { manifest: { pages: {} }, reuseAllowed: false, reason: "manifest-missing" };
  }

  if (parsed.version !== MANIFEST_VERSION || !parsed.pages || typeof parsed.pages !== "object") {
    return { manifest: parsed, reuseAllowed: false, reason: "manifest-version" };
  }

  if (parsed.generatorHash !== currentGeneratorHash) {
    return { manifest: parsed, reuseAllowed: false, reason: "generator-changed" };
  }

  return { manifest: parsed, reuseAllowed: true, reason: "compatible" };
}

function safeUrlForLog(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "remote file";
  }
}

async function downloadOnce(url, dest, timeoutMs = 30000) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} ← ${safeUrlForLog(url)}`);
    await fs.writeFile(tmp, Buffer.from(await r.arrayBuffer()));
    await fs.rename(tmp, dest);
  } finally {
    clearTimeout(timer);
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

async function download(url, dest, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await downloadOnce(url, dest);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(`⚠️  下載失敗，第 ${attempt}/${attempts} 次重試：${error.message}`);
        await sleep(500 * (2 ** (attempt - 1)));
      }
    }
  }

  throw lastError;
}

function fileExtensionFromUrl(url, fallback = ".jpg") {
  try {
    return path.extname(new URL(url).pathname) || fallback;
  } catch {
    return fallback;
  }
}

function normalizeMarkdownBody(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;

  const normalized = lines.flatMap(line => {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      return [line];
    }

    if (!inFence && trimmed === "undefined") {
      return [];
    }

    if (!inFence && /^#\s+/.test(line)) {
      return [line.replace(/^#\s+/, "## ")];
    }

    return [line];
  });

  return normalized.join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function plainTextSummary(markdown, maxLength = 150) {
  const plain = markdown
    .replace(/{{<[^>]+>}}/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[>*_~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!plain) return "";
  return plain.length > maxLength ? `${plain.slice(0, maxLength).trim()}…` : plain;
}

async function localizeMarkdownImages(markdown, bundle) {
  const imagePattern = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g;
  const matches = [...markdown.matchAll(imagePattern)];
  if (!matches.length) return markdown;

  const replacements = await Promise.all(matches.map(async (match, index) => {
    const [original, alt, url] = match;
    const ext = fileExtensionFromUrl(url, ".png");
    const file = `image-${String(index + 1).padStart(2, "0")}${ext}`;

    await dl(() => download(url, path.join(bundle, file)));
    console.log("🖼️  內文圖片", file);
    return { original, replacement: `![${alt}](${file})` };
  }));

  let result = markdown;
  for (const { original, replacement } of replacements) {
    result = result.replace(original, replacement);
  }
  return result;
}

async function collectPublishedPages() {
  const pages = [];
  let cursor;

  do {
    const resp = await notion.databases.query({
      database_id: DB_ID,
      filter,
      page_size: 100,
      start_cursor: cursor
    });
    pages.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  if (!pages.length && !ALLOW_EMPTY) {
    throw new Error(
      `Notion 查詢成功但 ${SYNC_MODE} 模式沒有可同步文章；為避免意外清空網站，已停止同步。若確定要清空文章，請明確設定 ALLOW_EMPTY_NOTION_SYNC=true。`
    );
  }

  return pages;
}

function validatePages(pages) {
  const validated = pages.map(page => {
    const p = page.properties;
    const title = p.Title?.title?.map(item => item.plain_text).join("") ?? "";
    const rawSlug = p.slug?.rich_text?.map(item => item.plain_text).join("") ?? "";
    const slug = safeSlug(rawSlug);
    const date = p.date?.date?.start ?? "";
    const tags = p.tags?.multi_select?.map(tag => tag.name) ?? [];
    const lastEditedTime = page.last_edited_time ?? "";
    const editorial = extractEditorialFields(p);

    const missing = [];
    if (!title) missing.push("Title");
    if (!slug) missing.push("slug");
    if (!date) missing.push("date");
    if (!lastEditedTime) missing.push("last_edited_time");
    if (SYNC_MODE === "production") {
      missing.push(...productionMetadataMissing(editorial));
    }

    if (missing.length) {
      throw new Error(`Selected page ${page.id} 缺少必要欄位：${missing.join(", ")}`);
    }

    return { page, title, slug, date, tags, lastEditedTime, editorial };
  });

  const bundlePaths = assignArticleBundlePaths(validated.map(candidate => ({
    pageId: candidate.page.id,
    slug: candidate.slug,
    language: candidateLanguage(candidate),
    translationGroup: candidate.editorial.translationGroup || "",
    translationStatus: candidate.editorial.translationStatus || ""
  })));

  return validated
    .map(candidate => ({ ...candidate, bundlePath: bundlePaths.get(candidate.page.id) }))
    .sort((a, b) => (
      a.bundlePath.localeCompare(b.bundlePath) ||
      candidateLanguage(a).localeCompare(candidateLanguage(b)) ||
      a.page.id.localeCompare(b.page.id)
    ));
}

async function reuseDecision(candidate, manifestState) {
  if (!manifestState.reuseAllowed) {
    return { reuse: false, reason: manifestState.reason };
  }

  const previous = manifestState.manifest.pages?.[candidate.page.id];
  if (!previous) return { reuse: false, reason: "new-page" };
  if (previous.slug !== candidate.slug) return { reuse: false, reason: "slug-changed" };
  if (manifestBundlePath(previous) !== candidateBundlePath(candidate)) {
    return { reuse: false, reason: "bundle-path-changed" };
  }
  if (previous.lastEditedTime !== candidate.lastEditedTime) {
    return { reuse: false, reason: "notion-edited" };
  }
  if (previous.language && previous.language !== candidateLanguage(candidate)) {
    return { reuse: false, reason: "language-changed" };
  }
  if (!previous.bundleHash) return { reuse: false, reason: "missing-bundle-hash" };

  const oldBundle = path.join(OUT_DIR, candidateBundlePath(candidate));
  if (!(await pathExists(path.join(oldBundle, candidateContentFile(candidate))))) {
    return { reuse: false, reason: "bundle-missing" };
  }

  const currentBundleHash = await directoryHash(oldBundle);
  if (currentBundleHash !== previous.bundleHash) {
    return { reuse: false, reason: "bundle-drift" };
  }

  return { reuse: true, reason: "unchanged", bundleHash: currentBundleHash };
}

async function buildArticle(candidate) {
  const { page, title, slug, date, tags } = candidate;
  const full = await notion.pages.retrieve({ page_id: page.id });
  const bundle = path.join(STAGING_DIR, candidateBundlePath(candidate));
  await fs.mkdir(bundle, { recursive: true });

  let coverField = "";
  const coverUrl = full.cover?.external?.url || full.cover?.file?.url || "";
  if (coverUrl) {
    const ext = fileExtensionFromUrl(coverUrl, ".jpg");
    const file = `cover${ext}`;
    await dl(() => download(coverUrl, path.join(bundle, file)));
    coverField = file;
    console.log("🖼️  封面", file);
  }

  let iconField = "";
  if (full.icon?.type === "emoji") {
    iconField = full.icon.emoji;
  } else {
    const iconUrl = full.icon?.external?.url || full.icon?.file?.url || "";
    if (iconUrl) {
      const ext = fileExtensionFromUrl(iconUrl, ".png");
      const file = `icon${ext}`;
      await dl(() => download(iconUrl, path.join(bundle, file)));
      iconField = file;
      console.log("✨  圖示", file);
    }
  }

  const mdBlocks = await n2m.pageToMarkdown(page.id);
  let mdBody = n2m.toMarkdownString(mdBlocks).parent.replace(
    /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})\S*/g,
    (_m, id) => `{{< youtube ${id} >}}`
  );
  mdBody = normalizeMarkdownBody(mdBody);
  mdBody = await localizeMarkdownImages(mdBody, bundle);

  const productionFields = SYNC_MODE === "production"
    ? editorialFrontMatter({ title, slug, date, ...candidate.editorial })
    : null;
  const description = productionFields?.description || plainTextSummary(mdBody);

  const front = [
    "---",
    `title: ${yamlString(title)}`,
    `date: ${yamlString(date)}`,
    `slug: ${yamlString(slug)}`,
    description && `description: ${yamlString(description)}`,
    `tags: [${tags.map(yamlString).join(", ")}]`,
    productionFields && `categories: [${productionFields.categories.map(yamlString).join(", ")}]`,
    productionFields && `entryType: ${yamlString(productionFields.entryType)}`,
    productionFields && `formats: [${yamlString(productionFields.entryType)}]`,
    productionFields && `contentVisibility: ${yamlString(productionFields.contentVisibility)}`,
    productionFields && `homePlacement: ${yamlString(productionFields.homePlacement)}`,
    productionFields && `contentLanguage: ${yamlString(productionFields.contentLanguage)}`,
    productionFields && `translationKey: ${yamlString(productionFields.translationKey)}`,
    coverField && `cover: ${yamlString(coverField)}`,
    iconField && `icon: ${yamlString(iconField)}`,
    coverField && `images: [${yamlString(coverField)}]`,
    "---"
  ].filter(Boolean).join("\n");

  const contentFile = candidateContentFile(candidate);
  await fs.writeFile(path.join(bundle, contentFile), `${front}\n\n${mdBody}\n`);
  console.log("📄  重建", `${candidateBundlePath(candidate)}/${contentFile} -> ${candidateLanguage(candidate)}/posts/${slug}`);
  return directoryHash(bundle);
}

async function replaceOutput() {
  const hadOldOutput = await pathExists(OUT_DIR);
  await fs.rm(BACKUP_DIR, { recursive: true, force: true });

  if (hadOldOutput) {
    await fs.rename(OUT_DIR, BACKUP_DIR);
  }

  try {
    await fs.rename(STAGING_DIR, OUT_DIR);
  } catch (error) {
    if (hadOldOutput && !(await pathExists(OUT_DIR)) && await pathExists(BACKUP_DIR)) {
      await fs.rename(BACKUP_DIR, OUT_DIR);
    }
    throw error;
  }

  if (hadOldOutput) {
    await fs.rm(BACKUP_DIR, { recursive: true, force: true });
  }
}

function stablePagesObject(entries) {
  return Object.fromEntries(
    [...entries.entries()].sort(([a], [b]) => a.localeCompare(b))
  );
}

function manifestEntry(candidate, bundleHash) {
  return {
    slug: candidate.slug,
    bundlePath: candidateBundlePath(candidate),
    language: candidateLanguage(candidate),
    translationGroup: candidate.editorial.translationGroup || "",
    contentFile: candidateContentFile(candidate),
    lastEditedTime: candidate.lastEditedTime,
    bundleHash
  };
}

/* ---------- 主流程 ---------- */
async function sync() {
  if (!process.env.NOTION_TOKEN) throw new Error("NOTION_TOKEN 未設定");
  if (!DB_ID) throw new Error("NOTION_DATABASE_ID 未設定");

  await fs.rm(REPORT_FILE, { force: true });
  await fs.rm(STAGING_DIR, { recursive: true, force: true });
  await fs.rm(BACKUP_DIR, { recursive: true, force: true });

  try {
    const pages = await collectPublishedPages();
    const candidates = validatePages(pages);
    const currentGeneratorHash = await generatorHash();
    const manifestState = await loadManifest(currentGeneratorHash);

    const previousPages = manifestState.manifest.pages ?? {};
    const currentIds = new Set(candidates.map(candidate => candidate.page.id));
    const deleted = Object.entries(previousPages)
      .filter(([pageId]) => !currentIds.has(pageId))
      .map(([, entry]) => entry.slug)
      .filter(Boolean)
      .sort();

    const plans = [];
    for (const candidate of candidates) {
      plans.push({
        candidate,
        decision: await reuseDecision(candidate, manifestState)
      });
    }

    const reused = plans.filter(plan => plan.decision.reuse).length;
    const rebuilt = plans.length - reused;
    const sectionCurrent = await sectionIndexesCurrent(OUT_DIR);
    const fastPath = rebuilt === 0 && deleted.length === 0 && sectionCurrent;

    const nextPages = new Map();

    if (fastPath) {
      for (const plan of plans) {
        const { candidate, decision } = plan;
        nextPages.set(candidate.page.id, manifestEntry(candidate, decision.bundleHash));
        console.log("♻️  沿用", `${candidateBundlePath(candidate)}/${candidateContentFile(candidate)}`);
      }
      console.log(`⚡ 所有 ${SYNC_MODE} 模式文章均未變更，略過 Markdown 與媒體重新下載`);
    } else {
      await fs.mkdir(STAGING_DIR, { recursive: true });
      await writeSectionIndexes(STAGING_DIR);

      for (const plan of plans) {
        const { candidate, decision } = plan;
        let bundleHash;

        if (decision.reuse) {
          const source = path.join(OUT_DIR, candidateBundlePath(candidate));
          const target = path.join(STAGING_DIR, candidateBundlePath(candidate));
          await fs.cp(source, target, { recursive: true });
          bundleHash = decision.bundleHash;
          console.log("♻️  沿用", `${candidateBundlePath(candidate)}/${candidateContentFile(candidate)}`);
        } else {
          console.log(`🔄 需要重建 ${candidateBundlePath(candidate)}：${decision.reason}`);
          bundleHash = await buildArticle(candidate);
        }

        nextPages.set(candidate.page.id, manifestEntry(candidate, bundleHash));
      }

      await replaceOutput();
    }

    const written = reused + rebuilt;
    if (written !== candidates.length) {
      throw new Error(`同步數量不一致：selected=${candidates.length}, written=${written}`);
    }

    const nextManifest = {
      version: MANIFEST_VERSION,
      generatorHash: currentGeneratorHash,
      pages: stablePagesObject(nextPages)
    };
    await fs.writeFile(MANIFEST_FILE, `${JSON.stringify(nextManifest, null, 2)}\n`);

    const report = {
      status: "complete",
      mode: SYNC_MODE,
      published: candidates.length,
      written,
      reused,
      rebuilt,
      deleted,
      fastPath,
      manifestReuse: manifestState.reuseAllowed,
      manifestReason: manifestState.reason,
      pages: plans.map(plan => ({
        pageId: plan.candidate.page.id,
        slug: plan.candidate.slug,
        bundlePath: candidateBundlePath(plan.candidate),
        language: candidateLanguage(plan.candidate),
        translationGroup: plan.candidate.editorial.translationGroup || "",
        contentFile: candidateContentFile(plan.candidate),
        action: plan.decision.reuse ? "reused" : "rebuilt",
        reason: plan.decision.reason,
        lastEditedTime: plan.candidate.lastEditedTime
      })),
      completedAt: new Date().toISOString()
    };
    await fs.writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);

    if (deleted.length) {
      console.log(`🗑️  移除未再符合 ${SYNC_MODE} 模式的文章：${deleted.join(", ")}`);
    }
    console.log(
      `✅ 同步完成：mode=${SYNC_MODE}, selected=${candidates.length}, reused=${reused}, rebuilt=${rebuilt}, deleted=${deleted.length}`
    );
  } catch (error) {
    await fs.rm(STAGING_DIR, { recursive: true, force: true }).catch(() => {});
    if (!(await pathExists(OUT_DIR)) && await pathExists(BACKUP_DIR)) {
      await fs.rename(BACKUP_DIR, OUT_DIR).catch(() => {});
    }
    throw error;
  } finally {
    await fs.rm(STAGING_DIR, { recursive: true, force: true }).catch(() => {});
    if (await pathExists(OUT_DIR)) {
      await fs.rm(BACKUP_DIR, { recursive: true, force: true }).catch(() => {});
    }
  }
}

sync().catch(error => {
  console.error("❌ Notion sync failed:", error.message);
  process.exit(1);
});

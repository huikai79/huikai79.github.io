#!/usr/bin/env node
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import fetch from "node-fetch";
import pLimit from "p-limit";

/* ---------- 基本設定 ---------- */
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

const DB_ID = process.env.NOTION_DATABASE_ID;
const OUT_DIR = "content/posts";
const STAGING_DIR = `content/.posts-staging-${process.pid}`;
const BACKUP_DIR = `content/.posts-backup-${process.pid}`;
const REPORT_FILE = ".notion-sync-report.json";
const MANIFEST_FILE = ".notion-sync-manifest.json";
const MANIFEST_VERSION = 1;
const ALLOW_EMPTY = process.env.ALLOW_EMPTY_NOTION_SYNC === "true";
const filter = { property: "status", status: { equals: "Published" } };
const dl = pLimit(5);
const SECTION_INDEX = '---\ntitle: "文章"\ndescription: "庄辉恺的文章与笔记。"\n---\n';

/* ---------- 工具函式 ---------- */
const safeSlug = s => (s ?? "").replace(/[^a-zA-Z0-9-_]/g, "-");
const yamlString = value => JSON.stringify(String(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

async function generatorHash() {
  const source = await fs.readFile(new URL(import.meta.url));
  return createHash("sha256").update(source).digest("hex");
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

    // The article page template owns the single document H1. Notion body H1s
    // are content headings, so demote them to H2 instead of rendering a second H1.
    if (!inFence && /^#\s+/.test(line)) {
      return [line.replace(/^#\s+/, "## ")];
    }

    return [line];
  });

  return normalized.join("\n").replace(/\n{4,}/g, "\n\n\n").trimStart();
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
      "Notion 查詢成功但沒有 Published 文章；為避免意外清空網站，已停止同步。若確定要清空文章，請明確設定 ALLOW_EMPTY_NOTION_SYNC=true。"
    );
  }

  return pages;
}

function validatePages(pages) {
  const seenSlugs = new Map();

  const validated = pages.map(page => {
    const p = page.properties;
    const title = p.Title?.title?.map(item => item.plain_text).join("") ?? "";
    const rawSlug = p.slug?.rich_text?.map(item => item.plain_text).join("") ?? "";
    const slug = safeSlug(rawSlug);
    const date = p.date?.date?.start ?? "";
    const tags = p.tags?.multi_select?.map(tag => tag.name) ?? [];
    const lastEditedTime = page.last_edited_time ?? "";

    const missing = [];
    if (!title) missing.push("Title");
    if (!slug) missing.push("slug");
    if (!date) missing.push("date");
    if (!lastEditedTime) missing.push("last_edited_time");

    if (missing.length) {
      throw new Error(`Published page ${page.id} 缺少必要欄位：${missing.join(", ")}`);
    }

    if (seenSlugs.has(slug)) {
      throw new Error(`Published 文章 slug 重複：${slug}（${seenSlugs.get(slug)} / ${page.id}）`);
    }
    seenSlugs.set(slug, page.id);

    return { page, title, slug, date, tags, lastEditedTime };
  });

  return validated.sort((a, b) => a.slug.localeCompare(b.slug));
}

async function reuseDecision(candidate, manifestState) {
  if (!manifestState.reuseAllowed) {
    return { reuse: false, reason: manifestState.reason };
  }

  const previous = manifestState.manifest.pages?.[candidate.page.id];
  if (!previous) return { reuse: false, reason: "new-page" };
  if (previous.slug !== candidate.slug) return { reuse: false, reason: "slug-changed" };
  if (previous.lastEditedTime !== candidate.lastEditedTime) {
    return { reuse: false, reason: "notion-edited" };
  }
  if (!previous.bundleHash) return { reuse: false, reason: "missing-bundle-hash" };

  const oldBundle = path.join(OUT_DIR, candidate.slug);
  if (!(await pathExists(path.join(oldBundle, "index.md")))) {
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
  const bundle = path.join(STAGING_DIR, slug);
  await fs.mkdir(bundle, { recursive: true });

  /* 封面：只要 Notion 有指定，就必須成功本地化 */
  let coverField = "";
  const coverUrl = full.cover?.external?.url || full.cover?.file?.url || "";
  if (coverUrl) {
    const ext = fileExtensionFromUrl(coverUrl, ".jpg");
    const file = `cover${ext}`;
    await dl(() => download(coverUrl, path.join(bundle, file)));
    coverField = file;
    console.log("🖼️  封面", file);
  }

  /* icon：emoji 直接保存；遠端圖片必須成功本地化 */
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

  /* Notion → Markdown；文章 H1 由 Hugo template 擁有，再把內文圖片本地化 */
  const mdBlocks = await n2m.pageToMarkdown(page.id);
  let mdBody = n2m.toMarkdownString(mdBlocks).parent.replace(
    /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})\S*/g,
    (_m, id) => `{{< youtube ${id} >}}`
  );
  mdBody = normalizeMarkdownBody(mdBody);
  mdBody = await localizeMarkdownImages(mdBody, bundle);
  const description = plainTextSummary(mdBody);

  /* Front matter */
  const front = [
    "---",
    `title: ${yamlString(title)}`,
    `date: ${yamlString(date)}`,
    `slug: ${yamlString(slug)}`,
    description && `description: ${yamlString(description)}`,
    `tags: [${tags.map(yamlString).join(", ")}]`,
    coverField && `cover: ${yamlString(coverField)}`,
    iconField && `icon: ${yamlString(iconField)}`,
    coverField && `images: [${yamlString(coverField)}]`,
    "---",
    ""
  ].filter(Boolean).join("\n");

  await fs.writeFile(path.join(bundle, "index.md"), front + mdBody);
  console.log("📄  重建", `${slug}/index.md`);
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

/* ---------- 主流程 ---------- */
async function sync() {
  if (!process.env.NOTION_TOKEN) throw new Error("NOTION_TOKEN 未設定");
  if (!DB_ID) throw new Error("NOTION_DATABASE_ID 未設定");

  await fs.rm(REPORT_FILE, { force: true });
  await fs.rm(STAGING_DIR, { recursive: true, force: true });
  await fs.rm(BACKUP_DIR, { recursive: true, force: true });

  try {
    /* 1. 只抓 database snapshot，先驗證欄位與唯一 slug */
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
    const sectionCurrent = await fileTextEquals(path.join(OUT_DIR, "_index.md"), SECTION_INDEX);
    const fastPath = rebuilt === 0 && deleted.length === 0 && sectionCurrent;

    const nextPages = new Map();

    if (fastPath) {
      for (const plan of plans) {
        const { candidate, decision } = plan;
        nextPages.set(candidate.page.id, {
          slug: candidate.slug,
          lastEditedTime: candidate.lastEditedTime,
          bundleHash: decision.bundleHash
        });
        console.log("♻️  沿用", `${candidate.slug}/index.md`);
      }
      console.log("⚡ 所有 Published 文章均未變更，略過 Markdown 與媒體重新下載");
    } else {
      /* 2. 需要變更時才建立 staging snapshot */
      await fs.mkdir(STAGING_DIR, { recursive: true });
      await fs.writeFile(path.join(STAGING_DIR, "_index.md"), SECTION_INDEX);

      for (const plan of plans) {
        const { candidate, decision } = plan;
        let bundleHash;

        if (decision.reuse) {
          const source = path.join(OUT_DIR, candidate.slug);
          const target = path.join(STAGING_DIR, candidate.slug);
          await fs.cp(source, target, { recursive: true });
          bundleHash = decision.bundleHash;
          console.log("♻️  沿用", `${candidate.slug}/index.md`);
        } else {
          console.log(`🔄 需要重建 ${candidate.slug}：${decision.reason}`);
          bundleHash = await buildArticle(candidate);
        }

        nextPages.set(candidate.page.id, {
          slug: candidate.slug,
          lastEditedTime: candidate.lastEditedTime,
          bundleHash
        });
      }

      /* 3. staging 完整成功後才替換正式輸出 */
      await replaceOutput();
    }

    const written = reused + rebuilt;
    if (written !== candidates.length) {
      throw new Error(`同步數量不一致：Published=${candidates.length}, written=${written}`);
    }

    /* 4. manifest 必須 deterministic，無變更時 Git 不應產生差異 */
    const nextManifest = {
      version: MANIFEST_VERSION,
      generatorHash: currentGeneratorHash,
      pages: stablePagesObject(nextPages)
    };
    await fs.writeFile(MANIFEST_FILE, `${JSON.stringify(nextManifest, null, 2)}\n`);

    /* 5. report 提供 CI 與 Actions Summary 使用，不加入 Git */
    const report = {
      status: "complete",
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
        action: plan.decision.reuse ? "reused" : "rebuilt",
        reason: plan.decision.reason,
        lastEditedTime: plan.candidate.lastEditedTime
      })),
      completedAt: new Date().toISOString()
    };
    await fs.writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);

    if (deleted.length) {
      console.log(`🗑️  移除未再 Published 的文章：${deleted.join(", ")}`);
    }
    console.log(
      `✅ 同步完成：Published=${candidates.length}, reused=${reused}, rebuilt=${rebuilt}, deleted=${deleted.length}`
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
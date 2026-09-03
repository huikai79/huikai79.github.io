#!/usr/bin/env node
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
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
const ALLOW_EMPTY = process.env.ALLOW_EMPTY_NOTION_SYNC === "true";
const filter = { property: "status", status: { equals: "Published" } };
const dl = pLimit(5);

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

    const missing = [];
    if (!title) missing.push("Title");
    if (!slug) missing.push("slug");
    if (!date) missing.push("date");

    if (missing.length) {
      throw new Error(`Published page ${page.id} 缺少必要欄位：${missing.join(", ")}`);
    }

    if (seenSlugs.has(slug)) {
      throw new Error(`Published 文章 slug 重複：${slug}（${seenSlugs.get(slug)} / ${page.id}）`);
    }
    seenSlugs.set(slug, page.id);

    return { page, title, slug, date, tags };
  });

  return validated.sort((a, b) => a.slug.localeCompare(b.slug));
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

  /* Notion → Markdown，並把內文圖片本地化 */
  const mdBlocks = await n2m.pageToMarkdown(page.id);
  let mdBody = n2m.toMarkdownString(mdBlocks).parent.replace(
    /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})\S*/g,
    (_m, id) => `{{< youtube ${id} >}}`
  );
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
  console.log("📄  寫入", `${slug}/index.md`);
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

/* ---------- 主流程 ---------- */
async function sync() {
  if (!process.env.NOTION_TOKEN) throw new Error("NOTION_TOKEN 未設定");
  if (!DB_ID) throw new Error("NOTION_DATABASE_ID 未設定");

  await fs.rm(REPORT_FILE, { force: true });
  await fs.rm(STAGING_DIR, { recursive: true, force: true });
  await fs.rm(BACKUP_DIR, { recursive: true, force: true });

  try {
    /* 1. 先完整抓取並驗證 Published snapshot；此時不碰正式輸出 */
    const pages = await collectPublishedPages();
    const candidates = validatePages(pages);

    /* 2. 在 staging 建立完整新快照 */
    await fs.mkdir(STAGING_DIR, { recursive: true });
    await fs.writeFile(
      path.join(STAGING_DIR, "_index.md"),
      '---\ntitle: "文章"\ndescription: "庄辉恺的文章与笔记。"\n---\n'
    );

    let written = 0;
    for (const candidate of candidates) {
      await buildArticle(candidate);
      written += 1;
    }

    if (written !== candidates.length) {
      throw new Error(`同步數量不一致：Published=${candidates.length}, written=${written}`);
    }

    /* 3. 全部成功後才替換正式輸出 */
    await replaceOutput();

    /* 4. 寫入機器可讀報告，供 CI 驗證，不加入 Git */
    const report = {
      status: "complete",
      published: candidates.length,
      written,
      slugs: candidates.map(candidate => candidate.slug),
      completedAt: new Date().toISOString()
    };
    await fs.writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);

    console.log(`✅ 同步完成：Published=${candidates.length}, written=${written}`);
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

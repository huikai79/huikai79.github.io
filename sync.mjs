#!/usr/bin/env node
/**
 * Sync Notion database → Hugo Markdown
 * 封面 / icon 下載至 static/images
 * 需要環境變數：
 *   NOTION_TOKEN
 *   NOTION_DATABASE_ID  (32+4 字元 UUID)
 */

import { Client }           from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import fs                   from "node:fs/promises";
import path                 from "node:path";
import fetch                from "node-fetch";   // Node ≥18 亦可用全局 fetch
import pLimit               from "p-limit";

const notion   = new Client({ auth: process.env.NOTION_TOKEN });
const n2m      = new NotionToMarkdown({ notionClient: notion });

const DB_ID    = process.env.NOTION_DATABASE_ID;
const OUT_DIR  = "content/posts";
const IMG_DIR  = "static/images";
const filter   = { property: "status", status: { equals: "Published" } };

const dlLimit  = pLimit(5);          // 同時最多 5 個下載

/* ---------- 工具函式 ---------- */
async function download(url, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ⟨${url}⟩`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

const safeSlug = s => s.replace(/[^a-zA-Z0-9-_]/g, "-");

/* ---------- 主流程 ---------- */
async function sync() {
  // 0. 驗證 ID 格式
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(DB_ID)) {
    throw new Error("❌ NOTION_DATABASE_ID 格式錯誤，請確認 Secrets");
  }

  // 1. 若無文章避免清空
  const probe = await notion.databases.query({ database_id: DB_ID, filter, page_size: 1 });
  if (!probe.results.length) {
    console.error("⚠️  無 Published 文章，停止同步");
    process.exit(1);
  }

  // 2. 清空輸出目錄
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.rm(IMG_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(IMG_DIR, { recursive: true });

  let cursor, total = 0;
  do {
    const resp = await notion.databases.query({
      database_id: DB_ID, filter, start_cursor: cursor, page_size: 100
    });
    total += resp.results.length;

    for (const brief of resp.results) {
      const full = await notion.pages.retrieve({ page_id: brief.id });
      const p    = brief.properties;

      const title = p.Title?.title[0]?.plain_text ?? "";
      const slug  = safeSlug(p.slug?.rich_text[0]?.plain_text ?? "");
      const date  = p.date?.date?.start ?? "";
      const tags  = p.tags?.multi_select.map(t => t.name) ?? [];
      if (!title || !slug || !date) continue;

      /* ------- 封面 ------- */
      let coverField = "";
      const coverUrl = full.cover?.external?.url || full.cover?.file?.url || "";
      if (coverUrl) {
        const coverFile = `${slug}-cover${path.extname(new URL(coverUrl).pathname) || ".jpg"}`;
        const coverDest = path.join(IMG_DIR, coverFile);
        try {
          await dlLimit(() => download(coverUrl, coverDest));
          coverField = path.posix.join("images", coverFile);
          console.log("🖼️  Cover →", coverDest);
        } catch (err) {
          console.warn("⚠️  Cover 下載失敗:", err.message);
        }
      }

      /* ------- Icon ------- */
      let iconField = "";
      if (full.icon?.type === "emoji") {
        iconField = full.icon.emoji;
      } else {
        const iconUrl = full.icon?.external?.url || full.icon?.file?.url || "";
        if (iconUrl) {
          const iconFile = `${slug}-icon${path.extname(new URL(iconUrl).pathname) || ".png"}`;
          const iconDest = path.join(IMG_DIR, iconFile);
          try {
            await dlLimit(() => download(iconUrl, iconDest));
            iconField = path.posix.join("images", iconFile);
            console.log("✨  Icon  →", iconDest);
          } catch (err) {
            console.warn("⚠️  Icon 下載失敗:", err.message);
          }
        }
      }

      /* ------- 正文 Markdown ------- */
      const mdBlocks = await n2m.pageToMarkdown(brief.id);
      let mdBody = n2m.toMarkdownString(mdBlocks).parent
        .replace(
          /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})\S*/g,
          (_m, id) => `{{< youtube ${id} >}}`
        );

      /* ------- Front‑matter ------- */
      const front = [
        "---",
        `title: "${title.replace(/"/g, '\\"')}"`,
        `date: "${date}"`,
        `slug: "${slug}"`,
        `tags: [${tags.map(t => `"${t}"`).join(", ")}]`,
        coverField && `cover: "${coverField}"`,
        iconField  && `icon: "${iconField}"`,
        "---",
        ""
      ].filter(Boolean).join("\n"

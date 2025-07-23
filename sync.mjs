#!/usr/bin/env node
/**
 * Sync Notion database → Hugo Markdown
 * - 下載 cover / icon 至 static/images
 * - 支援 YouTube 連結轉 Hugo shortcode
 * 需要環境變數：
 *   NOTION_TOKEN
 *   NOTION_DATABASE_ID  (32+4 UUID)
 */
import { Client }           from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import fs                   from "node:fs/promises";
import path                 from "node:path";
import fetch                from "node-fetch";
import pLimit               from "p-limit";

const notion   = new Client({ auth: process.env.NOTION_TOKEN });
const n2m      = new NotionToMarkdown({ notionClient: notion });

const DB_ID    = process.env.NOTION_DATABASE_ID;
const OUT_DIR  = "content/posts";
const IMG_DIR  = "static/images";
const filter   = { property: "status", status: { equals: "Published" } };

const dlLimit  = pLimit(5);                          // 同時最多 5 隻下載

/* ---------- 小工具 ---------- */
async function download(url, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} : ${url}`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}
const safeSlug = s => s.replace(/[^a-zA-Z0-9-_]/g, "-");

/* ---------- 主程式 ---------- */
async function sync() {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(DB_ID))
    throw new Error("NOTION_DATABASE_ID 格式錯誤，請檢查 Secrets！");

  // 若無文章直接結束，避免清空站點
  const probe = await notion.databases.query({ database_id: DB_ID, filter, page_size: 1 });
  if (!probe.results.length) { console.error("⚠️  無 Published 文章"); return; }

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
        try {
          await dlLimit(() => download(coverUrl, path.join(IMG_DIR, coverFile)));
          coverField = path.posix.join("images", coverFile);
          console.log("🖼️  Cover 下載完成 :", coverFile);
        } catch (e) { console.warn("⚠️  Cover 失敗 :", e.message); }
      }

      /* ------- Icon ------- */
      let iconField = "";
      if (full.icon?.type === "emoji") {
        iconField = full.icon.emoji;
      } else {
        const iconUrl = full.icon?.external?.url || full.icon?.file?.url || "";
        if (iconUrl) {
          const iconFile = `${slug}-icon${path.extname(new URL(iconUrl).pathname) || ".png"}`;
          try {
            await dlLimit(() => download(iconUrl, path.join(IMG_DIR, iconFile)));
            iconField = path.posix.join("images", iconFile);
            console.log("✨  Icon  下載完成 :", iconFile);
          } catch (e) { console.warn("⚠️  Icon 失敗  :", e.message); }
        }
      }

      /* ------- Markdown 正文 ------- */
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
      ].filter(Boolean).join("\n");

      const filePath = path.join(OUT_DIR, `${slug}.md`);
      await fs.writeFile(filePath, front + mdBody);
      console.log("📄  寫入完成 ->", filePath);
    }

    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  console.log(`✅ 同步完成，共 ${total} 篇`);
}

sync().catch(err => { console.error("❌  發生錯誤 :", err); process.exit(1); });

#!/usr/bin/env node
/**
 * Notion → Markdown 同步脚本
 * 需求：
 *   - NOTION_TOKEN
 *   - NOTION_DATABASE_ID
 * 产出：
 *   - content/posts/*.md（含 cover / icon / tags / youtube shortcode）
 */

import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import fs   from "node:fs/promises";
import path from "node:path";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m    = new NotionToMarkdown({ notionClient: notion });

const DB_ID   = process.env.NOTION_DATABASE_ID;
const OUT_DIR = "content/posts";

// 只同步 Status 欄位為 Published 的頁面
const filter = { property: "status", status: { equals: "Published" } };

async function sync() {
  /* ---------- 0 结果保护 ---------- */
  const probe = await notion.databases.query({ database_id: DB_ID, filter, page_size: 1 });
  if (!probe.results.length) {
    console.error("⚠️ 沒有 Published 文章，停止同步以免清空站點");
    process.exit(1);
  }

  /* ---------- 清理並重建輸出目錄 ---------- */
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  let cursor, total = 0;
  do {
    const resp = await notion.databases.query({
      database_id: DB_ID,
      filter,
      start_cursor: cursor,
      page_size: 100,
    });
    total += resp.results.length;

    for (const brief of resp.results) {
      // 需要 pages.retrieve 才能拿到 cover / icon
      const full = await notion.pages.retrieve({ page_id: brief.id });

      const props = brief.properties;
      const title = props.Title?.title[0]?.plain_text ?? "";
      const slug  = props.slug?.rich_text[0]?.plain_text ?? "";
      const date  = props.date?.date?.start ?? "";
      const tags  = props.tags?.multi_select.map(t => t.name) ?? [];

      if (!title || !slug || !date) {
        console.warn(`⚠️ 資料缺失，跳過：${brief.id}`);
        continue;
      }

      const cover =
        full.cover?.external?.url ||
        full.cover?.file?.url    || "";

      const icon =
        full.icon?.emoji ||
        full.icon?.external?.url ||
        full.icon?.file?.url     || "";

      /* ---------- 內容轉 Markdown ---------- */
      const mdBlocks = await n2m.pageToMarkdown(brief.id);
      let mdString   = n2m.toMarkdownString(mdBlocks).parent;

      // YouTube 連結 → Hugo shortcode
      mdString = mdString.replace(
        /https?:\/\/(?:www\.)?(?:youtu\.be\/|youtube\.com\/watch\?v=)([A-Za-z0-9_-]{11})\S*/g,
        (_m, id) => `{{< youtube ${id} >}}`
      );

      /* ---------- Front‑matter ---------- */
      const front = `---\n`
                  + `title: "${title.replace(/"/g, '\\"')}"\n`
                  + `date: ${date}\n`
                  + `slug: "${slug}"\n`
                  + `tags: [${tags.map(t => `"${t}"`).join(", ")}]\n`
                  + (cover ? `cover: "${cover}"\n` : "")
                  + (icon  ? `icon: "${icon}"\n`   : "")
                  + `---\n\n`;

      const filePath = path.join(OUT_DIR, `${slug}.md`);
      await fs.writeFile(filePath, front + mdString);
      console.log("✅ 已寫入", filePath);
    }

    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  console.log(`🎉 同步完成，共 ${total} 篇文章`);
}

sync().catch(err => {
  console.error("❌ 同步失敗：", err);
  process.exit(1);
});

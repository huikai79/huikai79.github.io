#!/usr/bin/env node

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

const dlLimit  = pLimit(5); // 同时最多下载 5 个文件

async function download(url, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下載失敗 HTTP ${res.status} ⟨${url}⟩`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

function safeSlug(s) {
  return s.replace(/[^a-zA-Z0-9-_]/g, "-");
}

async function sync() {
  // 避免沒有內容時就清空資料夾
  const probe = await notion.databases.query({ database_id: DB_ID, filter, page_size: 1 });
  if (!probe.results.length) {
    console.error("⚠️  無 Published 文章，停止同步");
    process.exit(1);
  }

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.rm(IMG_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(IMG_DIR, { recursive: true });

  let cursor, total = 0;
  do {
    const resp = await notion.databases.query({ database_id: DB_ID, filter, start_cursor: cursor, page_size: 100 });
    total += resp.results.length;

    for (const brief of resp.results) {
      const full = await notion.pages.retrieve({ page_id: brief.id });
      const p = brief.properties;

      const title = p.Title?.title[0]?.plain_text ?? "";
      const slug  = safeSlug(p.slug?.rich_text[0]?.plain_text ?? "");
      const date  = p.date?.date?.start ?? "";
      const tags  = p.tags?.multi_select.map(t => t.name) ?? [];

      if (!title || !slug || !date) {
        console.warn("⏭️  缺必要欄位，略過頁面", title || brief.id);
        continue;
      }

      // -------- Cover 下载 --------
      let coverField = "";
      const coverUrl = full.cover?.external?.url || full.cover?.file?.url || "";
      if (coverUrl) {
        const ext = path.extname(new URL(coverUrl).pathname) || ".jpg";
        const file = `${slug}-cover${ext}`;
        const dest = path.join(IMG_DIR, file);
        try {
          await dlLimit(() => download(coverUrl, dest));
          coverField = path.posix.join("images", file);
          console.log("🖼️  Saved cover", dest);
        } catch (err) {
          console.warn("⚠️  Cover fail:", err.message);
        }
      }

      // -------- Icon 下载 --------
      let iconField = "";
      if (full.icon?.type === "emoji") {
        iconField = full.icon.emoji;
      } else {
        const iconUrl = full.icon?.external?.url || full.icon?.file?.url || "";
        if (iconUrl) {
          const ext = path.extname(new URL(iconUrl).pathname) || ".png";
          const file = `${slug}-icon${ext}`;
          const dest = path.join(IMG_DIR, file);
          try {
            await dlLimit(() => download(iconUrl, dest));
            iconField = path.posix.join("images", file);
            console.log("✨  Saved icon", dest);
          } catch (err) {
            console.warn("⚠️  Icon fail:", err.message);
          }
        }
      }

      // -------- Markdown 内容 --------
      const mdBlocks = await n2m.pageToMarkdown(brief.id);
      let mdBody = n2m.toMarkdownString(mdBlocks).parent
        .replace(
          /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})\S*/g,
          (_m, id) => `{{< youtube ${id} >}}`
        );

      // -------- Front‑matter --------
      const escape = (s = "") => s.replace(/"/g, '\\"');  // 简单转义

      const front = [
        "---",
        `title: "${escape(title)}"`,
        `date: "${date}"`,
        `slug: "${slug}"`,
        `tags: [${tags.map(t => `"${escape(t)}"`).join(", ")}]`,
        coverField && `cover: "${coverField}"`,
        iconField  && `icon: "${iconField}"`,
        coverField && `images: ["${coverField}"]`,
        "---",
        ""
      ].filter(Boolean).join("\n");

      const filePath = path.join(OUT_DIR, `${slug}.md`);
      await fs.writeFile(filePath, front + mdBody);
      console.log("📄  Wrote", filePath);
      console.log("📄  Wrote", filePath);
    }

    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  console.log(`✅ 完成，共 ${total} 篇`);
}

sync().catch(err => {
  console.error("❌ 同步失敗：", err.message);
  process.exit(1);
});


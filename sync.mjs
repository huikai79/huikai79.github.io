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
const IMG_DIR  = "static/images";         // 下載後放這裡
const filter   = { property: "status", status: { equals: "Published" } };

const dlLimit  = pLimit(5);               // 同時最多 5 個下載

async function download(url, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ⟨${url}⟩`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

function safeSlug(s) {                    // 檔名安全化
  return s.replace(/[^a-zA-Z0-9-_]/g, "-");
}

async function sync() {
  // 0. 若無文章避免清空
  const probe = await notion.databases.query({ database_id: DB_ID, filter, page_size: 1 });
  if (!probe.results.length) {
    console.error("⚠️  無 Published 文章，停止同步");
    process.exit(1);
  }

  // 1. 清空輸出
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
      const p    = brief.properties;

      const title = p.Title?.title[0]?.plain_text ?? "";
      const slug  = safeSlug(p.slug?.rich_text[0]?.plain_text ?? "");
      const date  = p.date?.date?.start ?? "";
      const tags  = p.tags?.multi_select.map(t => t.name) ?? [];
      if (!title || !slug || !date) continue;

      /* ---------- 封面 & 圖示 ---------- */
      let coverField = "";
      const coverUrl = full.cover?.external?.url || full.cover?.file?.url || "";
      if (coverUrl) {
        const coverFile = `${slug}-cover${path.extname(new URL(coverUrl).pathname) || ".jpg"}`;
        const coverDest = path.join(IMG_DIR, coverFile);
        try {
          await dlLimit(() => download(coverUrl, coverDest));
          coverField = path.posix.join("images", coverFile);
          console.log("🖼️  Saved cover", coverDest);
        } catch (err) {
          console.warn("⚠️  Cover fail:", err.message);
        }
      }

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
            console.log("✨  Saved icon", iconDest);
          } catch (err) {
            console.warn("⚠️  Icon fail:", err.message);
          }
        }
      }

      /* ---------- 內容轉 Markdown ---------- */
      const mdBlocks = await n2m.pageToMarkdown(brief.id);
      let   mdBody   = n2m.toMarkdownString(mdBlocks).parent
        .replace(
          /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})\S*/g,
          (_m, id) => `{{< youtube ${id} >}}`
        );

      /* ---------- Front‑matter ---------- */
      const front = [
        "---",
        `title: "${title.replace(/"/g, '\\"')}"`,
        `date: ${date}`,
        `slug: "${slug}"`,
        `tags: [${tags.map(t => `"${t}"`).join(", ")}]`,
        coverField && `cover: "${coverField}"`,
        iconField  && `icon: "${iconField}"`,
        "---",
        ""
      ].filter(Boolean).join("\n");

      const filePath = path.join(OUT_DIR, `${slug}.md`);
      await fs.writeFile(filePath, front + mdBody);
      console.log("📄  Wrote", filePath);
    }

    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  console.log(`✅ 完成，共 ${total} 篇`);
}

sync().catch(err => { console.error("❌", err); process.exit(1); });

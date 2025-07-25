#!/usr/bin/env node
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import fs   from "node:fs/promises";
import path from "node:path";
import fetch from "node-fetch";
import pLimit from "p-limit";

/* ---------- 基本设定 ---------- */
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m    = new NotionToMarkdown({ notionClient: notion });

const DB_ID   = process.env.NOTION_DATABASE_ID;
const OUT_DIR = "content/posts";                       // 固定
const filter  = { property: "status", status: { equals: "Published" } };
const dl      = pLimit(5);                             // 同时最多 5 个下载

/* ---------- 工具函数 ---------- */
const safeSlug = s => (s ?? "").replace(/[^a-zA-Z0-9-_]/g, "-");

async function download(url, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ← ${url}`);
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
}

/* ---------- 主流程 ---------- */
async function sync() {
  /* 0. 若没有 Published 文章就直接退出 */
  const probe = await notion.databases.query({ database_id: DB_ID, filter, page_size: 1 });
  if (!probe.results.length) {
    console.error("⚠️  没有 Published 文章，停止同步");
    process.exit(0);
  }

  /* 1. 清空旧输出（只清 index.md 与其附件目录） */
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  /* 2. 分页抓取 Notion 数据库 */
  let cursor, total = 0;
  do {
    const resp = await notion.databases.query({ database_id: DB_ID, filter, start_cursor: cursor });
    total += resp.results.length;

    for (const page of resp.results) {
      const full = await notion.pages.retrieve({ page_id: page.id });
      const p    = page.properties;

      /* 2‑1 基本字段 */
      const title = p.Title?.title[0]?.plain_text ?? "";
      const slug  = safeSlug(p.slug?.rich_text[0]?.plain_text);
      const date  = p.date?.date?.start;
      const tags  = p.tags?.multi_select.map(t => t.name) ?? [];

      if (!title || !slug || !date) {
        console.warn("⏭️  缺必要欄位，跳过", title || page.id);
        continue;
      }

      /* 2‑2 文章目录（bundle） */
      const bundle = path.join(OUT_DIR, slug);
      await fs.mkdir(bundle, { recursive: true });

      /* 2‑3 处理封面 */
      let coverField = "";
      const coverUrl = full.cover?.external?.url || full.cover?.file?.url || "";
      if (coverUrl) {
        const ext  = path.extname(new URL(coverUrl).pathname) || ".jpg";
        const file = `cover${ext}`;
        try {
          await dl(() => download(coverUrl, path.join(bundle, file)));
          coverField = file;
          console.log("🖼️  封面", file);
        } catch (e) { console.warn("⚠️  封面下载失败", e.message); }
      }

      /* 2‑4 处理 icon */
      let iconField = "";
      if (full.icon?.type === "emoji") {
        iconField = full.icon.emoji;
      } else {
        const iconUrl = full.icon?.external?.url || full.icon?.file?.url || "";
        if (iconUrl) {
          const ext  = path.extname(new URL(iconUrl).pathname) || ".png";
          const file = `icon${ext}`;
          try {
            await dl(() => download(iconUrl, path.join(bundle, file)));
            iconField = file;
            console.log("✨  图标", file);
          } catch (e) { console.warn("⚠️  图标下载失败", e.message); }
        }
      }

      /* 2‑5 Notion → Markdown */
      const mdBlocks = await n2m.pageToMarkdown(page.id);
      const mdBody   = n2m.toMarkdownString(mdBlocks).parent.replace(
        /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})\S*/g,
        (_m, id) => `{{< youtube ${id} >}}`
      );

      /* 2‑6 Front‑matter */
      const esc = s => s?.replace(/"/g, '\\"');
      const front = [
        "---",
        `title: "${esc(title)}"`,
        `date: "${date}"`,
        `slug: "${slug}"`,
        `tags: [${tags.map(t => `"${esc(t)}"`).join(", ")}]`,
        coverField && `cover: "${coverField}"`,
        iconField  && `icon: "${iconField}"`,
        coverField && `images: ["${coverField}"]`,
        "---",
        ""
      ].filter(Boolean).join("\n");

      /* 2‑7 写文件（bundle 里必须叫 index.md） */
      await fs.writeFile(path.join(bundle, "index.md"), front + mdBody);
      console.log("📄  写入", `${slug}/index.md`);
    }

    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  console.log(`✅ 完成，共 ${total} 篇`);
}

sync().catch(e => { console.error("❌", e); process.exit(1); });

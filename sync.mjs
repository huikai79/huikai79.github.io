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
const filter = { property: "status", status: { equals: "Published" } };
const dl = pLimit(5);

/* ---------- 工具函式 ---------- */
const safeSlug = s => (s ?? "").replace(/[^a-zA-Z0-9-_]/g, "-");

async function download(url, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ← ${url}`);
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
}

function fileExtensionFromUrl(url, fallback = ".jpg") {
  try {
    return path.extname(new URL(url).pathname) || fallback;
  } catch {
    return fallback;
  }
}

async function localizeMarkdownImages(markdown, bundle) {
  const imagePattern = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g;
  const matches = [...markdown.matchAll(imagePattern)];
  if (!matches.length) return markdown;

  const replacements = await Promise.all(matches.map(async (match, index) => {
    const [original, alt, url] = match;
    const ext = fileExtensionFromUrl(url, ".png");
    const file = `image-${String(index + 1).padStart(2, "0")}${ext}`;

    try {
      await dl(() => download(url, path.join(bundle, file)));
      console.log("🖼️  內文圖片", file);
      return { original, replacement: `![${alt}](${file})` };
    } catch (e) {
      console.warn("⚠️  內文圖片下載失敗，保留原網址", e.message);
      return { original, replacement: original };
    }
  }));

  let result = markdown;
  for (const { original, replacement } of replacements) {
    result = result.replace(original, replacement);
  }
  return result;
}

/* ---------- 主流程 ---------- */
async function sync() {
  if (!DB_ID) throw new Error("NOTION_DATABASE_ID 未設定");

  /* 0. 若沒有 Published 文章就直接退出 */
  const probe = await notion.databases.query({ database_id: DB_ID, filter, page_size: 1 });
  if (!probe.results.length) {
    console.error("⚠️  沒有 Published 文章，停止同步");
    process.exit(0);
  }

  /* 1. 重新產生文章輸出 */
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  /* 2. 分頁抓取 Notion 資料庫 */
  let cursor, total = 0;
  do {
    const resp = await notion.databases.query({ database_id: DB_ID, filter, start_cursor: cursor });
    total += resp.results.length;

    for (const page of resp.results) {
      const full = await notion.pages.retrieve({ page_id: page.id });
      const p = page.properties;

      /* 2-1 基本欄位 */
      const title = p.Title?.title[0]?.plain_text ?? "";
      const slug = safeSlug(p.slug?.rich_text[0]?.plain_text);
      const date = p.date?.date?.start;
      const tags = p.tags?.multi_select.map(t => t.name) ?? [];

      if (!title || !slug || !date) {
        console.warn("⏭️  缺必要欄位，跳過", title || page.id);
        continue;
      }

      /* 2-2 文章目錄（page bundle） */
      const bundle = path.join(OUT_DIR, slug);
      await fs.mkdir(bundle, { recursive: true });

      /* 2-3 封面下載到 bundle，避免 Notion 臨時網址失效 */
      let coverField = "";
      const coverUrl = full.cover?.external?.url || full.cover?.file?.url || "";
      if (coverUrl) {
        const ext = fileExtensionFromUrl(coverUrl, ".jpg");
        const file = `cover${ext}`;
        try {
          await dl(() => download(coverUrl, path.join(bundle, file)));
          coverField = file;
          console.log("🖼️  封面", file);
        } catch (e) {
          console.warn("⚠️  封面下載失敗", e.message);
        }
      }

      /* 2-4 icon */
      let iconField = "";
      if (full.icon?.type === "emoji") {
        iconField = full.icon.emoji;
      } else {
        const iconUrl = full.icon?.external?.url || full.icon?.file?.url || "";
        if (iconUrl) {
          const ext = fileExtensionFromUrl(iconUrl, ".png");
          const file = `icon${ext}`;
          try {
            await dl(() => download(iconUrl, path.join(bundle, file)));
            iconField = file;
            console.log("✨  圖示", file);
          } catch (e) {
            console.warn("⚠️  圖示下載失敗", e.message);
          }
        }
      }

      /* 2-5 Notion → Markdown，並把內文圖片本地化 */
      const mdBlocks = await n2m.pageToMarkdown(page.id);
      let mdBody = n2m.toMarkdownString(mdBlocks).parent.replace(
        /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})\S*/g,
        (_m, id) => `{{< youtube ${id} >}}`
      );
      mdBody = await localizeMarkdownImages(mdBody, bundle);

      /* 2-6 Front matter */
      const esc = s => s?.replace(/"/g, '\\"');
      const front = [
        "---",
        `title: "${esc(title)}"`,
        `date: "${date}"`,
        `slug: "${slug}"`,
        `tags: [${tags.map(t => `"${esc(t)}"`).join(", ")}]`,
        coverField && `cover: "${coverField}"`,
        iconField && `icon: "${iconField}"`,
        coverField && `images: ["${coverField}"]`,
        "---",
        ""
      ].filter(Boolean).join("\n");

      /* 2-7 寫檔 */
      await fs.writeFile(path.join(bundle, "index.md"), front + mdBody);
      console.log("📄  寫入", `${slug}/index.md`);
    }

    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  console.log(`✅ 完成，共 ${total} 篇`);
}

sync().catch(e => {
  console.error("❌", e);
  process.exit(1);
});

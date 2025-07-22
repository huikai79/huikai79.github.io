// sync.mjs －－ Notion ➜ Markdown for Hugo Blowfish
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import fs   from "node:fs/promises";
import path from "node:path";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m    = new NotionToMarkdown({ notionClient: notion });

const DB_ID   = process.env.NOTION_DATABASE_ID;
const OUT_DIR = "content/posts";

// 只同步 Status = Published 的頁面
const filter = { property: "status", status: { equals: "Published" } };

async function sync() {
  /* ---------- 零结果保护：避免误删整站 ---------- */
  const probe = await notion.databases.query({ database_id: DB_ID, filter, page_size: 1 });
  if (probe.results.length === 0) {
    console.error("⚠️  未找到任何 Published 文章，终止同步以免清空站点");
    process.exit(1);
  }

  /* ---------- 重新生成 posts 目录 ---------- */
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

    for (const page of resp.results) {
      const title = page.properties.Title?.title[0]?.plain_text ?? "Untitled";
      const slug  = page.properties.slug?.rich_text[0]?.plain_text;
      const date  = page.properties.date?.date?.start;
      const tags  = page.properties.tags?.multi_select.map(t => t.name) ?? [];

      if (!slug) continue; // 没 slug 就跳过

      /* ---------- 封面 / 图示 ---------- */
      const cover =
        page.cover?.external?.url ||
        page.cover?.file?.url    || "";

      const icon =
        page.icon?.emoji ||
        page.icon?.external?.url ||
        page.icon?.file?.url     || "";

      /* ---------- Markdown 转换 ---------- */
      const mdBlocks = await n2m.pageToMarkdown(page.id);
      let mdString   = n2m.toMarkdownString(mdBlocks).parent;

      /* 替换 YouTube 链接为 Hugo shortcode */
      mdString = mdString.replace(
        /https?:\/\/(?:www\.)?(?:youtu\.be\/|youtube\.com\/watch\?v=)([A-Za-z0-9_-]{11})\S*/g,
        (_match, id) => `{{< youtube ${id} >}}`
      );

      /* ---------- 生成 Front‑matter ---------- */
      const front = `---
      title: "${title.replace(/"/g, '\\"')}"
      date: ${date}
      slug: "${slug}"
      tags: [${tags.map(t => `"${t}"`).join(", ")}]
      cover: "${cover}"
      icon: "${icon}"
      ---
      `;

      const filePath = path.join(OUT_DIR, `${slug}.md`);
      await fs.writeFile(filePath, front + mdString);
      console.log("📝 写入", filePath);
    }

    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  console.log(`✅ 同步完成，共 ${total} 篇文章`);
}

sync().catch(err => {
  console.error("❌ FATAL:", err);
  process.exit(1);
});

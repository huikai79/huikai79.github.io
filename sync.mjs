import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import fs from "node:fs/promises";
import path from "node:path";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m   = new NotionToMarkdown({ notionClient: notion });

const db   = process.env.NOTION_DATABASE_ID;
const out  = "content/posts";                 // 一律用 out

// Status → "Published"
const filter = { property: "status", status: { equals: "Published" } };

async function sync() {
  /* --------------- 预检查：若 0 条则退出，避免删光文章 --------------- */
  const test = await notion.databases.query({ database_id: db, filter, page_size: 1 });
  if (test.results.length === 0) {
    console.error("⚠️ 未找到任何符合条件的记录，终止同步以免站点被清空");
    process.exit(1);
  }

  /* --------------- 重新生成 posts 目录 --------------- */
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });

  let cursor, total = 0;
  do {
    const resp = await notion.databases.query({ database_id: db, filter, start_cursor: cursor, page_size: 100 });
    total += resp.results.length;

    for (const page of resp.results) {
      const title = page.properties.Title?.title[0]?.plain_text ?? "Untitled";
      const slug  = page.properties.slug?.rich_text[0]?.plain_text;
      const date  = page.properties.date?.date?.start;
      const tags  = page.properties.tags?.multi_select.map(t => t.name) ?? [];

      if (!slug) continue;                          // 没 slug 就跳过

      /* ---------- Markdown 转换 ---------- */
      const mdBlocks = await n2m.pageToMarkdown(page.id);
      let   mdString = n2m.toMarkdownString(mdBlocks).parent;   // 直接取正文

      /* 替换 YouTube 链接 → Hugo shortcode */
      mdString = mdString.replace(
        /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})\S*/g,
        (_m, id) => `{{< youtube ${id} >}}`
      );  // :contentReference[oaicite:1]{index=1}

      /* ---------- 写 front‑matter + 内容 ---------- */
      const front = `---\n`
                  + `title: "${title.replace(/"/g, '\\"')}"\n`
                  + `date: ${date}\n`
                  + `slug: "${slug}"\n`
                  + `tags: [${tags.map(t => `"${t}"`).join(", ")}]\n`
                  + `---\n\n`;

      const filePath = path.join(out, `${slug}.md`);
      await fs.writeFile(filePath, front + mdString);
      console.log("📝 写入", filePath);
    }

    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  console.log(`✅ 同步完成，共 ${total} 篇文章`);
}

sync().catch(err => { console.error(err); process.exit(1); });

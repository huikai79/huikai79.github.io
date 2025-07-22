import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import fs from "fs/promises";
import path from "path";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m   = new NotionToMarkdown({ notionClient: notion });
const db    = process.env.NOTION_DATABASE_ID;
const out   = "content/posts";          // ← 统一用 out

const filter = { property: "status", status: { equals: "Published" } };

async function sync() {
  const first = await notion.databases.query({ database_id: db, filter, page_size: 1 });
  if (first.results.length === 0) {
    console.error("❌ No pages matched filter — abort");
    process.exit(1);
  }
  if (resp.results.length === 0) {
    console.error("⚠️ Status filter撞空，终止以免站点被清空");
    process.exit(1);
  }
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });

  let cursor = undefined, total = 0;
  do {
    const resp = await notion.databases.query({
      database_id: db, filter, start_cursor: cursor, page_size: 100,
    });
    total += resp.results.length;

    for (const page of resp.results) {            // ← 写文件循环
      const title = page.properties.Title.title[0]?.plain_text ?? "Untitled";
      const slug  = page.properties.slug.rich_text[0]?.plain_text;
      const date  = page.properties.date.date?.start;
      const tags  = page.properties.tags.multi_select.map(t => t.name);

      if (!slug) continue;

      const mdBlocks = await n2m.pageToMarkdown(page.id);
      const mdString = n2m.toMarkdownString(mdBlocks);

      // 自动把 YouTube 链接换短码（可选）
      mdString = mdString.replace(
        /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11}).*/g,
        (_m, id) => `{{< youtube ${id} >}}`
      );

      const front = `---\n`
                  + `title: "${title.replace(/"/g,'\\"')}"\n`
                  + `date: ${date}\n`
                  + `slug: "${slug}"\n`
                  + `tags: [${tags.map(t=>`"${t}"`).join(", ")}]\n`
                  + `---\n\n`;

      const filePath = path.join(out, `${slug}.md`);
      await fs.writeFile(filePath, front + mdString.parent);
      console.log("📝", filePath);
    }

    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  console.log(`✅ Synced ${total} pages`);
}

sync().catch(err => { console.error(err); process.exit(1); });

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
import fs from "node:fs/promises";
import path from "node:path";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

const DB_ID   = process.env.NOTION_DATABASE_ID;
const OUT_DIR = "content/posts";
const filter  = { property: "status", status: { equals: "Published" } };

async function sync() {
  const probe = await notion.databases.query({ database_id: DB_ID, filter, page_size: 1 });
  if (!probe.results.length) { console.error("⚠️ 没有 Published 文章"); process.exit(1); }

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  let cursor; let total = 0;
  do {
    const resp = await notion.databases.query({ database_id: DB_ID, filter, start_cursor: cursor, page_size: 100 });
    total += resp.results.length;

    for (const brief of resp.results) {
      const full  = await notion.pages.retrieve({ page_id: brief.id });

      const p     = brief.properties;
      const title = p.Title?.title[0]?.plain_text ?? "";
      const slug  = p.slug?.rich_text[0]?.plain_text ?? "";
      const date  = p.date?.date?.start ?? "";
      const tags  = p.tags?.multi_select.map(t => t.name) ?? [];
      if (!title || !slug || !date) continue;

      const cover = full.cover?.external?.url || full.cover?.file?.url || "";
      const icon  = full.icon?.emoji || full.icon?.external?.url || full.icon?.file?.url || "";

      const md   = n2m.toMarkdownString(await n2m.pageToMarkdown(brief.id)).parent
                     .replace(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})\S*/g,
                              (_m,id)=>`{{< youtube ${id} >}}`);

      const front = `---\n`
                  + `title: "${title.replace(/"/g,'\\"')}"\n`
                  + `date: ${date}\n`
                  + `slug: "${slug}"\n`
                  + `tags: [${tags.map(t=>`"${t}"`).join(", ")}]\n`
                  + (cover ? `cover: "${cover}"\n` : "")
                  + (icon  ? `icon: "${icon}"\n`   : "")
                  + `---\n\n`;

      const file = path.join(OUT_DIR, `${slug}.md`);
      await fs.writeFile(file, front + md);
      console.log("📝 写入", file);
    }
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
  console.log(`✅ 完成，共 ${total} 篇`);
}
sync().catch(e=>{console.error(e);process.exit(1);});


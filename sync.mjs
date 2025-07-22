#!/usr/bin/env node

import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import fs from "node:fs/promises";
import path from "node:path";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m   = new NotionToMarkdown({ notionClient: notion });
const db    = process.env.NOTION_DATABASE_ID;
const out   = "content/posts";
const filter = { property: "status", select: { equals: "Published" } };

async function sync() {
  // 检查至少有一篇文章，否则终止，避免清空内容
  const test = await notion.databases.query({ database_id: db, filter, page_size: 1 });
  if (!test.results.length) {
    console.error("⚠️ 未发现任何 Published 文章，停止同步");
    process.exit(1);
  }

  // 清空并创建输出目录
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });

  let cursor, total = 0;
  do {
    const resp = await notion.databases.query({
      database_id: db,
      filter,
      start_cursor: cursor,
      page_size: 100
    });
    total += resp.results.length;

    for (const page of resp.results) {
      const title = page.properties.Title?.title[0]?.plain_text ?? "";
      const slug  = page.properties.slug?.rich_text[0]?.plain_text ?? "";
      const date  = page.properties.date?.date?.start ?? "";
      const tags  = page.properties.tags?.multi_select.map(t => t.name) ?? [];

      if (!title || !slug || !date) {
        console.warn(`⚠️ 页面资料不完整 (title/slug/date)，跳过:`, page.id);
        continue;
      }

      // cover / icon 支援
      const cover = page.cover?.external?.url
                  || page.cover?.file?.url
                  || "";
      const icon  = page.icon?.emoji
                  || page.icon?.external?.url
                  || page.icon?.file?.url
                  || "";

      const mdBlocks = await n2m.pageToMarkdown(page.id);
      let mdString = n2m.toMarkdownString(mdBlocks).parent;

      // 转换 YouTube 链结为 Hugo Shortcode
      mdString = mdString.replace(
        /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})\S*/g,
        (_m, id) => `{{< youtube ${id} >}}`
      );

      const front = `---\n`
                  + `title: "${title.replace(/"/g, '\\"')}"\n`
                  + `date: ${date}\n`
                  + `slug: "${slug}"\n`
                  + `tags: [${tags.map(t => `"${t}"`).join(", ")}]\n`
                  + (cover ? `cover: "${cover}"\n` : "")
                  + (icon  ? `icon:  "${icon}"\n` : "")
                  + `---\n\n`;

      const filePath = path.join(out, `${slug}.md`);
      await fs.write

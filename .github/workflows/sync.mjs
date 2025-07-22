import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import fs from "fs/promises";
import path from "path";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });
const db = process.env.NOTION_DATABASE_ID;
const out = "content/posts";

async function sync() {
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });

  const filter = { property: "status", select: { equals: "Published" } };
  let cursor = undefined, total = 0;

  do {
    const resp = await notion.databases.query({
      database_id: db,
      filter,
      start_cursor: cursor,
      page_size: 100,
    });
    total += resp.results.length;

    for (const page of resp.results) {
      /* ...生成 Markdown 同你原代码逻辑... */
    }

    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  console.log(`✔️  Synced ${total} pages`);
}

sync().catch(err => { console.error(err); process.exit(1); });

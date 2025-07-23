#!/usr/bin/env node
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

const DB_ID   = process.env.NOTION_DATABASE_ID;
const OUT_DIR = "content/posts";
const STATIC_IMG_DIR = "static/images"; // 新增：静态图片保存目录
const filter  = { property: "status", status: { equals: "Published" } };

// 新增：下载图片函数
async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to get '${url}' (${res.statusCode})`));
      }
      const fileStream = fs.createWriteStream(filepath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
      fileStream.on('error', (err) => reject(err));
    }).on('error', (err) => reject(err));
  });
}

async function sync() {
  const probe = await notion.databases.query({ database_id: DB_ID, filter, page_size: 1 });
  if (!probe.results.length) { console.error("⚠️ 没有 Published 文章"); process.exit(1); }

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(STATIC_IMG_DIR, { recursive: true }); // 确保静态图片目录存在

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

      let coverPath = "";
      const coverUrl = full.cover?.external?.url || full.cover?.file?.url || "";
      if (coverUrl) {
        const coverFileName = `${slug}-cover${path.extname(coverUrl) || '.jpg'}`;
        coverPath = path.join("/images", coverFileName); // Hugo 访问路径
        const fullCoverPath = path.join(STATIC_IMG_DIR, coverFileName);
        try {
          await downloadImage(coverUrl, fullCoverPath);
          console.log("🖼️ 下载封面", fullCoverPath);
        } catch (e) {
          console.error(`❌ 封面下载失败: ${coverUrl} - ${e.message}`);
          coverPath = ""; // 下载失败则不设置封面
        }
      }

      let iconValue = "";
      const iconType = full.icon?.type;
      if (iconType === 'emoji') {
        iconValue = full.icon.emoji;
      } else if (iconType === 'external' || iconType === 'file') {
        const iconUrl = full.icon?.external?.url || full.icon?.file?.url || "";
        if (iconUrl) {
          const iconFileName = `${slug}-icon${path.extname(iconUrl) || '.png'}`;
          iconValue = path.join("/images", iconFileName); // Hugo 访问路径
          const fullIconPath = path.join(STATIC_IMG_DIR, iconFileName);
          try {
            await downloadImage(iconUrl, fullIconPath);
            console.log("✨ 下载图标", fullIconPath);
          } catch (e) {
            console.error(`❌ 图标下载失败: ${iconUrl} - ${e.message}`);
            iconValue = ""; // 下载失败则不设置图标
          }
        }
      }

      const md   = n2m.toMarkdownString(await n2m.pageToMarkdown(brief.id)).parent
                     .replace(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})\S*/g,
                              (_m,id)=>`{{< youtube ${id} >}}`);

      const front = `---\n`
                  + `title: "${title.replace(/"/g,\'\\"\')}"\n`
                  + `date: ${date}\n`
                  + `slug: "${slug}"\n`
                  + `tags: [${tags.map(t=>`"${t}"`).join(", ")}]\n`
                  + (coverPath ? `cover: "${coverPath}"\n` : "")
                  + (iconValue ? `icon: "${iconValue}"\n`   : "")
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



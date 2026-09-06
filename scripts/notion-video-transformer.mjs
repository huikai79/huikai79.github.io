import path from "node:path";

const BLOCK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function notionVideoMarkdown(block) {
  const video = block?.video;
  if (!video || video.type !== "file") return false;

  const blockId = block.id ?? "";
  if (!BLOCK_ID_RE.test(blockId)) {
    throw new Error(`Notion uploaded video has an invalid block id: ${blockId || "missing"}`);
  }

  const sourceUrl = video.file?.url ?? "";
  if (!sourceUrl) {
    throw new Error(`Notion uploaded video ${blockId} is missing its temporary file URL`);
  }

  let extension = "";
  try {
    extension = path.extname(new URL(sourceUrl).pathname).toLowerCase();
  } catch {
    throw new Error(`Notion uploaded video ${blockId} returned an invalid file URL`);
  }

  if (extension !== ".mp4") {
    throw new Error(
      `Unsupported Notion uploaded video format for ${blockId}: ${extension || "unknown"}. ` +
      "Only MP4 is admitted to the browser-streaming gateway; refusing to download it into Git."
    );
  }

  return `{{< notion-video block="${blockId}" >}}`;
}

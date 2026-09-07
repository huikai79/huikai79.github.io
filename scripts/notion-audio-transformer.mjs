import path from "node:path";

const BLOCK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPPORTED_AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"]);

export function notionAudioMarkdown(block) {
  const audio = block?.audio;
  if (!audio || audio.type !== "file") return false;

  const blockId = block.id ?? "";
  if (!BLOCK_ID_RE.test(blockId)) {
    throw new Error(`Notion uploaded audio has an invalid block id: ${blockId || "missing"}`);
  }

  const sourceUrl = audio.file?.url ?? "";
  if (!sourceUrl) {
    throw new Error(`Notion uploaded audio ${blockId} is missing its temporary file URL`);
  }

  let extension = "";
  try {
    extension = path.extname(new URL(sourceUrl).pathname).toLowerCase();
  } catch {
    throw new Error(`Notion uploaded audio ${blockId} returned an invalid file URL`);
  }

  if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported Notion uploaded audio format for ${blockId}: ${extension || "unknown"}. ` +
      "Only browser-streamable audio formats are admitted to the media gateway; refusing to download it into Git."
    );
  }

  return `{{< notion-audio block="${blockId}" >}}`;
}

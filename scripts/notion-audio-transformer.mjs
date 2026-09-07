const BLOCK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error(`Notion uploaded audio ${blockId} returned an invalid file URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Notion uploaded audio ${blockId} returned a non-HTTPS file URL`);
  }

  // The signed Notion file URL is temporary transport metadata, not an
  // authoritative media-type contract. Keep only the stable block identity in
  // Git; the runtime gateway re-fetches the block and validates the upstream
  // audio MIME type before proxying it to the browser.
  return `{{< notion-audio block="${blockId}" >}}`;
}

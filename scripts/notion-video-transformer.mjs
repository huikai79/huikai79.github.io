import path from "node:path";

const BLOCK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com"
]);

function youtubeVideoId(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || "").trim());
  } catch {
    return "";
  }

  if (!new Set(["http:", "https:"]).has(url.protocol)) return "";
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let id = "";

  if (host === "youtu.be") {
    id = url.pathname.split("/").filter(Boolean)[0] || "";
  } else if (YOUTUBE_HOSTS.has(host)) {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "watch" || url.pathname === "/watch") {
      id = url.searchParams.get("v") || "";
    } else if (["embed", "shorts", "live"].includes(segments[0])) {
      id = segments[1] || "";
    }
  }

  return YOUTUBE_VIDEO_ID_RE.test(id) ? id : "";
}

export function notionVideoMarkdown(block) {
  const video = block?.video;
  if (!video) return false;

  if (video.type === "external") {
    const id = youtubeVideoId(video.external?.url);
    return id ? `{{< youtube ${id} >}}` : false;
  }

  if (video.type !== "file") return false;

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

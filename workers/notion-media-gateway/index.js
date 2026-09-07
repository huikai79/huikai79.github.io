const SITE_ORIGIN = "https://huikai.com.kg";
const SESSION_COOKIE = "__Host-hk_media";
const SESSION_TTL_SECONDS = 600;
const NOTION_API_VERSION = "2022-06-28";
const VIDEO_URL_CACHE_MS = 45 * 60 * 1000;
const videoUrlCache = new Map();

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function sign(expiry, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(expiry)));
  return base64Url(new Uint8Array(signature));
}

async function makeSession(secret) {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return `${expiry}.${await sign(expiry, secret)}`;
}

async function validSession(token, secret) {
  if (!token) return false;
  const match = token.match(/^(\d{10})\.([A-Za-z0-9_-]{40,})$/);
  if (!match) return false;
  const expiry = Number(match[1]);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;
  return constantTimeEqual(match[2], await sign(expiry, secret));
}

function cookieValue(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function sameSiteRequest(request, requireOrigin = false) {
  const origin = request.headers.get("Origin");
  const referer = request.headers.get("Referer");
  const fetchSite = request.headers.get("Sec-Fetch-Site");

  if (requireOrigin && origin !== SITE_ORIGIN) return false;
  if (origin && origin !== SITE_ORIGIN) return false;
  if (referer && !referer.startsWith(`${SITE_ORIGIN}/`)) return false;
  if (fetchSite && !["same-origin", "same-site"].includes(fetchSite)) return false;

  if (!requireOrigin && !referer && !fetchSite) return false;
  return true;
}

function validBlockId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function validArticlePath(value) {
  return /^\/(?:(?:zh-cn|en)\/)?posts\/[A-Za-z0-9_-]+\/$/.test(value || "");
}

function htmlContainsVideoBlock(html, blockId) {
  const marker = new RegExp(
    `data-notion-video-block\\s*=\\s*(?:"${blockId}"|'${blockId}'|${blockId}(?=[\\s>]))`,
    "i"
  );
  return marker.test(html);
}

async function publishedPageContainsVideo(pagePath, blockId) {
  const response = await fetch(`${SITE_ORIGIN}${pagePath}`, {
    headers: { "User-Agent": "huikai-media-gateway/1" },
    cf: { cacheEverything: true, cacheTtl: 300 }
  });
  if (!response.ok) return false;
  const html = await response.text();
  return htmlContainsVideoBlock(html, blockId);
}

async function notionVideoUrl(blockId, env, force = false) {
  const cached = videoUrlCache.get(blockId);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.url;

  const response = await fetch(`https://api.notion.com/v1/blocks/${encodeURIComponent(blockId)}`, {
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_API_VERSION
    }
  });
  if (!response.ok) throw new Error(`Notion block lookup failed: ${response.status}`);

  const block = await response.json();
  if (block.type !== "video" || block.video?.type !== "file" || !block.video.file?.url) {
    throw new Error("Notion block is not an uploaded video file");
  }

  const entry = { url: block.video.file.url, expiresAt: Date.now() + VIDEO_URL_CACHE_MS };
  videoUrlCache.set(blockId, entry);
  return entry.url;
}

async function proxyVideo(request, blockId, pagePath, env) {
  const upstreamHeaders = new Headers();
  const range = request.headers.get("Range");
  if (range) upstreamHeaders.set("Range", range);

  let upstreamUrl = await notionVideoUrl(blockId, env);
  let upstream = await fetch(upstreamUrl, { method: request.method, headers: upstreamHeaders, redirect: "follow" });

  if ([401, 403].includes(upstream.status)) {
    videoUrlCache.delete(blockId);
    upstreamUrl = await notionVideoUrl(blockId, env, true);
    upstream = await fetch(upstreamUrl, { method: request.method, headers: upstreamHeaders, redirect: "follow" });
  }

  if (!upstream.ok && upstream.status !== 206) return new Response("Video unavailable", { status: 502 });

  const headers = new Headers();
  for (const name of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Content-Disposition", "inline");
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers
  });
}

export default {
  async fetch(request, env) {
    if (!env.NOTION_TOKEN || !env.MEDIA_SESSION_SECRET) {
      return new Response("Media gateway is not configured", { status: 503 });
    }

    const url = new URL(request.url);
    if (url.origin !== SITE_ORIGIN || !url.pathname.startsWith("/media/")) {
      return new Response("Not found", { status: 404 });
    }

    if (url.pathname === "/media/session") {
      if (request.method !== "POST" || !sameSiteRequest(request, true)) {
        return new Response("Forbidden", { status: 403 });
      }
      const session = await makeSession(env.MEDIA_SESSION_SECRET);
      return new Response(null, {
        status: 204,
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": `${SESSION_COOKIE}=${session}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`
        }
      });
    }

    const match = url.pathname.match(/^\/media\/video\/([0-9a-f-]+)$/i);
    if (!match || !["GET", "HEAD"].includes(request.method)) return new Response("Not found", { status: 404 });
    if (!sameSiteRequest(request, false)) return new Response("Forbidden", { status: 403 });

    const blockId = match[1];
    const pagePath = url.searchParams.get("page") || "";
    if (!validBlockId(blockId) || !validArticlePath(pagePath)) return new Response("Bad request", { status: 400 });

    const session = cookieValue(request, SESSION_COOKIE);
    if (!(await validSession(session, env.MEDIA_SESSION_SECRET))) return new Response("Session expired", { status: 401 });

    if (!(await publishedPageContainsVideo(pagePath, blockId))) return new Response("Forbidden", { status: 403 });

    try {
      return await proxyVideo(request, blockId, pagePath, env);
    } catch (error) {
      console.error("media gateway error", error instanceof Error ? error.message : "unknown error");
      return new Response("Video unavailable", { status: 502 });
    }
  }
};

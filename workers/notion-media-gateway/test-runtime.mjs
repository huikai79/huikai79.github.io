#!/usr/bin/env node
import assert from "node:assert/strict";
import worker from "./index.js";

const env = {
  NOTION_TOKEN: "test-notion-token",
  MEDIA_SESSION_SECRET: "test-media-session-secret-with-enough-entropy"
};
const blockId = "23b7a59e-0439-8006-a923-e6b66af95201";
const unknownAudioBlockId = "23b7a59e-0439-8006-a923-e6b66af95202";
const videoBlockId = "3d27a59e-0439-80d9-a6c5-f293186a10e0";
const unknownVideoBlockId = "3d27a59e-0439-80d9-a6c5-f293186a10e1";
const pagePath = "/posts/how-to-make-wealth/";
const videoPagePath = "/posts/first-hackathon/";
const siteOrigin = "https://huikai.com.kg";
const wavUrl = "https://signed.example.test/%E5%89%B5%E9%80%A0%E8%B2%A1%E5%AF%8C%E4%B9%8B%E9%81%93.wav?token=short-lived";
const unknownAudioUrl = "https://signed.example.test/audio-object?token=unknown-extension";
const mp4Url = "https://signed.example.test/1000228164.mp4?token=short-lived";
const unknownVideoUrl = "https://signed.example.test/video-object?token=unknown-extension";

const sessionResponse = await worker.fetch(new Request(`${siteOrigin}/media/session`, {
  method: "POST",
  headers: {
    Origin: siteOrigin,
    "Sec-Fetch-Site": "same-origin",
    "X-Media-Session": "1"
  }
}), env);
assert.equal(sessionResponse.status, 204, "same-origin session bootstrap must succeed");
const setCookie = sessionResponse.headers.get("Set-Cookie") || "";
const cookie = setCookie.split(";", 1)[0];
assert.match(cookie, /^__Host-hk_media=/, "session bootstrap must issue the host-only media cookie");
assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict/, "media cookie must keep strict security attributes");

const originalFetch = globalThis.fetch;
try {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });

    if (url === `${siteOrigin}${pagePath}`) {
      return new Response(`<div data-notion-audio-block="${blockId}"></div>`, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
    if (url === `https://api.notion.com/v1/blocks/${blockId}`) {
      return new Response(JSON.stringify({
        type: "audio",
        audio: { type: "file", file: { url: wavUrl } }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === wavUrl) {
      assert.equal(init.headers.get("Range"), "bytes=0-9", "browser Range header must be forwarded upstream");
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: {
          "Content-Type": "audio",
          "Content-Length": "4",
          "Content-Range": "bytes 0-3/4",
          "Accept-Ranges": "bytes"
        }
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const mediaResponse = await worker.fetch(new Request(
    `${siteOrigin}/media/audio/${blockId}?page=${encodeURIComponent(pagePath)}`,
    {
      headers: {
        Referer: `${siteOrigin}${pagePath}`,
        "Sec-Fetch-Site": "same-origin",
        Cookie: cookie,
        Range: "bytes=0-9"
      }
    }
  ), env);
  assert.equal(mediaResponse.status, 206, "authorized published audio must preserve partial-content status");
  assert.equal(mediaResponse.headers.get("Content-Type"), "audio/wav", "bare audio MIME from a .wav signed URL must normalize to audio/wav");
  assert.equal(mediaResponse.headers.get("Content-Disposition"), "inline");
  assert.equal(mediaResponse.headers.get("Cache-Control"), "private, no-store");
  assert.equal(mediaResponse.headers.get("Content-Range"), "bytes 0-3/4");
  assert.ok(calls.some(call => call.url.startsWith("https://api.notion.com/v1/blocks/")), "gateway must resolve the current Notion file URL at runtime");

  globalThis.fetch = async input => {
    const url = typeof input === "string" ? input : input.url;
    if (url === `${siteOrigin}${pagePath}`) {
      return new Response(`<div data-notion-audio-block="${blockId}"></div>`, { status: 200 });
    }
    if (url === wavUrl) {
      return new Response("not audio", { status: 200, headers: { "Content-Type": "application/octet-stream" } });
    }
    throw new Error(`unexpected fetch in MIME test: ${url}`);
  };

  const badMime = await worker.fetch(new Request(
    `${siteOrigin}/media/audio/${blockId}?page=${encodeURIComponent(pagePath)}`,
    {
      headers: {
        Referer: `${siteOrigin}${pagePath}`,
        "Sec-Fetch-Site": "same-origin",
        Cookie: cookie
      }
    }
  ), env);
  assert.equal(badMime.status, 502, "non-audio upstream MIME must fail closed");

  globalThis.fetch = async input => {
    const url = typeof input === "string" ? input : input.url;
    if (url === `${siteOrigin}${pagePath}`) {
      return new Response(`<div data-notion-audio-block="${unknownAudioBlockId}"></div>`, { status: 200 });
    }
    if (url === `https://api.notion.com/v1/blocks/${unknownAudioBlockId}`) {
      return new Response(JSON.stringify({
        type: "audio",
        audio: { type: "file", file: { url: unknownAudioUrl } }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === unknownAudioUrl) {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: { "Content-Type": "audio" }
      });
    }
    throw new Error(`unexpected fetch in unknown audio extension test: ${url}`);
  };

  const unknownAudioMime = await worker.fetch(new Request(
    `${siteOrigin}/media/audio/${unknownAudioBlockId}?page=${encodeURIComponent(pagePath)}`,
    {
      headers: {
        Referer: `${siteOrigin}${pagePath}`,
        "Sec-Fetch-Site": "same-origin",
        Cookie: cookie
      }
    }
  ), env);
  assert.equal(unknownAudioMime.status, 502, "bare audio MIME without a recognized filename extension must fail closed");

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === `${siteOrigin}${videoPagePath}`) {
      return new Response(`<div data-notion-video-block="${videoBlockId}"></div>`, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
    if (url === `https://api.notion.com/v1/blocks/${videoBlockId}`) {
      return new Response(JSON.stringify({
        type: "video",
        video: { type: "file", file: { url: mp4Url } }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === mp4Url) {
      assert.equal(init.headers.get("Range"), "bytes=0-1023", "video Range header must be forwarded upstream");
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: {
          "Content-Type": "video",
          "Content-Length": "4",
          "Content-Range": "bytes 0-3/4",
          "Accept-Ranges": "bytes"
        }
      });
    }
    throw new Error(`unexpected fetch in video MIME test: ${url}`);
  };

  const videoResponse = await worker.fetch(new Request(
    `${siteOrigin}/media/video/${videoBlockId}?page=${encodeURIComponent(videoPagePath)}`,
    {
      headers: {
        Referer: `${siteOrigin}${videoPagePath}`,
        "Sec-Fetch-Site": "same-origin",
        Cookie: cookie,
        Range: "bytes=0-1023"
      }
    }
  ), env);
  assert.equal(videoResponse.status, 206, "authorized published video must preserve partial-content status");
  assert.equal(videoResponse.headers.get("Content-Type"), "video/mp4", "bare video MIME from the published .mp4 signed URL must normalize to video/mp4");
  assert.equal(videoResponse.headers.get("Content-Range"), "bytes 0-3/4");

  globalThis.fetch = async input => {
    const url = typeof input === "string" ? input : input.url;
    if (url === `${siteOrigin}${videoPagePath}`) {
      return new Response(`<div data-notion-video-block="${unknownVideoBlockId}"></div>`, { status: 200 });
    }
    if (url === `https://api.notion.com/v1/blocks/${unknownVideoBlockId}`) {
      return new Response(JSON.stringify({
        type: "video",
        video: { type: "file", file: { url: unknownVideoUrl } }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === unknownVideoUrl) {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: { "Content-Type": "video" }
      });
    }
    throw new Error(`unexpected fetch in unknown video extension test: ${url}`);
  };

  const unknownVideoMime = await worker.fetch(new Request(
    `${siteOrigin}/media/video/${unknownVideoBlockId}?page=${encodeURIComponent(videoPagePath)}`,
    {
      headers: {
        Referer: `${siteOrigin}${videoPagePath}`,
        "Sec-Fetch-Site": "same-origin",
        Cookie: cookie
      }
    }
  ), env);
  assert.equal(unknownVideoMime.status, 502, "bare video MIME without a recognized filename extension must fail closed");

  globalThis.fetch = async input => {
    const url = typeof input === "string" ? input : input.url;
    if (url === `${siteOrigin}${pagePath}`) return new Response("<article>no matching media marker</article>", { status: 200 });
    throw new Error(`unexpected fetch in binding test: ${url}`);
  };
  const unbound = await worker.fetch(new Request(
    `${siteOrigin}/media/audio/${blockId}?page=${encodeURIComponent(pagePath)}`,
    {
      headers: {
        Referer: `${siteOrigin}${pagePath}`,
        "Sec-Fetch-Site": "same-origin",
        Cookie: cookie
      }
    }
  ), env);
  assert.equal(unbound.status, 403, "block must be bound to the requested published page");

  const crossSite = await worker.fetch(new Request(
    `${siteOrigin}/media/audio/${blockId}?page=${encodeURIComponent(pagePath)}`,
    {
      headers: {
        Origin: "https://attacker.example",
        Referer: "https://attacker.example/",
        "Sec-Fetch-Site": "cross-site",
        Cookie: cookie
      }
    }
  ), env);
  assert.equal(crossSite.status, 403, "cross-site media requests must be rejected before proxying");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Notion media gateway runtime verification: PASS");

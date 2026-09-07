#!/usr/bin/env node
import assert from "node:assert/strict";
import worker from "./index.js";

const env = {
  NOTION_TOKEN: "test-notion-token",
  MEDIA_SESSION_SECRET: "test-media-session-secret-with-enough-entropy"
};
const blockId = "23b7a59e-0439-8006-a923-e6b66af95201";
const pagePath = "/posts/how-to-make-wealth/";
const siteOrigin = "https://huikai.com.kg";

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
        audio: { type: "file", file: { url: "https://signed.example.test/audio-object?token=short-lived" } }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://signed.example.test/audio-object?token=short-lived") {
      assert.equal(init.headers.get("Range"), "bytes=0-9", "browser Range header must be forwarded upstream");
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: {
          "Content-Type": "audio/wav",
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
  assert.equal(mediaResponse.headers.get("Content-Type"), "audio/wav");
  assert.equal(mediaResponse.headers.get("Content-Disposition"), "inline");
  assert.equal(mediaResponse.headers.get("Cache-Control"), "private, no-store");
  assert.equal(mediaResponse.headers.get("Content-Range"), "bytes 0-3/4");
  assert.ok(calls.some(call => call.url.startsWith("https://api.notion.com/v1/blocks/")), "gateway must resolve the current Notion file URL at runtime");

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === `${siteOrigin}${pagePath}`) {
      return new Response(`<div data-notion-audio-block="${blockId}"></div>`, { status: 200 });
    }
    if (url === "https://signed.example.test/audio-object?token=short-lived") {
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

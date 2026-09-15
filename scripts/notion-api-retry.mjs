import { Client } from "@notionhq/client";
import nodeFetch from "node-fetch";

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_MIN_INTERVAL_MS = 450;
const DEFAULT_MAX_FALLBACK_DELAY_MS = 30_000;
const DEFAULT_JITTER_MS = 250;
const TRANSPORT_STATS = Symbol("huikai.notionTransportStats");

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

function requestMethod(input, init = {}) {
  if (init?.method) return String(init.method).toUpperCase();
  if (input && typeof input === "object" && "method" in input && input.method) {
    return String(input.method).toUpperCase();
  }
  return "GET";
}

export function retryDelayMs(response, attempt, random = Math.random, options = {}) {
  const maxFallbackDelayMs = options.maxFallbackDelayMs ?? DEFAULT_MAX_FALLBACK_DELAY_MS;
  const jitterMs = options.jitterMs ?? DEFAULT_JITTER_MS;
  const rawRetryAfter = headerValue(response?.headers, "retry-after");
  const retryAfterSeconds = rawRetryAfter === null ? Number.NaN : Number(rawRetryAfter);
  const fallbackMs = Math.min((2 ** attempt) * 1000, maxFallbackDelayMs);
  const baseMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
    ? retryAfterSeconds * 1000
    : fallbackMs;
  return Math.max(0, baseMs) + Math.max(0, random()) * jitterMs;
}

export function shouldRetryNotionResponse(response, method = "GET") {
  const status = Number(response?.status);
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (status === 429 || status === 529) return true;
  return (normalizedMethod === "GET" || normalizedMethod === "DELETE") &&
    [500, 502, 503, 504].includes(status);
}

async function discardResponseBody(response) {
  try {
    if (typeof response?.arrayBuffer === "function") await response.arrayBuffer();
  } catch {
    // The response is being discarded before retry; body cleanup is best-effort only.
  }
}

export function createNotionFetchTransport({
  fetch = nodeFetch,
  maxRetries = DEFAULT_MAX_RETRIES,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  sleep = defaultSleep,
  random = Math.random,
  now = Date.now,
  warn = console.warn
} = {}) {
  if (typeof fetch !== "function") throw new TypeError("fetch must be a function");

  let chain = Promise.resolve();
  let nextAllowedAt = 0;
  const stats = {
    requestCount: 0,
    rateLimited429Count: 0,
    overloaded529Count: 0,
    retryCount: 0,
    maxRetryDelayMs: 0
  };

  async function waitForDispatchSlot() {
    const remaining = nextAllowedAt - now();
    if (remaining > 0) await sleep(remaining);
    nextAllowedAt = now() + Math.max(0, minIntervalMs);
  }

  async function run(input, init = {}) {
    const method = requestMethod(input, init);

    for (let attempt = 0; ; attempt += 1) {
      await waitForDispatchSlot();
      stats.requestCount += 1;
      const response = await fetch(input, init);
      const status = Number(response?.status);

      if (status === 429) stats.rateLimited429Count += 1;
      if (status === 529) stats.overloaded529Count += 1;

      if (!shouldRetryNotionResponse(response, method) || attempt >= maxRetries) {
        return response;
      }

      const delayMs = retryDelayMs(response, attempt, random);
      stats.retryCount += 1;
      stats.maxRetryDelayMs = Math.max(stats.maxRetryDelayMs, delayMs);
      await discardResponseBody(response);

      warn(
        `⚠️  Notion API HTTP ${status || "error"}，等待 ${Math.ceil(delayMs)}ms 後重試 ` +
        `(${attempt + 1}/${maxRetries})`
      );
      await sleep(delayMs);
    }
  }

  function queuedFetch(input, init) {
    const current = chain.then(() => run(input, init), () => run(input, init));
    chain = current.catch(() => {});
    return current;
  }

  return { fetch: queuedFetch, stats };
}

function registerTransportSummary(stats, label) {
  if (!label || typeof process?.once !== "function") return;
  process.once("exit", () => {
    console.log(
      `Notion API transport [${label}]: ` +
      `notion_request_count=${stats.requestCount} ` +
      `notion_429_count=${stats.rateLimited429Count} ` +
      `notion_529_count=${stats.overloaded529Count} ` +
      `notion_retry_count=${stats.retryCount} ` +
      `max_retry_delay_ms=${Math.ceil(stats.maxRetryDelayMs)}`
    );
  });
}

export function createNotionClient({
  auth,
  transportLabel = "",
  clientOptions = {},
  transportOptions = {}
} = {}) {
  const transport = createNotionFetchTransport(transportOptions);
  const client = new Client({
    ...clientOptions,
    auth,
    fetch: transport.fetch
  });
  Object.defineProperty(client, TRANSPORT_STATS, {
    value: transport.stats,
    enumerable: false,
    configurable: false,
    writable: false
  });
  registerTransportSummary(transport.stats, transportLabel);
  return client;
}

export function notionTransportStats(client) {
  const stats = client?.[TRANSPORT_STATS];
  return stats ? { ...stats } : null;
}

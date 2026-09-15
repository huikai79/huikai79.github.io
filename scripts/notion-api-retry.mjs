const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_MAX_FALLBACK_DELAY_MS = 30_000;
const DEFAULT_JITTER_MS = 250;
const PATCH_MARK = Symbol.for("huikai.notionApiRetryInstalled");

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

export function retryDelayMs(error, attempt, random = Math.random, options = {}) {
  const maxFallbackDelayMs = options.maxFallbackDelayMs ?? DEFAULT_MAX_FALLBACK_DELAY_MS;
  const jitterMs = options.jitterMs ?? DEFAULT_JITTER_MS;
  const rawRetryAfter = headerValue(error?.headers, "retry-after");
  const retryAfterSeconds = rawRetryAfter === null ? Number.NaN : Number(rawRetryAfter);
  const fallbackMs = Math.min((2 ** attempt) * 1000, maxFallbackDelayMs);
  const baseMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
    ? retryAfterSeconds * 1000
    : fallbackMs;
  return Math.max(0, baseMs) + Math.max(0, random()) * jitterMs;
}

export function shouldRetryNotionError(error, method = "GET") {
  const status = Number(error?.status);
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (status === 429 || status === 529) return true;
  return (normalizedMethod === "GET" || normalizedMethod === "DELETE") &&
    [500, 502, 503, 504].includes(status);
}

export function createNotionRequestRetrier({
  request,
  maxRetries = DEFAULT_MAX_RETRIES,
  sleep = defaultSleep,
  random = Math.random,
  now = Date.now,
  warn = console.warn
}) {
  if (typeof request !== "function") throw new TypeError("request must be a function");

  let blockedUntil = 0;

  async function waitForSharedCooldown() {
    const remaining = blockedUntil - now();
    if (remaining > 0) await sleep(remaining);
  }

  return async function requestWithRetry(args = {}) {
    const method = String(args.method || "GET").toUpperCase();

    for (let attempt = 0; ; attempt += 1) {
      await waitForSharedCooldown();
      try {
        return await request.call(this, args);
      } catch (error) {
        if (!shouldRetryNotionError(error, method) || attempt >= maxRetries) {
          throw error;
        }

        const delayMs = retryDelayMs(error, attempt, random);
        if (Number(error?.status) === 429 || Number(error?.status) === 529) {
          blockedUntil = Math.max(blockedUntil, now() + delayMs);
        }

        warn(
          `⚠️  Notion API HTTP ${error?.status ?? "error"}，等待 ${Math.ceil(delayMs)}ms 後重試 ` +
          `(${attempt + 1}/${maxRetries})`
        );
        await sleep(delayMs);
      }
    }
  };
}

export async function installNotionApiRetry(options = {}) {
  const { Client } = await import("@notionhq/client");
  if (Client.prototype[PATCH_MARK]) return;

  const originalRequest = Client.prototype.request;
  Client.prototype.request = createNotionRequestRetrier({
    request: originalRequest,
    ...options
  });
  Object.defineProperty(Client.prototype, PATCH_MARK, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

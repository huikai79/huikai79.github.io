#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  createNotionRequestRetrier,
  retryDelayMs,
  shouldRetryNotionError
} from "./notion-api-retry.mjs";

const errorResponse = (status, retryAfter = null) => ({
  status,
  headers: {
    get(name) {
      return name.toLowerCase() === "retry-after" ? retryAfter : null;
    }
  }
});

assert.equal(shouldRetryNotionError(errorResponse(429), "POST"), true);
assert.equal(shouldRetryNotionError(errorResponse(529), "PATCH"), true);
assert.equal(shouldRetryNotionError(errorResponse(503), "GET"), true);
assert.equal(shouldRetryNotionError(errorResponse(503), "POST"), false);
assert.equal(shouldRetryNotionError(errorResponse(400), "GET"), false);
assert.equal(retryDelayMs(errorResponse(429, "2"), 0, () => 0), 2000);
assert.equal(retryDelayMs(errorResponse(429), 3, () => 0), 8000);

{
  let calls = 0;
  const sleeps = [];
  const warnings = [];
  let clock = 1000;
  const retried = createNotionRequestRetrier({
    request: async () => {
      calls += 1;
      if (calls === 1) throw errorResponse(429, "2");
      return { ok: true };
    },
    sleep: async ms => { sleeps.push(ms); clock += ms; },
    random: () => 0,
    now: () => clock,
    warn: message => warnings.push(message)
  });

  assert.deepEqual(await retried({ method: "POST" }), { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [2000]);
  assert.match(warnings[0], /HTTP 429/);
}

{
  let calls = 0;
  const sleeps = [];
  let clock = 1000;
  const retried = createNotionRequestRetrier({
    request: async () => {
      calls += 1;
      if (calls < 3) throw errorResponse(429);
      return "ok";
    },
    sleep: async ms => { sleeps.push(ms); clock += ms; },
    random: () => 0,
    now: () => clock,
    warn: () => {}
  });

  assert.equal(await retried({ method: "POST" }), "ok");
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
}

{
  let calls = 0;
  const retried = createNotionRequestRetrier({
    request: async () => {
      calls += 1;
      throw errorResponse(429, "0");
    },
    maxRetries: 2,
    sleep: async () => {},
    random: () => 0,
    now: () => 0,
    warn: () => {}
  });

  await assert.rejects(() => retried({ method: "POST" }), error => error.status === 429);
  assert.equal(calls, 3);
}

{
  let calls = 0;
  const retried = createNotionRequestRetrier({
    request: async () => {
      calls += 1;
      throw errorResponse(503);
    },
    sleep: async () => {},
    random: () => 0,
    now: () => 0,
    warn: () => {}
  });

  await assert.rejects(() => retried({ method: "POST" }), error => error.status === 503);
  assert.equal(calls, 1);
}

console.log("Notion API retry tests: PASS");

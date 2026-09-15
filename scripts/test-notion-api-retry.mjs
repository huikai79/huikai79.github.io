#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  createNotionClient,
  createNotionFetchTransport,
  notionTransportStats,
  retryDelayMs,
  shouldRetryNotionResponse
} from "./notion-api-retry.mjs";

const response = (status, retryAfter = null, body = "{}") => new Response(body, {
  status,
  headers: retryAfter === null
    ? { "Content-Type": "application/json" }
    : { "Content-Type": "application/json", "Retry-After": retryAfter }
});

assert.equal(shouldRetryNotionResponse(response(429), "POST"), true);
assert.equal(shouldRetryNotionResponse(response(529), "PATCH"), true);
assert.equal(shouldRetryNotionResponse(response(503), "GET"), true);
assert.equal(shouldRetryNotionResponse(response(503), "PATCH"), false);
assert.equal(shouldRetryNotionResponse(response(400), "GET"), false);
assert.equal(retryDelayMs(response(429, "2"), 0, () => 0), 2000);
assert.equal(retryDelayMs(response(429), 3, () => 0), 8000);

{
  let calls = 0;
  const sleeps = [];
  const warnings = [];
  let clock = 1000;
  const transport = createNotionFetchTransport({
    fetch: async () => {
      calls += 1;
      return calls === 1 ? response(429, "2") : response(200);
    },
    minIntervalMs: 0,
    sleep: async ms => { sleeps.push(ms); clock += ms; },
    random: () => 0,
    now: () => clock,
    warn: message => warnings.push(message)
  });

  assert.equal((await transport.fetch("https://api.notion.test", { method: "POST" })).status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [2000]);
  assert.match(warnings[0], /HTTP 429/);
  assert.deepEqual(transport.stats, {
    requestCount: 2,
    rateLimited429Count: 1,
    overloaded529Count: 0,
    retryCount: 1,
    maxRetryDelayMs: 2000
  });
}

{
  let calls = 0;
  const sleeps = [];
  let clock = 0;
  const transport = createNotionFetchTransport({
    fetch: async () => {
      calls += 1;
      return calls === 1 ? response(529) : response(200);
    },
    minIntervalMs: 0,
    sleep: async ms => { sleeps.push(ms); clock += ms; },
    random: () => 0,
    now: () => clock,
    warn: () => {}
  });
  assert.equal((await transport.fetch("https://api.notion.test", { method: "PATCH" })).status, 200);
  assert.deepEqual(sleeps, [1000]);
}

{
  let calls = 0;
  const transport = createNotionFetchTransport({
    fetch: async () => {
      calls += 1;
      return calls === 1 ? response(503) : response(200);
    },
    minIntervalMs: 0,
    sleep: async () => {},
    random: () => 0,
    now: () => 0,
    warn: () => {}
  });
  assert.equal((await transport.fetch("https://api.notion.test", { method: "GET" })).status, 200);
  assert.equal(calls, 2);
}

{
  let calls = 0;
  const transport = createNotionFetchTransport({
    fetch: async () => { calls += 1; return response(503); },
    minIntervalMs: 0,
    sleep: async () => {},
    random: () => 0,
    now: () => 0,
    warn: () => {}
  });
  assert.equal((await transport.fetch("https://api.notion.test", { method: "PATCH" })).status, 503);
  assert.equal(calls, 1);
}

{
  let calls = 0;
  const transport = createNotionFetchTransport({
    fetch: async () => { calls += 1; return response(400); },
    minIntervalMs: 0,
    sleep: async () => {},
    random: () => 0,
    now: () => 0,
    warn: () => {}
  });
  assert.equal((await transport.fetch("https://api.notion.test", { method: "GET" })).status, 400);
  assert.equal(calls, 1);
}

{
  let calls = 0;
  const transport = createNotionFetchTransport({
    fetch: async () => { calls += 1; return response(429, "0"); },
    maxRetries: 2,
    minIntervalMs: 0,
    sleep: async () => {},
    random: () => 0,
    now: () => 0,
    warn: () => {}
  });
  assert.equal((await transport.fetch("https://api.notion.test", { method: "POST" })).status, 429);
  assert.equal(calls, 3, "maxRetries=2 means initial request plus two retries");
}

{
  const dispatchTimes = [];
  const sleeps = [];
  let clock = 1000;
  const transport = createNotionFetchTransport({
    fetch: async () => { dispatchTimes.push(clock); return response(200); },
    minIntervalMs: 450,
    sleep: async ms => { sleeps.push(ms); clock += ms; },
    random: () => 0,
    now: () => clock,
    warn: () => {}
  });
  await Promise.all([
    transport.fetch("https://api.notion.test/one"),
    transport.fetch("https://api.notion.test/two")
  ]);
  assert.deepEqual(dispatchTimes, [1000, 1450]);
  assert.deepEqual(sleeps, [450]);
}

{
  let calls = 0;
  const fakeFetch = async (input, init = {}) => {
    calls += 1;
    assert.match(String(input), /\/v1\/databases\/database-id\/query$/);
    assert.equal(String(init.method).toUpperCase(), "POST");
    if (calls === 1) return response(429, "0");
    return response(200, null, JSON.stringify({ object: "list", results: [], has_more: false, next_cursor: null }));
  };
  const notion = createNotionClient({
    auth: "secret_test",
    transportOptions: {
      fetch: fakeFetch,
      minIntervalMs: 0,
      sleep: async () => {},
      random: () => 0,
      now: () => 0,
      warn: () => {}
    }
  });
  const result = await notion.databases.query({ database_id: "database-id" });
  assert.deepEqual(result.results, []);
  assert.equal(calls, 2, "pinned SDK request must flow through injected fetch transport");
  assert.equal(notionTransportStats(notion).rateLimited429Count, 1);
}

console.log("Notion API transport tests: PASS");

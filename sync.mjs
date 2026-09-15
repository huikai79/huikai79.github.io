#!/usr/bin/env node
import { installNotionApiRetry } from "./scripts/notion-api-retry.mjs";

// Install one shared Notion retry/backoff policy before loading the sync implementation.
// This covers direct SDK calls and notion-to-md calls that use the same Client prototype.
await installNotionApiRetry();
await import("./sync-impl.mjs");

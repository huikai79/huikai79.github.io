#!/usr/bin/env node
import { installNotionApiRetry } from "./notion-api-retry.mjs";

// The publication preflight is part of the sync path, so it shares the same
// Retry-After/backoff behavior instead of failing before sync.mjs can run.
await installNotionApiRetry();
await import("./check-notion-publication-contract-impl.mjs");

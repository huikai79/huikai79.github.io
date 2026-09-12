#!/usr/bin/env node
import assert from "node:assert/strict";

const requiredProperties = [
  "Ingestion Status",
  "Canonical URL",
  "Source Hash",
  "Retrieved At",
  "Source Published At",
  "Ingestion Note",
  "Rights Status"
];

assert.equal(new Set(requiredProperties).size, requiredProperties.length);
console.log(`external ingestion schema contract: ${requiredProperties.join(", ")}`);

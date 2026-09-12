#!/usr/bin/env node

export const REQUIRED_EXTERNAL_INGESTION_PROPERTIES = Object.freeze({
  "Ingestion Status": "select",
  "Canonical URL": "url",
  "Source Hash": "rich_text",
  "Retrieved At": "date",
  "Source Published At": "date",
  "Ingestion Note": "rich_text",
  "Rights Status": "select"
});

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(REQUIRED_EXTERNAL_INGESTION_PROPERTIES, null, 2));
}

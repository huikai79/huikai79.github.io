#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  loadSourceRightsRegistry,
  normalizedSourceUrl,
  resolveSourceRightsPolicy,
  rightsPolicySummary
} from "./source-rights-registry.mjs";

const registry = await loadSourceRightsRegistry();

assert.equal(
  normalizedSourceUrl("https://paulgraham.com/words.html?utm_source=test&id=42#note"),
  "https://paulgraham.com/words.html?id=42#note"
);

const paul = rightsPolicySummary(resolveSourceRightsPolicy("https://www.paulgraham.com/words.html", registry));
assert.equal(paul.id, "paul-graham");
assert.equal(paul.fullTranslation, "allow-with-obligations");
assert.ok(paul.obligations.includes("notify-translation-url"));

const giles = rightsPolicySummary(resolveSourceRightsPolicy(
  "https://www.gilesthomas.com/2025/02/blogging-in-the-age-of-ai?utm_medium=social",
  registry
));
assert.equal(giles.id, "giles-thomas-blogging-ai");
assert.equal(giles.matchType, "exact-url");
assert.equal(giles.license, "CC-BY-4.0");

const aeon = rightsPolicySummary(resolveSourceRightsPolicy("https://aeon.co/essays/example", registry));
assert.equal(aeon.id, "aeon");
assert.equal(aeon.fullTranslation, "agreement-required");
assert.equal(aeon.media, "excluded-from-standard-republication");

const unknown = rightsPolicySummary(resolveSourceRightsPolicy("https://example.org/article", registry));
assert.equal(unknown.id, "unknown-source");
assert.equal(unknown.fullTranslation, "unknown");

console.log("Source rights registry tests: PASS");

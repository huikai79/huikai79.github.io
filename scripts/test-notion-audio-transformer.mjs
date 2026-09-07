#!/usr/bin/env node
import assert from "node:assert/strict";
import { notionAudioMarkdown } from "./notion-audio-transformer.mjs";

const blockId = "23b7a59e-0439-8006-a923-e6b66af95201";
const wavBlock = {
  id: blockId,
  type: "audio",
  audio: {
    type: "file",
    file: {
      url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/workspace/page/demo.wav?X-Amz-Signature=temporary"
    }
  }
};

assert.equal(
  notionAudioMarkdown(wavBlock),
  `{{< notion-audio block="${blockId}" >}}`,
  "uploaded audio must become a gateway shortcode containing only its Notion block ID"
);

for (const url of [
  "https://example.com/demo.mp3",
  "https://example.com/demo.oga",
  "https://example.com/demo.midi",
  "https://example.com/download-without-extension?token=temporary"
]) {
  assert.equal(
    notionAudioMarkdown({ ...wavBlock, audio: { type: "file", file: { url } } }),
    `{{< notion-audio block="${blockId}" >}}`,
    "temporary URL filename must not be treated as the authoritative audio type"
  );
}

assert.equal(
  notionAudioMarkdown({ id: blockId, type: "audio", audio: { type: "external", external: { url: "https://example.com/audio.mp3" } } }),
  false,
  "external audio must retain notion-to-md default handling"
);

assert.throws(
  () => notionAudioMarkdown({ ...wavBlock, audio: { type: "file", file: { url: "file:///tmp/demo.wav" } } }),
  /non-HTTPS file URL/,
  "uploaded audio transport must remain HTTPS"
);

assert.throws(
  () => notionAudioMarkdown({ ...wavBlock, audio: { type: "file", file: { url: "not a url" } } }),
  /invalid file URL/,
  "invalid temporary URLs must fail closed"
);

assert.throws(
  () => notionAudioMarkdown({ ...wavBlock, id: "bad-id" }),
  /invalid block id/,
  "gateway shortcode must never be emitted without a valid Notion block ID"
);

console.log("Notion audio transformer verification: PASS");

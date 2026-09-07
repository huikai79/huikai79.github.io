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
  "uploaded WAV must become a gateway shortcode containing only its Notion block ID"
);

for (const extension of ["mp3", "m4a", "aac", "ogg", "flac"]) {
  assert.equal(
    notionAudioMarkdown({
      ...wavBlock,
      audio: { type: "file", file: { url: `https://example.com/demo.${extension}` } }
    }),
    `{{< notion-audio block="${blockId}" >}}`,
    `uploaded ${extension} must be admitted to the audio gateway`
  );
}

assert.equal(
  notionAudioMarkdown({ id: blockId, type: "audio", audio: { type: "external", external: { url: "https://example.com/audio.mp3" } } }),
  false,
  "external audio must retain notion-to-md default handling"
);

assert.throws(
  () => notionAudioMarkdown({ ...wavBlock, audio: { type: "file", file: { url: "https://example.com/demo.aiff" } } }),
  /Unsupported Notion uploaded audio format/,
  "unsupported uploaded audio formats must fail closed rather than enter Git"
);

assert.throws(
  () => notionAudioMarkdown({ ...wavBlock, id: "bad-id" }),
  /invalid block id/,
  "gateway shortcode must never be emitted without a valid Notion block ID"
);

console.log("Notion audio transformer verification: PASS");

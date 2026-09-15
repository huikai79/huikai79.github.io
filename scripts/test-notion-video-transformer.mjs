#!/usr/bin/env node
import assert from "node:assert/strict";
import { notionVideoMarkdown } from "./notion-video-transformer.mjs";

const blockId = "3d27a59e-0439-80d9-a6c5-f293186a10e0";
const mp4Block = {
  id: blockId,
  type: "video",
  video: {
    type: "file",
    file: {
      url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/workspace/page/demo.mp4?X-Amz-Signature=temporary"
    }
  }
};

assert.equal(
  notionVideoMarkdown(mp4Block),
  `{{< notion-video block="${blockId}" >}}`,
  "uploaded MP4 must become a gateway shortcode containing only its Notion block ID"
);

for (const url of [
  "https://www.youtube.com/watch?v=-6HOdHEeosc",
  "https://youtu.be/-6HOdHEeosc?t=90",
  "https://www.youtube.com/embed/-6HOdHEeosc",
  "https://www.youtube.com/shorts/-6HOdHEeosc",
  "https://www.youtube.com/live/-6HOdHEeosc?feature=share"
]) {
  assert.equal(
    notionVideoMarkdown({ id: blockId, type: "video", video: { type: "external", external: { url } } }),
    "{{< youtube -6HOdHEeosc >}}",
    `external YouTube video block must become a YouTube shortcode: ${url}`
  );
}

assert.equal(
  notionVideoMarkdown({
    id: blockId,
    type: "video",
    video: { type: "external", external: { url: "https://example.com/video.mp4" } }
  }),
  false,
  "non-YouTube external videos must retain notion-to-md default handling"
);

assert.equal(
  notionVideoMarkdown({
    id: blockId,
    type: "video",
    video: { type: "external", external: { url: "https://youtube.com.evil.example/watch?v=-6HOdHEeosc" } }
  }),
  false,
  "lookalike YouTube hosts must not be accepted"
);

assert.throws(
  () => notionVideoMarkdown({ ...mp4Block, video: { type: "file", file: { url: "https://example.com/demo.mov" } } }),
  /Unsupported Notion uploaded video format/,
  "unsupported uploaded video formats must fail closed rather than enter Git"
);

assert.throws(
  () => notionVideoMarkdown({ ...mp4Block, id: "bad-id" }),
  /invalid block id/,
  "gateway shortcode must never be emitted without a valid Notion block ID"
);

console.log("Notion video transformer verification: PASS");

import assert from "node:assert/strict";
import { validArticlePath } from "./index.js";

const accepted = [
  "/posts/example/",
  "/zh-cn/posts/example/",
  "/en/posts/example/",
  "/posts/example-123_test/",
  "/posts/謙卑與學習/",
  "/zh-cn/posts/%E8%B0%A6%E5%8D%91/",
];

const rejected = [
  "",
  "/zh-tw/posts/example/",
  "/fr/posts/example/",
  "/projects/example/",
  "/zh-cn/projects/example/",
  "/posts/example",
  "/posts/example/extra/",
  "/posts/../secret/",
  "/posts/%2e%2e/",
  "/posts/foo%2Fbar/",
  "/posts/foo%5Cbar/",
  "/posts/%E0%A4%A/",
  "/posts/foo?bar/",
  "/posts/foo#bar/",
  "https://huikai.com.kg/posts/example/",
];

for (const path of accepted) {
  assert.equal(validArticlePath(path), true, `expected accepted media article path: ${path}`);
}

for (const path of rejected) {
  assert.equal(validArticlePath(path), false, `expected rejected media article path: ${path}`);
}

console.log(`Media gateway path verification: PASS (${accepted.length} accepted, ${rejected.length} rejected)`);

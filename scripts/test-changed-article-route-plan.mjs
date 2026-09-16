import assert from "node:assert/strict";
import {
  articlePathInfo,
  articleRoute,
  parseNameStatus,
  planChangedArticleRoutes
} from "./changed-article-route-plan.mjs";

assert.equal(articleRoute("example", "zh-TW"), "/posts/example/");
assert.equal(articleRoute("example", "zh-CN"), "/zh-cn/posts/example/");
assert.equal(articleRoute("example", "en"), "");

assert.deepEqual(articlePathInfo("content/posts/example/index.md"), {
  slug: "example",
  relative: "index.md",
  language: "zh-TW",
  route: "/posts/example/"
});
assert.equal(articlePathInfo("layouts/partials/example.html"), null);

assert.deepEqual(parseNameStatus(
  "M\tcontent/posts/a/index.md\nD\tcontent/posts/b/index.zh-cn.md\nR100\tcontent/posts/c/index.md\tcontent/posts/d/index.md\n"
), [
  { status: "M", path: "content/posts/a/index.md" },
  { status: "D", path: "content/posts/b/index.zh-cn.md" },
  { status: "R100", oldPath: "content/posts/c/index.md", path: "content/posts/d/index.md" }
]);

const direct = planChangedArticleRoutes(
  [{ status: "M", path: "content/posts/a/index.md" }],
  ["content/posts/a/index.md"]
);
assert.deepEqual(direct.present.map(item => item.route), ["/posts/a/"]);
assert.deepEqual(direct.absent, []);

const assetChange = planChangedArticleRoutes(
  [{ status: "M", path: "content/posts/a/cover.jpg" }],
  ["content/posts/a/index.md", "content/posts/a/index.zh-cn.md", "content/posts/a/cover.jpg"]
);
assert.deepEqual(assetChange.present.map(item => item.route), ["/posts/a/", "/zh-cn/posts/a/"]);

const deletion = planChangedArticleRoutes(
  [{ status: "D", path: "content/posts/b/index.zh-cn.md" }],
  ["content/posts/b/index.md"]
);
assert.deepEqual(deletion.present.map(item => item.route), ["/posts/b/"]);
assert.deepEqual(deletion.absent.map(item => item.route), ["/zh-cn/posts/b/"]);

const rename = planChangedArticleRoutes(
  [{ status: "R100", oldPath: "content/posts/old/index.md", path: "content/posts/new/index.md" }],
  ["content/posts/new/index.md"]
);
assert.deepEqual(rename.present.map(item => item.route), ["/posts/new/"]);
assert.deepEqual(rename.absent.map(item => item.route), ["/posts/old/"]);

const unrelated = planChangedArticleRoutes(
  [{ status: "M", path: "assets/css/custom.css" }],
  ["content/posts/a/index.md"]
);
assert.deepEqual(unrelated, { present: [], absent: [] });

console.log("Changed article route plan tests: PASS");

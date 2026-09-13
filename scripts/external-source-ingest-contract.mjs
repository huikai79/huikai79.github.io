import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const MIN_ARTICLE_TEXT = 200;
export const MAX_INGESTION_REDIRECTS = 5;
export const INGESTION_STATUS = Object.freeze({
  READY: "Ready",
  NEEDS_REVIEW: "Needs Review",
  DUPLICATE: "Duplicate"
});

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"
]);
const DROP_TAGS = new Set(["script", "style", "noscript", "svg", "canvas", "form", "nav", "footer", "aside"]);
const NOISE_RE = /(?:^|[\s_-])(nav|menu|footer|sidebar|share|social|related|recommend|comment|promo|advert|ads?|newsletter|cookie|consent|breadcrumb)(?:$|[\s_-])/i;

function ipv4Parts(address) {
  const parts = String(address).split(".").map(Number);
  return parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

export function isPublicIpAddress(address) {
  const version = isIP(address);
  if (!version) return false;
  if (version === 4) {
    const p = ipv4Parts(address);
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a >= 224) return false;
    return true;
  }

  const normalized = String(address).toLowerCase();
  if (normalized === "::" || normalized === "::1") return false;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
  if (/^fe[89ab]/.test(normalized)) return false;
  if (normalized.startsWith("ff")) return false;
  if (normalized.startsWith("2001:db8:")) return false;
  if (normalized.startsWith("::ffff:")) {
    const tail = normalized.slice("::ffff:".length);
    return isPublicIpAddress(tail);
  }
  return true;
}

export function validateIngestionUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    throw new Error("invalid Source URL");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("Source URL must use http or https");
  if (url.username || url.password) throw new Error("Source URL must not contain credentials");
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Source URL hostname is not public");
  }
  if (isIP(hostname) && !isPublicIpAddress(hostname)) throw new Error("Source URL resolves to a non-public address");
  url.hash = "";
  return url;
}

function decodeEntity(entity) {
  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    const value = Number.parseInt(entity.slice(2), 16);
    return Number.isFinite(value) ? String.fromCodePoint(value) : `&${entity};`;
  }
  if (entity.startsWith("#")) {
    const value = Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(value) ? String.fromCodePoint(value) : `&${entity};`;
  }
  return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[entity] ?? `&${entity};`;
}

export function decodeHtmlText(value) {
  return String(value || "").replace(/&([a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g, (_m, entity) => decodeEntity(entity));
}

function parseAttributes(source) {
  const attrs = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    const key = String(match[1] || "").toLowerCase();
    if (!key) continue;
    attrs[key] = decodeHtmlText(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

export function parseHtmlTree(html) {
  const root = { type: "element", tag: "root", attrs: {}, children: [], parent: null };
  const stack = [root];
  const tokenRe = /<!--[\s\S]*?-->|<![^>]*>|<\/?[^>]+>|[^<]+/g;
  let token;
  while ((token = tokenRe.exec(String(html || "")))) {
    const value = token[0];
    if (!value || value.startsWith("<!--") || /^<!/i.test(value)) continue;
    if (value.startsWith("</")) {
      const tag = value.slice(2, -1).trim().toLowerCase();
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (value.startsWith("<")) {
      const selfClosing = /\/\s*>$/.test(value);
      const inner = value.slice(1, value.length - 1).replace(/\/\s*$/, "").trim();
      const nameMatch = inner.match(/^([^\s/>]+)/);
      if (!nameMatch) continue;
      const tag = nameMatch[1].toLowerCase();
      const attrs = parseAttributes(inner.slice(nameMatch[0].length));
      const parent = stack[stack.length - 1];
      const node = { type: "element", tag, attrs, children: [], parent };
      parent.children.push(node);
      if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(node);
      continue;
    }
    const parent = stack[stack.length - 1];
    parent.children.push({ type: "text", text: decodeHtmlText(value), parent });
  }
  return root;
}

function walk(node, fn) {
  if (!node) return;
  fn(node);
  for (const child of node.children ?? []) walk(child, fn);
}

function findElements(root, predicate) {
  const found = [];
  walk(root, node => {
    if (node.type === "element" && predicate(node)) found.push(node);
  });
  return found;
}

function firstElement(root, predicate) {
  return findElements(root, predicate)[0] ?? null;
}

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function nodeText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text;
  if (DROP_TAGS.has(node.tag)) return "";
  if (node.tag === "br") return "\n";
  return (node.children ?? []).map(nodeText).join(" ");
}

function attrNoise(node) {
  const marker = `${node.attrs?.id ?? ""} ${node.attrs?.class ?? ""}`.trim();
  return marker && NOISE_RE.test(marker);
}

function candidateScore(node) {
  const text = normalizedText(nodeText(node));
  if (text.length < MIN_ARTICLE_TEXT) return -1;
  let paragraphCount = 0;
  let linkText = 0;
  walk(node, child => {
    if (child.type !== "element") return;
    if (child.tag === "p") paragraphCount += 1;
    if (child.tag === "a") linkText += normalizedText(nodeText(child)).length;
  });
  return text.length + paragraphCount * 200 - Math.round(linkText * 0.5);
}

function bestContentRoot(tree) {
  const articles = findElements(tree, node => node.tag === "article" && !attrNoise(node));
  const mains = findElements(tree, node => node.tag === "main" && !attrNoise(node));
  const pools = articles.length ? articles : mains.length ? mains : findElements(tree, node => node.tag === "body");
  const ranked = pools.map(node => ({ node, score: candidateScore(node) })).sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 0 ? ranked[0].node : null;
}

function metaValue(tree, keys) {
  for (const key of keys) {
    const match = firstElement(tree, node => {
      if (node.tag !== "meta") return false;
      const name = String(node.attrs?.name ?? node.attrs?.property ?? node.attrs?.itemprop ?? "").toLowerCase();
      return name === key.toLowerCase() && Boolean(node.attrs?.content);
    });
    if (match) return normalizedText(match.attrs.content);
  }
  return "";
}

function absoluteUrl(value, baseUrl) {
  if (!value) return "";
  try {
    const url = new URL(value, baseUrl);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function canonicalUrl(tree, baseUrl) {
  const canonical = firstElement(tree, node => {
    if (node.tag !== "link" || !node.attrs?.href) return false;
    return String(node.attrs.rel || "").toLowerCase().split(/\s+/).includes("canonical");
  });
  return absoluteUrl(canonical?.attrs?.href, baseUrl) || baseUrl;
}

function documentTitle(tree) {
  const fromMeta = metaValue(tree, ["og:title", "twitter:title"]);
  if (fromMeta) return fromMeta;
  const title = firstElement(tree, node => node.tag === "title");
  if (title) return normalizedText(nodeText(title));
  const h1 = firstElement(tree, node => node.tag === "h1");
  return normalizedText(nodeText(h1));
}

function documentAuthor(tree) {
  const fromMeta = metaValue(tree, ["author", "article:author", "byl"]);
  if (fromMeta) return fromMeta;
  const byline = firstElement(tree, node => {
    const marker = `${node.attrs?.class ?? ""} ${node.attrs?.id ?? ""}`;
    return /\b(author|byline)\b/i.test(marker) && normalizedText(nodeText(node)).length <= 200;
  });
  return normalizedText(nodeText(byline));
}

function documentPublishedAt(tree) {
  const value = metaValue(tree, ["article:published_time", "datepublished", "date", "pubdate"]);
  if (value) return value;
  const time = firstElement(tree, node => node.tag === "time" && Boolean(node.attrs?.datetime));
  return normalizedText(time?.attrs?.datetime);
}

function explicitLanguage(tree) {
  const html = firstElement(tree, node => node.tag === "html" && Boolean(node.attrs?.lang));
  return String(html?.attrs?.lang || "").trim().toLowerCase();
}

function detectSourceLanguage(tree, articleText) {
  const explicit = explicitLanguage(tree);
  if (explicit) return explicit.startsWith("en") ? "en" : explicit;
  const letters = (articleText.match(/[A-Za-z]/g) || []).length;
  const cjk = (articleText.match(/[\u3400-\u9FFF]/g) || []).length;
  const total = letters + cjk;
  if (total >= 100 && letters / total >= 0.9) return "en";
  return "unknown";
}

function cleanNodeText(node) {
  if (!node || attrNoise(node) || DROP_TAGS.has(node.tag)) return "";
  return normalizedText(nodeText(node));
}

function listAncestor(node) {
  let current = node?.parent;
  while (current) {
    if (current.tag === "ol" || current.tag === "ul") return current.tag;
    current = current.parent;
  }
  return "";
}

export function articleBlocksFromRoot(root) {
  const blocks = [];
  const accepted = new Set(["h1", "h2", "h3", "p", "li", "blockquote", "pre"]);

  function visit(node) {
    if (!node || node.type !== "element") return;
    if (DROP_TAGS.has(node.tag) || attrNoise(node)) return;
    if (accepted.has(node.tag)) {
      const text = cleanNodeText(node);
      if (!text) return;
      let type = "paragraph";
      if (node.tag === "h1") type = "heading_1";
      else if (node.tag === "h2") type = "heading_2";
      else if (node.tag === "h3") type = "heading_3";
      else if (node.tag === "blockquote") type = "quote";
      else if (node.tag === "pre") type = "code";
      else if (node.tag === "li") type = listAncestor(node) === "ol" ? "numbered_list_item" : "bulleted_list_item";
      blocks.push({ type, text });
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }

  for (const child of root.children ?? []) visit(child);
  return blocks;
}

export function normalizedArticleText(blocks) {
  return blocks.map(block => normalizedText(block.text)).filter(Boolean).join("\n");
}

export function sourceHash({ canonicalUrl: canonical, title, blocks }) {
  const normalized = [String(canonical || "").trim(), normalizedText(title), normalizedArticleText(blocks)].join("\n");
  return createHash("sha256").update(normalized).digest("hex");
}

export function extractArticleDocument(html, fetchedUrl) {
  const base = validateIngestionUrl(fetchedUrl).toString();
  const tree = parseHtmlTree(html);
  const root = bestContentRoot(tree);
  if (!root) throw new Error("article body could not be identified");
  const blocks = articleBlocksFromRoot(root);
  const articleText = normalizedArticleText(blocks);
  if (articleText.length < MIN_ARTICLE_TEXT) throw new Error("article body is too short after extraction");
  const language = detectSourceLanguage(tree, articleText);
  if (language !== "en") throw new Error(`unsupported source language: ${language}`);
  const title = documentTitle(tree);
  if (!title) throw new Error("article title could not be identified");
  const canonical = canonicalUrl(tree, base);
  return {
    title,
    author: documentAuthor(tree),
    publishedAt: documentPublishedAt(tree),
    language,
    canonicalUrl: canonical,
    blocks,
    textLength: articleText.length,
    hash: sourceHash({ canonicalUrl: canonical, title, blocks })
  };
}

function richTextChunks(text, limit = 1900) {
  const value = String(text || "");
  const chunks = [];
  let rest = value;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(" ", limit);
    if (cut < Math.floor(limit * 0.6)) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function notionRichText(text) {
  return richTextChunks(text).map(content => ({ type: "text", text: { content } }));
}

export function notionBlocksFromArticle(blocks) {
  return blocks.map(block => {
    if (block.type === "code") {
      return {
        object: "block",
        type: "code",
        code: { rich_text: notionRichText(block.text), language: "plain text", caption: [] }
      };
    }
    const supported = new Set([
      "paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "quote"
    ]);
    if (!supported.has(block.type)) throw new Error(`unsupported article block type ${block.type}`);
    return {
      object: "block",
      type: block.type,
      [block.type]: { rich_text: notionRichText(block.text) }
    };
  });
}

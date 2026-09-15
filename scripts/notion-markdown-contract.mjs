export function notionDividerMarkdown() {
  return "* * *";
}

export function markdownBodyIssues(markdown) {
  const issues = [];
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (/\]\(\s*{{</.test(line)) {
      issues.push(`line ${index + 1}: Hugo shortcode found inside a Markdown link destination`);
    }

    if (/^(?:-{3,}|={3,})$/.test(trimmed)) {
      const previous = index > 0 ? lines[index - 1].trim() : "";
      if (previous) {
        issues.push(`line ${index + 1}: ambiguous Setext heading/thematic break after non-blank content`);
      }
    }
  }

  return issues;
}

export function assertMarkdownBodySafe(markdown, label = "Notion article") {
  const issues = markdownBodyIssues(markdown);
  if (issues.length) {
    throw new Error(`${label} produced unsafe Markdown: ${issues.join("; ")}`);
  }
  return markdown;
}

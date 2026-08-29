export function markdownToPlainText(md: string, dropHeadings = false): string {
  let text = md;

  // Remove YAML frontmatter
  text = text.replace(/^---\n[\s\S]*?\n---\n?/, "");

  // Strip metadata section before first --- divider (e.g., 元信息 in copywriting.md)
  // Pattern: content before a standalone --- line (not YAML frontmatter)
  const dividerMatch = text.match(/^([\s\S]*?)\n---\s*\n([\s\S]*)$/m);
  if (dividerMatch) {
    text = dividerMatch[2];
  }

  // Remove code blocks (``` ... ```)
  text = text.replace(/```[\s\S]*?```/g, "");

  // Remove inline code
  text = text.replace(/`([^`]+)`/g, "$1");

  // Remove images ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "");

  // Convert links [text](url) to just text
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Remove headings: whole line when dropHeadings (口播稿结构标签不该被读), else just the markers
  text = dropHeadings
    ? text.replace(/^#{1,6}\s+.*$/gm, "")
    : text.replace(/^#{1,6}\s+/gm, "");

  // Remove bold/italic markers
  text = text.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  text = text.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");

  // Remove strikethrough
  text = text.replace(/~~([^~]+)~~/g, "$1");

  // Remove blockquote markers
  text = text.replace(/^>\s?/gm, "");

  // Remove horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");

  // Remove unordered list markers
  text = text.replace(/^[\s]*[-*+]\s+/gm, "");

  // Remove ordered list markers
  text = text.replace(/^[\s]*\d+\.\s+/gm, "");

  // Collapse multiple blank lines into one
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

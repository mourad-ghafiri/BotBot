/**
 * Telegram formatting utilities — converts markdown to Telegram HTML and handles message splitting.
 */

const MAX_MESSAGE_LENGTH = 4096;

/** Escape HTML entities in text that will be sent with parse_mode=HTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function markdownToTelegramHtml(text: string): string {
  if (!text) return '';

  // If text already contains Telegram HTML tags, assume it's formatted correctly
  if (/<\/?(?:b|i|u|s|code|pre|a)\b/.test(text)) {
    return text;
  }

  // Escape HTML entities first (before adding our own tags)
  let result = escapeHtml(text);

  // Code blocks: ```lang\ncode``` → <pre>code</pre> (must be before other transformations)
  result = result.replace(/```\w*\n?([\s\S]*?)```/g, '<pre>$1</pre>');

  // Inline code: `code` → <code>code</code>
  result = result.replace(/`([^`\n]+?)`/g, '<code>$1</code>');

  // Bold: **text** or __text__
  result = result.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  result = result.replace(/__(.*?)__/g, '<b>$1</b>');

  // Italic: *text* or _text_ (careful not to match inside words/URLs)
  result = result.replace(/(?<![&\w])_([^_\n]+?)_(?![\w;])/g, '<i>$1</i>');
  result = result.replace(/(?<![&\w])\*([^*\n]+?)\*(?![\w;])/g, '<i>$1</i>');

  // Links: [text](url)
  result = result.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, '<a href="$2">$1</a>');

  // Strikethrough: ~~text~~
  result = result.replace(/~~(.*?)~~/g, '<s>$1</s>');

  // Headings: # text → bold text
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // Horizontal rules: --- or *** or ___ → empty line
  result = result.replace(/^[-*_]{3,}\s*$/gm, '');

  // Trailing double-space line breaks → newline
  result = result.replace(/ {2,}$/gm, '');

  // Clean up excessive blank lines (3+ → 2)
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

export function splitMessage(text: string, maxLength = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    // Try to split at double newline (paragraph break)
    let splitAt = remaining.lastIndexOf('\n\n', maxLength);
    if (splitAt < maxLength * 0.3) {
      // Try single newline
      splitAt = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitAt < maxLength * 0.3) {
      // Try space
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt < maxLength * 0.3) {
      // Force split
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

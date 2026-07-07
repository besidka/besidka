const MARKDOWN_HEADING_PATTERN = /^#{1,6}\s+/gm
const MARKDOWN_LIST_MARKER_PATTERN = /^[-*+]\s+/gm
const MARKDOWN_QUOTE_MARKER_PATTERN = /^>\s+/gm
const MARKDOWN_BOLD_PATTERN = /\*\*(.+?)\*\*/g
const MARKDOWN_UNDERSCORE_BOLD_PATTERN = /__(.+?)__/g
const MARKDOWN_ITALIC_PATTERN = /\*(.+?)\*/g
const MARKDOWN_UNDERSCORE_ITALIC_PATTERN = /_(.+?)_/g
const MARKDOWN_INLINE_CODE_PATTERN = /`([^`]+)`/g
const SENTENCE_END_PATTERN = /^(.*?[.?!])(?:\s|$)/
const WHITESPACE_PATTERN = /\s+/g

function stripMarkdownNoise(text: string): string {
  return text
    .replace(MARKDOWN_HEADING_PATTERN, '')
    .replace(MARKDOWN_LIST_MARKER_PATTERN, '')
    .replace(MARKDOWN_QUOTE_MARKER_PATTERN, '')
    .replace(MARKDOWN_BOLD_PATTERN, '$1')
    .replace(MARKDOWN_UNDERSCORE_BOLD_PATTERN, '$1')
    .replace(MARKDOWN_ITALIC_PATTERN, '$1')
    .replace(MARKDOWN_UNDERSCORE_ITALIC_PATTERN, '$1')
    .replace(MARKDOWN_INLINE_CODE_PATTERN, '$1')
}

function normalizeShareText(text: string): string {
  return stripMarkdownNoise(text).replace(WHITESPACE_PATTERN, ' ').trim()
}

function isNonEmptyTextPart(
  part: unknown,
): part is { type: 'text', text: string } {
  return (
    typeof part === 'object'
    && part !== null
    && 'type' in part
    && (part as { type: unknown }).type === 'text'
    && 'text' in part
    && typeof (part as { text: unknown }).text === 'string'
    && (part as { text: string }).text.trim().length > 0
  )
}

export function buildShareDescription(
  parts: unknown,
  maxLength = 160,
): string {
  if (!Array.isArray(parts)) {
    return ''
  }

  const textPart = parts.find(isNonEmptyTextPart)

  if (!textPart) {
    return ''
  }

  const normalized = normalizeShareText(textPart.text)

  if (!normalized) {
    return ''
  }

  const sentenceMatch = normalized.match(SENTENCE_END_PATTERN)
  const candidate = sentenceMatch?.[1] ?? normalized

  if (candidate.length <= maxLength) {
    return candidate
  }

  const truncated = Array.from(normalized).slice(0, maxLength).join('')
  const lastSpaceIndex = truncated.lastIndexOf(' ')
  const cut = lastSpaceIndex > 0
    ? truncated.slice(0, lastSpaceIndex)
    : truncated

  return `${cut}…`
}

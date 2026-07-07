const FENCED_CODE_BLOCK_REGEX = /```[^\n]*\n([\s\S]*?)```/g
const INLINE_CODE_REGEX = /`([^`\n]+?)`/g
const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const LINK_REGEX = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const BOLD_ASTERISK_REGEX = /\*\*(?!\s)([^\n*]+?)(?<!\s)\*\*/g
const BOLD_UNDERSCORE_REGEX = /(?<![\w])__(?!\s)([^\n_]+?)(?<!\s)__(?![\w])/g
const STRIKETHROUGH_REGEX = /~~(?!\s)([^\n~]+?)(?<!\s)~~/g
const ITALIC_ASTERISK_REGEX = /(?<!\*)\*(?!\s|\*)([^\n*]+?)(?<!\s)\*(?!\*)/g
const ITALIC_UNDERSCORE_REGEX = /(?<![\w])_(?!\s)([^\n_]+?)(?<!\s)_(?![\w])/g
const HORIZONTAL_RULE_REGEX = /^(-{3,}|\*{3,}|_{3,})$/
const HEADING_REGEX = /^#{1,6}\s+/
const BLOCKQUOTE_PREFIX_REGEX = /^(?:>\s?)+/
const EXCESS_NEWLINES_REGEX = /\n{3,}/g

const PLACEHOLDER_START = ''
const PLACEHOLDER_END = ''

function normalizeLinkFragment(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
}

function formatLink(text: string, url: string): string {
  const normalizedUrl = normalizeLinkFragment(url)
  const normalizedText = normalizeLinkFragment(text)

  if (normalizedUrl.includes(normalizedText)) {
    return url
  }

  return `${text} (${url})`
}

function extractPlaceholders(
  text: string,
  regex: RegExp,
  extract: (match: RegExpMatchArray) => string,
  kind: string,
): { text: string, values: string[] } {
  const values: string[] = []

  const replaced = text.replace(regex, (...groups) => {
    const match = groups.slice(0, -2) as unknown as RegExpMatchArray
    const index = values.length

    values.push(extract(match))

    return `${PLACEHOLDER_START}${kind}${index}${PLACEHOLDER_END}`
  })

  return { text: replaced, values }
}

function restorePlaceholders(
  text: string,
  values: string[],
  kind: string,
): string {
  const placeholderRegex = new RegExp(
    `${PLACEHOLDER_START}${kind}(\\d+)${PLACEHOLDER_END}`,
    'g',
  )

  return text.replace(placeholderRegex, (_match, index: string) => {
    return values[Number(index)] ?? ''
  })
}

function stripLineStructure(line: string): string {
  return line
    .replace(BLOCKQUOTE_PREFIX_REGEX, '')
    .replace(HEADING_REGEX, '')
}

export function markdownToPlainText(markdown: string): string {
  const { text: withoutFencedCode, values: fencedCodeBlocks }
    = extractPlaceholders(
      markdown,
      FENCED_CODE_BLOCK_REGEX,
      match => (match[1] ?? '').replace(/\n$/, ''),
      'F',
    )

  const { text: withoutInlineCode, values: inlineCodeSpans }
    = extractPlaceholders(
      withoutFencedCode,
      INLINE_CODE_REGEX,
      match => match[1] ?? '',
      'I',
    )

  const withoutStructure = withoutInlineCode
    .split('\n')
    .filter(line => !HORIZONTAL_RULE_REGEX.test(line.trim()))
    .map(stripLineStructure)
    .join('\n')

  const withoutImages = withoutStructure.replace(
    IMAGE_REGEX,
    (_match, _alt: string, url: string) => url,
  )

  const withoutLinks = withoutImages.replace(
    LINK_REGEX,
    (_match, text: string, url: string) => formatLink(text, url),
  )

  const withoutEmphasis = withoutLinks
    .replace(BOLD_ASTERISK_REGEX, '$1')
    .replace(BOLD_UNDERSCORE_REGEX, '$1')
    .replace(STRIKETHROUGH_REGEX, '$1')
    .replace(ITALIC_ASTERISK_REGEX, '$1')
    .replace(ITALIC_UNDERSCORE_REGEX, '$1')

  const withInlineCodeRestored = restorePlaceholders(
    withoutEmphasis,
    inlineCodeSpans,
    'I',
  )

  const withFencedCodeRestored = restorePlaceholders(
    withInlineCodeRestored,
    fencedCodeBlocks,
    'F',
  )

  return withFencedCodeRestored
    .replace(EXCESS_NEWLINES_REGEX, '\n\n')
    .trim()
}

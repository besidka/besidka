import { decodeMailHtmlEntities } from '~~/server/utils/google/html-entities'

export const MAIL_TEXT_MAX_CHARACTERS = 400_000

const TAG_MAX_CHARACTERS = 4000
const LINK_MAX_CHARACTERS = 300
const PART_DEPTH_MAX = 8
const PARTS_MAX = 60
const ATTACHMENT_NAME_MAX_CHARACTERS = 120
const MEDIA_TYPE_MAX_CHARACTERS = 80
const ENCODED_DATA_MAX_CHARACTERS = 3 * 1024 * 1024
const CHARSET_LABEL_MAX_CHARACTERS = 40
const QUOTED_NOTE = '[quoted text omitted]'

const CONTROL_PATTERN = /^\p{Cc}$/u
const FORMAT_PATTERN = /^\p{Cf}$/u
const SURROGATE_PATTERN = /^\p{Cs}$/u
const SEPARATOR_PATTERN = /^[\p{Zl}\p{Zp}]$/u
const ENCODED_WORD_PATTERN = /=\?([^?\s]{1,40})\?([BbQq])\?([^?\s]{0,200})\?=/g
const ENCODED_WORD_GAP_PATTERN = /(\?=)\s+(?==\?)/g
const HREF_PATTERN = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
const SAFE_LINK_PATTERN = /^(?:https?:\/\/|mailto:)/i
const TAG_START_PATTERN = /^[A-Za-z/!?]$/
const BASE64_PATTERN = /^[A-Za-z0-9+/]*$/
const TRAILING_PADDING_PATTERN = /=+$/
const UNSAFE_LABEL_CHARACTERS = /[^A-Za-z0-9._:-]/g
const BLOCKQUOTE_TAG_PATTERN = /<(\/?)blockquote(?![\w-])/gi

const SKIPPED_ELEMENTS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'head',
  'title',
  'template',
  'noscript',
  'svg',
])

const CLOSING_PATTERNS: ReadonlyMap<string, RegExp> = new Map(
  [...SKIPPED_ELEMENTS].map((name) => {
    return [name, new RegExp(`</${name}`, 'gi')]
  }),
)

const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  'br',
  'p',
  'div',
  'tr',
  'table',
  'ul',
  'ol',
  'hr',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
])

const CELL_ELEMENTS: ReadonlySet<string> = new Set(['td', 'th'])

export interface GmailAttachmentInfo {
  name: string
  mimeType: string
  size: number | null
}

export interface GmailMessageContent {
  text: string
  attachments: GmailAttachmentInfo[]
}

interface GmailHeader {
  name?: unknown
  value?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function clipCharacters(text: string, maxCharacters: number): string {
  const characters = Array.from(text)

  return characters.length <= maxCharacters
    ? text
    : `${characters.slice(0, maxCharacters - 1).join('')}…`
}

/**
 * Text from someone else's mail made safe for the model's frame and for
 * display: control characters (except line breaks), every invisible and
 * bidi format character (the zero width joiners included, so a look-alike
 * of the frame's closing tag cannot slip past `neutralizeFrameTags`), lone
 * surrogates and line or paragraph separators are removed, tabs become
 * spaces (or stay, with `keepTabs`, for file text such as TSV) and CR is
 * dropped. Nothing is repaired or reordered.
 */
export function sanitizeMailText(
  text: string,
  options: { keepTabs?: boolean } = {},
): string {
  let result = ''

  for (const character of text) {
    if (character === '\n') {
      result += '\n'
    } else if (character === '\t') {
      result += options.keepTabs ? '\t' : ' '
    } else if (SEPARATOR_PATTERN.test(character)) {
      result += '\n'
    } else if (
      CONTROL_PATTERN.test(character)
      || FORMAT_PATTERN.test(character)
      || SURROGATE_PATTERN.test(character)
    ) {
      continue
    } else {
      result += character
    }
  }

  return result
}

function collapseWhitespace(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * One header value (a sender, a subject, an attachment name) on one line,
 * sanitized and cut to `maxCharacters`.
 */
export function cleanMailField(value: unknown, maxCharacters: number): string {
  if (typeof value !== 'string') {
    return ''
  }

  return clipCharacters(
    sanitizeMailText(value).replace(/\s+/g, ' ').trim(),
    maxCharacters,
  )
}

/**
 * The visible line that stands in for text in a charset the runtime cannot
 * decode, so the model and the user never get silent mojibake. The label is
 * cut to the characters a charset name may hold.
 */
export function unsupportedEncodingNote(label: string): string {
  const safeLabel = label
    .replace(UNSAFE_LABEL_CHARACTERS, '')
    .slice(0, CHARSET_LABEL_MAX_CHARACTERS)

  return `[unsupported text encoding: ${safeLabel || 'unknown'}]`
}

function charsetLabelOf(value: string): string {
  return (value.split('*')[0] ?? '').trim()
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const label = charsetLabelOf(charset)

  try {
    return new TextDecoder(label).decode(bytes)
  } catch (exception) {
    if (!(exception instanceof RangeError)) {
      throw exception
    }

    return unsupportedEncodingNote(label)
  }
}

function decodeQuotedPrintableWord(value: string): Uint8Array {
  const bytes: number[] = []
  const text = value.replaceAll('_', ' ')

  for (let index = 0; index < text.length; index += 1) {
    const hex = text.slice(index + 1, index + 3)

    if (text[index] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16))
      index += 2
    } else {
      bytes.push(text.charCodeAt(index) & 0xFF)
    }
  }

  return Uint8Array.from(bytes)
}

/**
 * Base64 or base64url bytes, or null for anything `atob` would refuse: the
 * padding is removed first, the rest must be the alphabet only with a
 * length that a byte sequence can have, and the padding is added back.
 * Never throws, because headers and bodies come from other people.
 */
function decodeBase64Bytes(value: string): Uint8Array | null {
  const unpadded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .replace(TRAILING_PADDING_PATTERN, '')

  if (!BASE64_PATTERN.test(unpadded) || unpadded.length % 4 === 1) {
    return null
  }

  const padded = unpadded.padEnd(
    unpadded.length + (4 - unpadded.length % 4) % 4,
    '=',
  )

  return Uint8Array.from(atob(padded), character => character.charCodeAt(0))
}

/**
 * Decodes RFC 2047 encoded words in a header value. A value that holds none
 * is returned as it is, so a header Gmail already decoded is untouched. A
 * word in a charset the runtime cannot decode becomes the visible
 * `unsupportedEncodingNote`.
 */
export function decodeEncodedWords(value: string): string {
  return value
    .replace(ENCODED_WORD_GAP_PATTERN, '$1')
    .replace(ENCODED_WORD_PATTERN, (
      word,
      charset: string,
      encoding: string,
      data: string,
    ) => {
      const bytes = encoding.toUpperCase() === 'B'
        ? decodeBase64Bytes(data)
        : decodeQuotedPrintableWord(data)

      return bytes ? decodeBytes(bytes, charset) : word
    })
}

function charsetOf(contentType: string | null): string {
  const match = contentType?.match(/charset\s*=\s*"?([A-Za-z0-9._:-]{1,40})"?/i)

  return match?.[1] ?? 'utf-8'
}

export function decodeBodyData(
  data: string,
  contentType: string | null,
): string {
  if (data.length > ENCODED_DATA_MAX_CHARACTERS) {
    return ''
  }

  const bytes = decodeBase64Bytes(data)

  return bytes ? decodeBytes(bytes, charsetOf(contentType)) : ''
}

function readTagName(tag: string): string {
  const match = tag.match(/^\/?\s*([A-Za-z][A-Za-z0-9]*)/)

  return match?.[1]?.toLowerCase() ?? ''
}

function readSafeHref(tag: string): string | null {
  const match = tag.match(HREF_PATTERN)
  const href = decodeMailHtmlEntities(
    match?.[1] ?? match?.[2] ?? match?.[3] ?? '',
  ).trim()

  if (!href || href.length > LINK_MAX_CHARACTERS) {
    return null
  }

  return SAFE_LINK_PATTERN.test(href) && !/[\s<>"]/.test(href) ? href : null
}

/**
 * For every `<blockquote` in the markup, the index after the `>` of its
 * matching close tag, counting nested quotes, found in one pass with a
 * stack. A quote that never closes has no entry, so broken markup keeps its
 * text.
 */
function mapQuoteEnds(source: string): Map<number, number> {
  const ends = new Map<number, number>()
  const openers: number[] = []

  for (const match of source.matchAll(BLOCKQUOTE_TAG_PATTERN)) {
    if (!match[1]) {
      openers.push(match.index)

      continue
    }

    const opener = openers.pop()
    const close = source.indexOf('>', match.index)

    if (opener !== undefined && close !== -1) {
      ends.set(opener, close + 1)
    }
  }

  return ends
}

/**
 * HTML mail as plain text, in one linear pass with no DOM and no request:
 * `script`, `style`, `head` and similar elements are dropped with their
 * content, comments are dropped, a `blockquote` (a quoted earlier message)
 * becomes one note, block elements become line breaks and table cells are
 * spaced apart, links keep their address in brackets after the link text
 * (only `http`, `https` and `mailto`), images and everything else vanish,
 * and entities are decoded. A `<` that cannot start a tag is text. Nothing
 * in the markup is ever fetched or followed.
 */
export function htmlToPlainText(html: string): string {
  const source = html.slice(0, MAIL_TEXT_MAX_CHARACTERS)
  let output = ''
  let index = 0
  let linkHref: string | null = null
  let linkStart = 0
  let closePosition = -2
  let quoteEnds: Map<number, number> | null = null

  while (index < source.length) {
    const open = source.indexOf('<', index)

    if (open === -1) {
      output += decodeMailHtmlEntities(source.slice(index))

      break
    }

    output += decodeMailHtmlEntities(source.slice(index, open))

    if (!TAG_START_PATTERN.test(source[open + 1] ?? '')) {
      output += '<'
      index = open + 1

      continue
    }

    if (source.startsWith('<!--', open)) {
      const close = source.indexOf('-->', open + 4)

      index = close === -1 ? source.length : close + 3

      continue
    }

    if (closePosition !== -1 && closePosition <= open) {
      closePosition = source.indexOf('>', open + 1)
    }

    if (closePosition === -1) {
      output += decodeMailHtmlEntities(source.slice(open))

      break
    }

    const end = closePosition

    if (end - open > TAG_MAX_CHARACTERS) {
      index = open + 1

      continue
    }

    const tag = source.slice(open + 1, end)
    const name = readTagName(tag)
    const isClosing = tag.trimStart().startsWith('/')

    index = end + 1

    const closingPattern = CLOSING_PATTERNS.get(name)

    if (!isClosing && closingPattern && !tag.endsWith('/')) {
      closingPattern.lastIndex = index

      const closing = closingPattern.exec(source)
      const closeEnd = closing ? source.indexOf('>', closing.index) : -1

      index = closeEnd === -1 ? source.length : closeEnd + 1

      continue
    }

    if (name === 'blockquote') {
      quoteEnds ??= mapQuoteEnds(source)

      const quoteEnd = isClosing ? undefined : quoteEnds.get(open)

      if (quoteEnd !== undefined) {
        output += `\n${QUOTED_NOTE}\n`
        index = quoteEnd
      } else {
        output += '\n'
      }

      continue
    }

    if (name === 'a') {
      if (isClosing) {
        const text = linkHref ? output.slice(linkStart).trim() : ''

        if (linkHref && text && text !== linkHref) {
          output += ` (${linkHref})`
        }

        linkHref = null
      } else {
        linkHref = readSafeHref(source.slice(open, end + 1))
        linkStart = output.length
      }

      continue
    }

    if (name === 'li') {
      output += isClosing ? '' : '\n- '
    } else if (CELL_ELEMENTS.has(name)) {
      output += isClosing ? ' ' : ''
    } else if (BLOCK_ELEMENTS.has(name)) {
      output += '\n'
    }
  }

  return collapseWhitespace(sanitizeMailText(output))
}

/**
 * Lines that start with `>` are quoted earlier messages; each run of them
 * becomes one short note, so a long thread does not repeat itself. A run
 * right after a note `htmlToPlainText` left for a `blockquote` joins it.
 */
export function dropQuotedLines(text: string): string {
  const lines: string[] = []
  let isInQuote = false

  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('>') || line === QUOTED_NOTE) {
      if (!isInQuote) {
        lines.push(QUOTED_NOTE)
      }

      isInQuote = true

      continue
    }

    isInQuote = false
    lines.push(line)
  }

  return lines.join('\n')
}

export function readMailHeader(
  headers: unknown,
  name: string,
): string | null {
  if (!Array.isArray(headers)) {
    return null
  }

  const wanted = name.toLowerCase()
  const found = (headers as GmailHeader[]).find((header) => {
    return isRecord(header)
      && typeof header.name === 'string'
      && header.name.toLowerCase() === wanted
      && typeof header.value === 'string'
  })

  return typeof found?.value === 'string' ? found.value : null
}

interface WalkState {
  plain: string[]
  html: string[]
  attachments: GmailAttachmentInfo[]
  parts: number
}

function walkPart(part: unknown, depth: number, state: WalkState): void {
  if (!isRecord(part) || depth > PART_DEPTH_MAX || state.parts >= PARTS_MAX) {
    return
  }

  state.parts += 1

  const mimeType = typeof part.mimeType === 'string'
    ? part.mimeType.toLowerCase()
    : ''
  const body = isRecord(part.body) ? part.body : {}

  if (typeof part.filename === 'string' && part.filename) {
    state.attachments.push({
      name: cleanMailField(
        decodeEncodedWords(part.filename),
        ATTACHMENT_NAME_MAX_CHARACTERS,
      ),
      mimeType: cleanMailField(mimeType, MEDIA_TYPE_MAX_CHARACTERS),
      size: typeof body.size === 'number' ? body.size : null,
    })

    return
  }

  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      walkPart(child, depth + 1, state)
    }

    return
  }

  if (typeof body.data !== 'string') {
    return
  }

  const contentType = readMailHeader(part.headers, 'content-type')

  if (mimeType === 'text/plain') {
    state.plain.push(decodeBodyData(body.data, contentType))
  } else if (mimeType === 'text/html') {
    state.html.push(decodeBodyData(body.data, contentType))
  }
}

function plainTextOf(parts: readonly string[]): string {
  return collapseWhitespace(sanitizeMailText(
    parts.join('\n\n').slice(0, MAIL_TEXT_MAX_CHARACTERS),
  ))
}

/**
 * The readable text and the attachment list of one Gmail message payload:
 * the `text/plain` parts when they hold any text after cleaning, otherwise
 * the `text/html` parts converted to text. Plain text is cut to the same
 * length as HTML before it is cleaned. Attachments are listed by name, type
 * and size only; no attachment is ever downloaded.
 */
export function readMessageContent(payload: unknown): GmailMessageContent {
  const state: WalkState = { plain: [], html: [], attachments: [], parts: 0 }

  walkPart(payload, 0, state)

  const plain = plainTextOf(state.plain)
  const text = plain
    || state.html.map(htmlToPlainText).filter(Boolean).join('\n\n')

  return { text: dropQuotedLines(text), attachments: state.attachments }
}

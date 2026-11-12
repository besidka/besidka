export type XmlEvent
  = | {
    type: 'start'
    name: string
    attributes: Record<string, string>
    selfClosing: boolean
  }
  | { type: 'end', name: string }
  | { type: 'text', text: string }

export class XmlError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export interface ParseXmlOptions {
  keepAttributePrefixes?: boolean
}

const ENTITY_PATTERN = /&(#x[0-9a-fA-F]{1,8}|#\d{1,9}|lt|gt|amp|quot|apos);/g
const WHITESPACE = new Set([' ', '\t', '\n', '\r'])
const MAX_CODE_POINT = 0x10FFFF

function replaceEntity(_match: string, body: string): string {
  switch (body) {
    case 'lt':
      return '<'
    case 'gt':
      return '>'
    case 'amp':
      return '&'
    case 'quot':
      return '"'
    case 'apos':
      return '\''
  }

  const codePoint = body.startsWith('#x')
    ? Number.parseInt(body.slice(2), 16)
    : Number.parseInt(body.slice(1), 10)
  const isSurrogate = codePoint >= 0xD800 && codePoint <= 0xDFFF

  if (codePoint > MAX_CODE_POINT || isSurrogate || codePoint === 0) {
    return '�'
  }

  return String.fromCodePoint(codePoint)
}

/**
 * Decodes the five predefined and numeric character references in one pass,
 * so `&#x26;#65;` stays `&#65;` and an out-of-range reference never throws.
 */
export function unescapeXml(value: string): string {
  return value.includes('&')
    ? value.replace(ENTITY_PATTERN, replaceEntity)
    : value
}

export function stripXmlComments(text: string): string {
  let result = ''
  let cursor = 0

  while (cursor < text.length) {
    const start = text.indexOf('<!--', cursor)

    if (start === -1) {
      result += text.slice(cursor)
      break
    }

    result += text.slice(cursor, start)

    const end = text.indexOf('-->', start + 4)

    if (end === -1) {
      break
    }

    cursor = end + 3
  }

  return result
}

function localName(qualified: string): string {
  const colon = qualified.indexOf(':')

  return colon === -1 ? qualified : qualified.slice(colon + 1)
}

/**
 * Decodes an XML part. Only UTF-8 and BOM-marked UTF-16 are read: NUL bytes
 * without a BOM, invalid UTF-8 and a declaration that disagrees with the
 * bytes are refused, because every check after this works on the decoded
 * text and a different encoding would hide content from it.
 */
export function decodeXmlBytes(data: Uint8Array): string {
  if (data[0] === 0xFF && data[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(data.subarray(2))
  }

  if (data[0] === 0xFE && data[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(data.subarray(2))
  }

  if (data.includes(0)) {
    throw new XmlError('xml_encoding', 'XML part contains NUL bytes')
  }

  let text: string

  try {
    text = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: false,
    }).decode(data)
  } catch {
    throw new XmlError('xml_encoding', 'XML part is not valid UTF-8')
  }

  const declaration = /^\u{FEFF}?<\?xml[^>]{0,200}?encoding\s*=\s*["']([^"']+)["']/u
    .exec(text)

  if (declaration && !/^utf-?8$/i.test(declaration[1] as string)) {
    throw new XmlError('xml_encoding', 'XML part declares a non UTF-8 encoding')
  }

  return text.startsWith('\u{FEFF}') ? text.slice(1) : text
}

/**
 * Linear, quote-aware XML tokenizer: no regular expression runs over the
 * document, a `>` inside an attribute value cannot end a tag early, comments
 * and processing instructions are skipped, CDATA is delivered as text and any
 * DTD or entity declaration is refused. Namespace prefixes are dropped from
 * element names and, unless `keepAttributePrefixes` is set, from attribute
 * names too; without it `id` and `r:id` on one element collide.
 */
export function* parseXml(
  text: string,
  options: ParseXmlOptions = {},
): Generator<XmlEvent> {
  let position = 0

  while (position < text.length) {
    const open = text.indexOf('<', position)

    if (open === -1) {
      yield { type: 'text', text: unescapeXml(text.slice(position)) }
      return
    }

    if (open > position) {
      yield { type: 'text', text: unescapeXml(text.slice(position, open)) }
    }

    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4)

      if (end === -1) {
        throw new XmlError('xml_malformed', 'Unterminated comment')
      }

      position = end + 3
      continue
    }

    if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9)

      if (end === -1) {
        throw new XmlError('xml_malformed', 'Unterminated CDATA section')
      }

      yield { type: 'text', text: text.slice(open + 9, end) }
      position = end + 3
      continue
    }

    if (text.startsWith('<?', open)) {
      const end = text.indexOf('?>', open + 2)

      if (end === -1) {
        throw new XmlError('xml_malformed', 'Unterminated instruction')
      }

      position = end + 2
      continue
    }

    if (text.startsWith('<!', open)) {
      throw new XmlError('xml_doctype', 'DOCTYPE or ENTITY declaration')
    }

    if (text[open + 1] === '/') {
      const end = text.indexOf('>', open + 2)

      if (end === -1) {
        throw new XmlError('xml_malformed', 'Unterminated end tag')
      }

      yield { type: 'end', name: localName(text.slice(open + 2, end).trim()) }
      position = end + 1
      continue
    }

    let cursor = open + 1

    while (
      cursor < text.length
      && !WHITESPACE.has(text[cursor] as string)
      && text[cursor] !== '>'
      && text[cursor] !== '/'
    ) {
      cursor += 1
    }

    const name = localName(text.slice(open + 1, cursor))
    const attributes: Record<string, string> = {}
    let selfClosing = false

    for (;;) {
      while (cursor < text.length && WHITESPACE.has(text[cursor] as string)) {
        cursor += 1
      }

      const character = text[cursor]

      if (character === undefined) {
        throw new XmlError('xml_malformed', 'Unterminated start tag')
      }

      if (character === '>') {
        cursor += 1
        break
      }

      if (character === '/') {
        if (text[cursor + 1] !== '>') {
          throw new XmlError('xml_malformed', 'Stray slash in a tag')
        }

        selfClosing = true
        cursor += 2
        break
      }

      const nameStart = cursor

      while (
        cursor < text.length
        && text[cursor] !== '='
        && !WHITESPACE.has(text[cursor] as string)
        && text[cursor] !== '>'
        && text[cursor] !== '/'
      ) {
        cursor += 1
      }

      const attributeName = text.slice(nameStart, cursor)

      while (cursor < text.length && WHITESPACE.has(text[cursor] as string)) {
        cursor += 1
      }

      if (text[cursor] !== '=') {
        throw new XmlError('xml_malformed', 'Attribute without a value')
      }

      cursor += 1

      while (cursor < text.length && WHITESPACE.has(text[cursor] as string)) {
        cursor += 1
      }

      const quote = text[cursor]

      if (quote !== '"' && quote !== '\'') {
        throw new XmlError('xml_malformed', 'Unquoted attribute value')
      }

      const valueEnd = text.indexOf(quote, cursor + 1)

      if (valueEnd === -1) {
        throw new XmlError('xml_malformed', 'Unterminated attribute value')
      }

      if (attributeName !== 'xmlns' && !attributeName.startsWith('xmlns:')) {
        const attributeKey = options.keepAttributePrefixes
          ? attributeName
          : localName(attributeName)

        attributes[attributeKey] = unescapeXml(
          text.slice(cursor + 1, valueEnd),
        )
      }

      cursor = valueEnd + 1
    }

    yield { type: 'start', name, attributes, selfClosing }

    if (selfClosing) {
      yield { type: 'end', name }
    }

    position = cursor
  }
}

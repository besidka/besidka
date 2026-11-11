import { readXmpProvenance } from '../provenance.ts'
import type { Provenance } from '../provenance.ts'
import { inflateZlibCapped } from './inflate.ts'
import { fail } from './result.ts'
import type { ValidationFailure } from './result.ts'
import {
  ALLOWED_LINK_PROTOCOLS,
  PDF_DENIED_NAMES,
  VALIDATION_LIMITS,
} from './rules.ts'

export interface PdfScanResult {
  pages: number
  provenance: Provenance
}

type TokenKind = 'name' | 'string' | 'number' | 'keyword' | 'delimiter'

interface Token {
  kind: TokenKind
  value: string
}

const WHITESPACE = new Set([0x00, 0x09, 0x0A, 0x0C, 0x0D, 0x20])
const DELIMITERS = new Set([
  0x28, 0x29, 0x3C, 0x3E, 0x5B, 0x5D, 0x7B, 0x7D, 0x2F, 0x25,
])
const textEncoder = new TextEncoder()
const ENDSTREAM_KEYWORD = textEncoder.encode('endstream')
const PROVENANCE_RANK: Record<Provenance, number> = {
  'missing': 0,
  'channel-only': 1,
  'ai': 2,
}

class PdfScanError extends Error {
  constructor(public readonly failure: ValidationFailure) {
    super(failure.detail)
  }
}

function isWhitespace(byte: number): boolean {
  return WHITESPACE.has(byte)
}

function isRegular(byte: number): boolean {
  return !WHITESPACE.has(byte) && !DELIMITERS.has(byte)
}

function indexOfBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
  from: number,
): number {
  const limit = haystack.length - needle.length

  outer: for (let start = from; start <= limit; start += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) {
        continue outer
      }
    }

    return start
  }

  return -1
}

function decodeName(raw: string): string {
  return raw.replace(/#([0-9A-Fa-f]{2})/g, (_match, hex: string) => {
    return String.fromCharCode(Number.parseInt(hex, 16))
  })
}

function decodePdfString(bytes: number[]): string {
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
    let text = ''

    for (let index = 2; index + 1 < bytes.length; index += 2) {
      text += String.fromCharCode(
        ((bytes[index] as number) << 8) | (bytes[index + 1] as number),
      )
    }

    return text
  }

  return String.fromCharCode(...bytes)
}

function readLiteralString(
  data: Uint8Array,
  start: number,
): { value: string, end: number } {
  const bytes: number[] = []
  let depth = 1
  let index = start + 1

  while (index < data.length && depth > 0) {
    const byte = data[index] as number

    if (byte === 0x5C) {
      const next = data[index + 1] as number

      index += 2

      if (next === 0x6E) {
        bytes.push(0x0A)
      } else if (next === 0x72) {
        bytes.push(0x0D)
      } else if (next === 0x74) {
        bytes.push(0x09)
      } else if (next === 0x62) {
        bytes.push(0x08)
      } else if (next === 0x66) {
        bytes.push(0x0C)
      } else if (next >= 0x30 && next <= 0x37) {
        let octal = next - 0x30
        let digits = 1

        while (
          digits < 3
          && (data[index] as number) >= 0x30
          && (data[index] as number) <= 0x37
        ) {
          octal = octal * 8 + ((data[index] as number) - 0x30)
          index += 1
          digits += 1
        }

        bytes.push(octal & 0xFF)
      } else if (next === 0x0D) {
        if (data[index] === 0x0A) {
          index += 1
        }
      } else if (next !== 0x0A) {
        bytes.push(next)
      }

      continue
    }

    if (byte === 0x28) {
      depth += 1
    } else if (byte === 0x29) {
      depth -= 1

      if (depth === 0) {
        index += 1
        break
      }
    }

    bytes.push(byte)
    index += 1
  }

  return { value: decodePdfString(bytes), end: index }
}

function readHexString(
  data: Uint8Array,
  start: number,
): { value: string, end: number } {
  const bytes: number[] = []
  let high = -1
  let index = start + 1

  while (index < data.length && data[index] !== 0x3E) {
    const byte = data[index] as number
    let nibble = -1

    if (byte >= 0x30 && byte <= 0x39) {
      nibble = byte - 0x30
    } else if (byte >= 0x41 && byte <= 0x46) {
      nibble = byte - 0x41 + 10
    } else if (byte >= 0x61 && byte <= 0x66) {
      nibble = byte - 0x61 + 10
    }

    if (nibble >= 0) {
      if (high < 0) {
        high = nibble
      } else {
        bytes.push(high * 16 + nibble)
        high = -1
      }
    }

    index += 1
  }

  if (high >= 0) {
    bytes.push(high * 16)
  }

  return { value: decodePdfString(bytes), end: index + 1 }
}

/**
 * Lexes a PDF fragment into names, strings, numbers and keywords. Stream
 * bodies are not part of the token stream: `onStream` receives the object's
 * tokens and the raw stream bytes so object streams can be decoded and fed
 * back in. Names are decoded (`/J#53` is `/JS`), which is what a byte grep
 * cannot do.
 */
function scanTokens(
  data: Uint8Array,
  budget: { tokens: number },
  onToken: (token: Token) => void,
  onStream?: (objectTokens: Token[], body: Uint8Array) => void,
): void {
  let index = 0
  let objectTokens: Token[] = []

  const emit = (token: Token) => {
    budget.tokens -= 1

    if (budget.tokens < 0) {
      throw new PdfScanError(
        fail('pdf_malformed', 'PDF has too many tokens'),
      )
    }

    objectTokens.push(token)
    onToken(token)
  }

  while (index < data.length) {
    const byte = data[index] as number

    if (isWhitespace(byte)) {
      index += 1
      continue
    }

    if (byte === 0x25) {
      while (
        index < data.length
        && data[index] !== 0x0A
        && data[index] !== 0x0D
      ) {
        index += 1
      }

      continue
    }

    if (byte === 0x2F) {
      let end = index + 1

      while (end < data.length && isRegular(data[end] as number)) {
        end += 1
      }

      let raw = ''

      for (let cursor = index + 1; cursor < end; cursor += 1) {
        raw += String.fromCharCode(data[cursor] as number)
      }

      emit({ kind: 'name', value: decodeName(raw) })
      index = end
      continue
    }

    if (byte === 0x28) {
      const parsed = readLiteralString(data, index)

      emit({ kind: 'string', value: parsed.value })
      index = parsed.end
      continue
    }

    if (byte === 0x3C && data[index + 1] !== 0x3C) {
      const parsed = readHexString(data, index)

      emit({ kind: 'string', value: parsed.value })
      index = parsed.end
      continue
    }

    if (
      byte === 0x3C
      || byte === 0x3E
      || byte === 0x5B
      || byte === 0x5D
      || byte === 0x7B
      || byte === 0x7D
      || byte === 0x29
    ) {
      const isDouble = (byte === 0x3C || byte === 0x3E)
        && data[index + 1] === byte

      emit({
        kind: 'delimiter',
        value: String.fromCharCode(byte).repeat(isDouble ? 2 : 1),
      })
      index += isDouble ? 2 : 1
      continue
    }

    let end = index

    while (end < data.length && isRegular(data[end] as number)) {
      end += 1
    }

    let word = ''

    for (let cursor = index; cursor < end; cursor += 1) {
      word += String.fromCharCode(data[cursor] as number)
    }

    index = end

    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(word)) {
      emit({ kind: 'number', value: word })
      continue
    }

    if (word === 'obj') {
      objectTokens = []
      emit({ kind: 'keyword', value: word })
      continue
    }

    if (word === 'stream' && onStream) {
      let bodyStart = index

      if (data[bodyStart] === 0x0D && data[bodyStart + 1] === 0x0A) {
        bodyStart += 2
      } else if (data[bodyStart] === 0x0A || data[bodyStart] === 0x0D) {
        bodyStart += 1
      }

      const bodyEnd = indexOfBytes(data, ENDSTREAM_KEYWORD, bodyStart)

      if (bodyEnd === -1) {
        throw new PdfScanError(
          fail('pdf_malformed', 'Stream without endstream'),
        )
      }

      onStream(objectTokens, data.subarray(bodyStart, bodyEnd))
      index = bodyEnd + ENDSTREAM_KEYWORD.length
      objectTokens = []
      continue
    }

    emit({ kind: 'keyword', value: word })
  }
}

function checkUriString(value: string): void {
  const normalized = value.trim().toLowerCase()
  const isAllowed = ALLOWED_LINK_PROTOCOLS.some((protocol) => {
    return normalized.startsWith(protocol)
  })

  if (!isAllowed) {
    throw new PdfScanError(
      fail('pdf_uri_scheme', `URI action scheme is not allowed: ${normalized.slice(0, 40)}`),
    )
  }
}

function dictionaryValue(tokens: Token[], key: string): Token | null {
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index] as Token

    if (token.kind === 'name' && token.value === key) {
      return tokens[index + 1] as Token
    }
  }

  return null
}

function listFilters(tokens: Token[]): string[] | null {
  const filterIndex = tokens.findIndex((token) => {
    return token.kind === 'name' && token.value === 'Filter'
  })

  if (filterIndex === -1) {
    return []
  }

  const first = tokens[filterIndex + 1]

  if (first?.kind === 'name') {
    return [first.value]
  }

  if (first?.kind === 'delimiter' && first.value === '[') {
    const filters: string[] = []

    for (let index = filterIndex + 2; index < tokens.length; index += 1) {
      const token = tokens[index] as Token

      if (token.kind === 'delimiter' && token.value === ']') {
        return filters
      }

      if (token.kind !== 'name') {
        return null
      }

      filters.push(token.value)
    }
  }

  return null
}

function decodeStreamBody(
  objectTokens: Token[],
  body: Uint8Array,
  budget: { inflateBytes: number },
): Uint8Array {
  const filters = listFilters(objectTokens)

  if (filters === null) {
    throw new PdfScanError(
      fail('pdf_unsupported_filter', 'Unreadable /Filter entry'),
    )
  }

  const supported = filters.every((filter) => {
    return filter === 'FlateDecode' || filter === 'Fl'
  })

  if (filters.length > 1 || !supported) {
    throw new PdfScanError(
      fail(
        'pdf_unsupported_filter',
        `Unsupported filter chain: ${filters.join(',').slice(0, 60)}`,
      ),
    )
  }

  if (filters.length === 0) {
    return body
  }

  const inflated = inflateZlibCapped(body, budget.inflateBytes)

  if (!inflated.ok) {
    throw new PdfScanError(fail(inflated.code, inflated.detail))
  }

  budget.inflateBytes -= inflated.data.length

  return inflated.data
}

function tokenKindOfStream(objectTokens: Token[]): string | null {
  const type = dictionaryValue(objectTokens, 'Type')

  return type?.kind === 'name' ? type.value : null
}

/**
 * Structural validation for PDFs. Besidka-made files and provider-made files
 * (D-7, D-8) go through the same path: every object is tokenised, object
 * streams are inflated under a byte cap and scanned too, and denied names are
 * matched after `#xx` decoding, so names hidden inside compressed object
 * streams are found where a byte grep sees nothing.
 */
export function scanPdf(
  bytes: Uint8Array,
): { ok: true, result: PdfScanResult } | ValidationFailure {
  const hasHeader = bytes.length >= 8
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2D
    && (bytes[5] === 0x31 || bytes[5] === 0x32)
    && bytes[6] === 0x2E

  if (!hasHeader) {
    return fail('pdf_header', 'Missing %PDF-1. or %PDF-2. header')
  }

  const tail = bytes.subarray(
    Math.max(0, bytes.length - VALIDATION_LIMITS.pdfEofWindowBytes),
  )

  if (indexOfBytes(tail, textEncoder.encode('%%EOF'), 0) === -1) {
    return fail('pdf_truncated', 'No %%EOF in the last 1024 bytes')
  }

  const budget = {
    tokens: VALIDATION_LIMITS.pdfTokensMax,
    inflateBytes: VALIDATION_LIMITS.pdfInflateBytesMax,
  }
  let pages = 0
  let provenance: Provenance = 'missing'

  const pageState = { previous: null as Token | null }

  const onToken = (token: Token) => {
    if (token.kind === 'name') {
      const code = PDF_DENIED_NAMES[token.value]

      if (code) {
        throw new PdfScanError(
          fail(code, `Name /${token.value} is not allowed`),
        )
      }

      if (
        token.value === 'Page'
        && pageState.previous?.kind === 'name'
        && pageState.previous.value === 'Type'
      ) {
        pages += 1
      }
    }

    if (
      token.kind === 'string'
      && pageState.previous?.kind === 'name'
      && pageState.previous.value === 'URI'
    ) {
      checkUriString(token.value)
    }

    if (
      token.kind === 'number'
      && pageState.previous?.kind === 'name'
      && pageState.previous.value === 'URI'
    ) {
      throw new PdfScanError(
        fail('pdf_uri_scheme', 'Indirect URI values are not allowed'),
      )
    }

    pageState.previous = token
  }

  const onStream = (objectTokens: Token[], body: Uint8Array) => {
    const kind = tokenKindOfStream(objectTokens)

    if (kind === 'ObjStm') {
      const decoded = decodeStreamBody(objectTokens, body, budget)
      const outerPrevious = pageState.previous

      pageState.previous = null
      scanTokens(decoded, budget, onToken)
      pageState.previous = outerPrevious

      return
    }

    if (kind === 'Metadata') {
      const decoded = decodeStreamBody(objectTokens, body, budget)

      if (decoded.length <= VALIDATION_LIMITS.xmpBytesMax) {
        const found = readXmpProvenance(new TextDecoder('utf-8').decode(decoded))

        if (PROVENANCE_RANK[found] > PROVENANCE_RANK[provenance]) {
          provenance = found
        }
      }
    }
  }

  try {
    scanTokens(bytes, budget, onToken, onStream)
  } catch (exception) {
    if (exception instanceof PdfScanError) {
      return exception.failure
    }

    return fail('pdf_malformed', 'PDF could not be parsed')
  }

  if (pages === 0) {
    return fail('pdf_malformed', 'PDF has no pages')
  }

  if (pages > VALIDATION_LIMITS.pdfPagesMax) {
    return fail(
      'pdf_too_many_pages',
      `${pages} pages, limit ${VALIDATION_LIMITS.pdfPagesMax}`,
    )
  }

  return { ok: true, result: { pages, provenance } }
}

export type RangeParsed = {
  offset: number
  length: number
  end: number
}

export type RangeParseResult = RangeParsed | 'invalid' | null

export type RangeSpec
  = | { kind: 'suffix', suffix: number }
    | { kind: 'bounded', start: number, end: number | null }

export type RangeSpecResult = RangeSpec | 'invalid' | null

/**
 * Parse the syntax of a single-range `Range: bytes=...` header without knowing
 * the object size. Returns null when no header is present and 'invalid' for
 * malformed, multi-range, start > end and zero-length suffix specs.
 */
export function parseRangeSpec(
  rangeHeader: string | null | undefined,
): RangeSpecResult {
  if (!rangeHeader) {
    return null
  }

  const match = /^bytes=(.+)$/.exec(rangeHeader)

  if (!match) {
    return 'invalid'
  }

  const spec = match[1]!
  const suffixMatch = /^-(\d+)$/.exec(spec)

  if (suffixMatch) {
    const suffix = parseInt(suffixMatch[1]!, 10)

    if (suffix <= 0) {
      return 'invalid'
    }

    return { kind: 'suffix', suffix }
  }

  const rangeMatch = /^(\d+)-(\d*)$/.exec(spec)

  if (!rangeMatch) {
    return 'invalid'
  }

  const start = parseInt(rangeMatch[1]!, 10)
  const endText = rangeMatch[2]!
  const end = endText === '' ? null : parseInt(endText, 10)

  if (end !== null && start > end) {
    return 'invalid'
  }

  return { kind: 'bounded', start, end }
}

/**
 * Resolve a Range header against the object size per RFC 9110: an end past
 * EOF is clamped to the last byte; the range is unsatisfiable only when its
 * start is at or beyond the size. Suffix ranges larger than the object cover
 * the whole object.
 */
export function parseRangeHeader(
  rangeHeader: string | null | undefined,
  size: number,
): RangeParseResult {
  const spec = parseRangeSpec(rangeHeader)

  if (spec === null || spec === 'invalid') {
    return spec
  }

  if (spec.kind === 'suffix') {
    const offset = Math.max(0, size - spec.suffix)
    const end = size - 1
    const length = end - offset + 1

    return { offset, length, end }
  }

  if (spec.start >= size) {
    return 'invalid'
  }

  const end = Math.min(spec.end ?? size - 1, size - 1)
  const length = end - spec.start + 1

  return { offset: spec.start, length, end }
}

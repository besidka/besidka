export type RangeParsed = {
  offset: number
  length: number
  end: number
}

export type RangeParseResult = RangeParsed | 'invalid' | null

export function parseRangeHeader(
  rangeHeader: string | null | undefined,
  size: number,
): RangeParseResult {
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

    const offset = Math.max(0, size - suffix)
    const end = size - 1
    const length = end - offset + 1

    return { offset, length, end }
  }

  const rangeMatch = /^(\d+)-(\d*)$/.exec(spec)

  if (!rangeMatch) {
    return 'invalid'
  }

  const start = parseInt(rangeMatch[1]!, 10)
  const endStr = rangeMatch[2]!
  const end = endStr === '' ? size - 1 : parseInt(endStr, 10)

  if (start > end || end >= size || start < 0) {
    return 'invalid'
  }

  const length = end - start + 1

  return { offset: start, length, end }
}

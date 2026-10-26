export type MemoryInstructDiffLineType = 'same' | 'added' | 'removed'

export interface MemoryInstructDiffLine {
  type: MemoryInstructDiffLineType
  text: string
}

function splitLines(text: string): string[] {
  return text.split('\n').filter(line => line.trim() !== '')
}

function buildCommonLengths(before: string[], after: string[]): number[][] {
  const lengths = Array.from({ length: before.length + 1 }, () => {
    return new Array<number>(after.length + 1).fill(0)
  })

  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex--) {
    const row = lengths[beforeIndex]!
    const nextRow = lengths[beforeIndex + 1]!

    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex--) {
      row[afterIndex] = before[beforeIndex] === after[afterIndex]
        ? nextRow[afterIndex + 1]! + 1
        : Math.max(nextRow[afterIndex]!, row[afterIndex + 1]!)
    }
  }

  return lengths
}

/**
 * Line diff of two memory bodies (longest common subsequence over non-blank
 * lines), in reading order: removed lines appear before the lines that
 * replace them. Bodies are capped at a few kilobytes, so the quadratic table
 * stays small.
 */
export function diffMemoryInstructLines(
  beforeText: string,
  afterText: string,
): MemoryInstructDiffLine[] {
  const before = splitLines(beforeText)
  const after = splitLines(afterText)
  const lengths = buildCommonLengths(before, after)
  const lines: MemoryInstructDiffLine[] = []
  let beforeIndex = 0
  let afterIndex = 0

  while (beforeIndex < before.length && afterIndex < after.length) {
    if (before[beforeIndex] === after[afterIndex]) {
      lines.push({ type: 'same', text: before[beforeIndex]! })
      beforeIndex += 1
      afterIndex += 1

      continue
    }

    const keepsMoreByRemoving = lengths[beforeIndex + 1]![afterIndex]!
      >= lengths[beforeIndex]![afterIndex + 1]!

    if (keepsMoreByRemoving) {
      lines.push({ type: 'removed', text: before[beforeIndex]! })
      beforeIndex += 1

      continue
    }

    lines.push({ type: 'added', text: after[afterIndex]! })
    afterIndex += 1
  }

  for (; beforeIndex < before.length; beforeIndex++) {
    lines.push({ type: 'removed', text: before[beforeIndex]! })
  }

  for (; afterIndex < after.length; afterIndex++) {
    lines.push({ type: 'added', text: after[afterIndex]! })
  }

  return lines
}

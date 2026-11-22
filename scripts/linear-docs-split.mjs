export const LINEAR_CONTENT_LIMIT = 250_000
export const MAX_DOCUMENT_CHARACTERS = 240_000

const FENCE_PATTERN = /^\s*(```|~~~)/
const HEADING_PATTERN = /^(#{1,6})\s/

/**
 * Splits Markdown into consecutive blocks that start at headings of the
 * given level, ignoring heading-like lines inside fenced code blocks. Text
 * before the first heading becomes its own leading block.
 */
export function splitAtHeadings(markdown, level) {
  const lines = markdown.split('\n')
  const blocks = []
  let current = []
  let fence = null

  for (const line of lines) {
    const fenceMatch = line.match(FENCE_PATTERN)

    if (fenceMatch) {
      if (!fence) {
        fence = fenceMatch[1]
      } else if (fenceMatch[1] === fence) {
        fence = null
      }
    }

    const isCode = Boolean(fence || fenceMatch)
    const headingLength = isCode
      ? null
      : line.match(HEADING_PATTERN)?.[1].length
    const startsBlock = headingLength === level

    if (startsBlock && current.length) {
      blocks.push(current.join('\n'))
      current = []
    }

    current.push(line)
  }

  if (current.length) {
    blocks.push(current.join('\n'))
  }

  return blocks
}

/**
 * Returns the shallowest heading level (2 to 6) used outside code fences, or
 * null when the Markdown has no such heading.
 */
export function topHeadingLevel(markdown) {
  let fence = null
  let level = null

  for (const line of markdown.split('\n')) {
    const fenceMatch = line.match(FENCE_PATTERN)

    if (fenceMatch) {
      if (!fence) {
        fence = fenceMatch[1]
      } else if (fenceMatch[1] === fence) {
        fence = null
      }

      continue
    }

    if (fence) {
      continue
    }

    const headingLength = line.match(HEADING_PATTERN)?.[1].length

    if (headingLength && headingLength >= 2) {
      level = level === null ? headingLength : Math.min(level, headingLength)
    }
  }

  return level
}

function lineUnits(block) {
  const units = []
  let fenceLines = null
  let fence = null

  for (const line of block.split('\n')) {
    const fenceMatch = line.match(FENCE_PATTERN)

    if (fence) {
      fenceLines.push(line)

      if (fenceMatch?.[1] === fence) {
        units.push(fenceLines.join('\n'))
        fence = null
        fenceLines = null
      }

      continue
    }

    if (fenceMatch) {
      fence = fenceMatch[1]
      fenceLines = [line]

      continue
    }

    units.push(line)
  }

  if (fenceLines) {
    units.push(fenceLines.join('\n'))
  }

  return units
}

function cutLine(line, maxCharacters) {
  const pieces = []
  let rest = line

  while (rest.length > maxCharacters) {
    pieces.push(rest.slice(0, maxCharacters))
    rest = rest.slice(maxCharacters)
  }

  pieces.push(rest)

  return pieces
}

function packUnits(units, maxCharacters) {
  const pieces = []
  let current = null

  for (const unit of units) {
    const candidate = current === null ? unit : `${current}\n${unit}`

    if (candidate.length <= maxCharacters) {
      current = candidate

      continue
    }

    if (current !== null) {
      pieces.push(current)
    }

    if (unit.length <= maxCharacters) {
      current = unit

      continue
    }

    const lines = unit.includes('\n')
      ? unit.split('\n')
      : cutLine(unit, maxCharacters)
    const unitPieces = unit.includes('\n')
      ? packUnits(lines, maxCharacters)
      : lines

    pieces.push(...unitPieces.slice(0, -1))
    current = unitPieces.at(-1)
  }

  if (current !== null) {
    pieces.push(current)
  }

  return pieces
}

function splitByLines(block, maxCharacters) {
  return packUnits(lineUnits(block), maxCharacters)
}

function splitOversizedBlock(block, maxCharacters) {
  const level = topHeadingLevel(block.split('\n').slice(1).join('\n'))

  if (level !== null) {
    const subBlocks = splitAtHeadings(block, level)

    if (subBlocks.length > 1) {
      return packBlocks(subBlocks, maxCharacters)
    }
  }

  return splitByLines(block, maxCharacters)
}

function packBlocks(blocks, maxCharacters) {
  const chunks = []
  let current = ''

  for (const block of blocks) {
    const pieces = block.length > maxCharacters
      ? splitOversizedBlock(block, maxCharacters)
      : [block]

    for (const piece of pieces) {
      const candidate = current ? `${current}\n${piece}` : piece

      if (candidate.length <= maxCharacters) {
        current = candidate

        continue
      }

      if (current) {
        chunks.push(current)
      }

      current = piece
    }
  }

  if (current) {
    chunks.push(current)
  }

  return chunks
}

/**
 * Splits a Markdown body into chunks of at most `maxCharacters`, cutting at
 * the top-level headings first, then at deeper headings inside a section that
 * is still too long, then at line boundaries. Joining the chunks with a
 * newline gives back the original body.
 */
export function splitMarkdown(markdown, maxCharacters) {
  if (markdown.length <= maxCharacters) {
    return [markdown]
  }

  const level = topHeadingLevel(markdown)
  const blocks = level === null ? [markdown] : splitAtHeadings(markdown, level)

  return packBlocks(blocks, maxCharacters)
}

export function partTitle(title, index, count) {
  return count > 1 ? `${title} (part ${index + 1} of ${count})` : title
}

/**
 * Normalizes a document map entry: a single Linear document id (string) for a
 * doc that fits in one document, or an ordered array of ids, one per part.
 */
export function documentIds(entry) {
  if (!entry) {
    return []
  }

  return Array.isArray(entry) ? [...entry] : [entry]
}

export function storeDocumentIds(ids) {
  if (!ids.length) {
    return undefined
  }

  return ids.length === 1 ? ids[0] : [...ids]
}

/**
 * Matches the existing ids of a doc to `partCount` parts: part N keeps the
 * Nth id (so part 1 keeps the document a single-document doc already had),
 * parts without an id are created, and ids beyond the new part count are
 * returned for deletion.
 */
export function planDocumentParts(entry, partCount) {
  const ids = documentIds(entry)

  return {
    ids: Array.from({ length: partCount }, (_value, index) => {
      return ids[index] ?? null
    }),
    removed: ids.slice(partCount),
  }
}

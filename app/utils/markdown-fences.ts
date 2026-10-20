const FENCE_LINE_PATTERN: RegExp
  = /^((?:[ \t]*>)*)([ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?)(`{3,}|~{3,})(.*)$/

interface OpenFence {
  character: string
  length: number
  indent: number
  isTargetLanguage: boolean
  lines: string[]
}

function getInfoLanguage(info: string): string {
  return info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

function stripQuotePrefix(line: string): string {
  return line.replace(/^(?:[ \t]*>)*/, '')
}

function isClosingFence(line: string, fence: OpenFence): boolean {
  const match = stripQuotePrefix(line).match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/)

  if (!match) {
    return false
  }

  const marker = match[1]!

  return marker.startsWith(fence.character)
    && marker.length >= fence.length
}

function stripContentIndent(line: string, indent: number): string {
  const unquoted = stripQuotePrefix(line)
  const leadingSpaces = unquoted.match(/^[ \t]*/)![0].length

  return unquoted.slice(Math.min(leadingSpaces, indent))
}

function openFence(line: string, language: string): OpenFence | null {
  const match = line.match(FENCE_LINE_PATTERN)

  if (!match) {
    return null
  }

  const marker = match[3]!
  const info = match[4]!

  if (marker.startsWith('`') && info.includes('`')) {
    return null
  }

  return {
    character: marker[0]!,
    length: marker.length,
    indent: match[2]!.length,
    isTargetLanguage: getInfoLanguage(info) === language.toLowerCase(),
    lines: [],
  }
}

/**
 * Returns the content of every properly closed fenced block whose info
 * string starts with `language`. Blocks of other languages are opaque, so
 * a fence nested inside them is never counted.
 */
export function getClosedFencedBlocks(
  markdown: string,
  language: string,
): string[] {
  const blocks: string[] = []
  let current: OpenFence | null = null

  for (const line of markdown.split(/\r?\n/)) {
    if (!current) {
      current = openFence(line, language)

      continue
    }

    if (isClosingFence(line, current)) {
      if (current.isTargetLanguage) {
        blocks.push(current.lines.join('\n'))
      }

      current = null

      continue
    }

    if (current.isTargetLanguage) {
      current.lines.push(stripContentIndent(line, current.indent))
    }
  }

  return blocks
}

function normalizeFenceContent(content: string): string {
  return content.replace(/\s/g, '').replace(/`+$/, '')
}

/**
 * Whether `code`, as rendered by the markdown pipeline, matches a closed
 * fenced block in the source. Exact equality after normalisation is
 * deliberate: the rendered code lags the source by a chunk while streaming,
 * and a prefix match would accept a half-received block.
 */
export function isFencedBlockClosed(
  markdown: string,
  language: string,
  code: string,
): boolean {
  const normalizedCode = normalizeFenceContent(code)

  return getClosedFencedBlocks(markdown, language).some((block) => {
    return normalizeFenceContent(block) === normalizedCode
  })
}

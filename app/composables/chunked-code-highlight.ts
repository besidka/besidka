import type { MaybeRefOrGetter, ShallowRef } from 'vue'
import type { ThemedToken } from 'shiki/core'
import type { ResolvedCodeHighlighter } from '~/utils/code-highlight'

export interface CodeBlockToken {
  content: string
  style: string | undefined
}

export interface CodeBlock {
  key: number
  lineCount: number
  columnCount: number
  text: string
  tokens: CodeBlockToken[] | null
}

interface ChunkedCodeHighlightOptions {
  code: MaybeRefOrGetter<string>
  language: MaybeRefOrGetter<string | null | undefined>
  theme: MaybeRefOrGetter<string>
  cacheKey?: MaybeRefOrGetter<string | null | undefined>
}

interface CachedHighlight {
  code: string
  lineCount: number
  blockTokens: CodeBlockToken[][]
}

type GrammarState = ReturnType<
  ResolvedCodeHighlighter['highlighter']['codeToTokens']
>['grammarState']

export const CODE_BLOCK_LINE_COUNT = 50

export const CODE_BLOCKS_PER_FRAME = 6

const TOKENIZE_BUDGET_MS = 8
const HIGHLIGHT_CACHE_LIMIT = 16
const HIGHLIGHT_CACHE_LINE_LIMIT = 40_000
const NEWLINE = '\n'

const highlightCache = new Map<string, CachedHighlight>()

let cachedLineCount = 0

export function clearCodeHighlightCache() {
  highlightCache.clear()
  cachedLineCount = 0
}

function getCacheKey(
  identity: string,
  language: string,
  theme: string,
): string {
  return `${language}\u0000${theme}\u0000${identity}`
}

function readCache(
  key: string,
  code: string,
  blockCount: number,
): CodeBlockToken[][] | null {
  const cached = highlightCache.get(key)

  if (
    !cached
    || cached.code !== code
    || cached.blockTokens.length !== blockCount
  ) {
    return null
  }

  highlightCache.delete(key)
  highlightCache.set(key, cached)

  return cached.blockTokens
}

function deleteCacheEntry(key: string) {
  const cached = highlightCache.get(key)

  if (!cached) {
    return
  }

  highlightCache.delete(key)
  cachedLineCount -= cached.lineCount
}

function isCacheOverLimit(): boolean {
  return highlightCache.size > HIGHLIGHT_CACHE_LIMIT
    || cachedLineCount > HIGHLIGHT_CACHE_LINE_LIMIT
}

/**
 * Keeps finished colours in least-recently-used order, bounded both by the
 * number of entries and by the total number of lines, so a few very large
 * artifacts cannot hold tens of megabytes of tokens. The newest entry always
 * stays.
 */
function writeCache(
  key: string,
  code: string,
  blockTokens: CodeBlockToken[][],
) {
  const lineCount = code.split(NEWLINE).length

  deleteCacheEntry(key)
  highlightCache.set(key, { code, lineCount, blockTokens })
  cachedLineCount += lineCount

  while (highlightCache.size > 1 && isCacheOverLimit()) {
    const oldestKey = highlightCache.keys().next().value

    if (oldestKey === undefined) {
      return
    }

    deleteCacheEntry(oldestKey)
  }
}

/**
 * Splits code into blocks of `CODE_BLOCK_LINE_COUNT` lines. Every block but
 * the last keeps the newline that ends its last line, so the blocks' text
 * joined together is exactly the source.
 */
export function toPlainCodeBlocks(code: string): CodeBlock[] {
  const lines = code.split(NEWLINE)
  const blocks: CodeBlock[] = []

  for (let start = 0; start < lines.length; start += CODE_BLOCK_LINE_COUNT) {
    const blockLines = lines.slice(start, start + CODE_BLOCK_LINE_COUNT)
    const isLast = start + CODE_BLOCK_LINE_COUNT >= lines.length

    blocks.push({
      key: blocks.length,
      lineCount: blockLines.length,
      columnCount: Math.max(...blockLines.map((line) => {
        return line.length
      })),
      text: blockLines.join(NEWLINE) + (isLast ? '' : NEWLINE),
      tokens: null,
    })
  }

  return blocks
}

function toStyleText(token: ThemedToken): string | undefined {
  const style = getCodeTokenStyle(token)

  if (!style) {
    return undefined
  }

  return Object.entries(style).map(([property, value]) => {
    return `${property}:${value}`
  }).join(';')
}

/**
 * Turns the token lines of one block into a flat token list, with the
 * newline between lines (and after the last line of every block but the
 * last) as its own unstyled token, so the rendered text matches the source.
 */
export function toBlockTokens(
  lines: ThemedToken[][],
  endsWithNewline: boolean,
): CodeBlockToken[] {
  const tokens: CodeBlockToken[] = []

  lines.forEach((line, index) => {
    for (const token of line) {
      tokens.push({ content: token.content, style: toStyleText(token) })
    }

    if (index < lines.length - 1 || endsWithNewline) {
      tokens.push({ content: NEWLINE, style: undefined })
    }
  })

  return tokens
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve()
    })
  })
}

/**
 * Colours finished code in blocks of lines without blocking the page. The
 * plain text renders at once, one text node per block. Each animation frame
 * then tokenizes blocks for up to `TOKENIZE_BUDGET_MS`, carrying the grammar
 * state from block to block, and swaps at most `CODE_BLOCKS_PER_FRAME`
 * coloured blocks in. A block that is already coloured keeps its object, so
 * it never renders again. Finished colours are cached per `cacheKey` (or the
 * code itself), language and theme; reopening the same version replays them
 * without tokenizing. For code that is still streaming in use
 * `useCodeStream`.
 */
export function useChunkedCodeHighlight(
  options: ChunkedCodeHighlightOptions,
): {
  blocks: ShallowRef<CodeBlock[]>
  isHighlighted: ShallowRef<boolean>
} {
  const blocks = shallowRef<CodeBlock[]>([])
  const isHighlighted = shallowRef<boolean>(false)

  let runId = 0
  let isDisposed = false
  let blocksSource: string | null = null
  let blocksKey: string | null = null

  function readTarget() {
    const code = toValue(options.code)
    const language = toValue(options.language) || PLAIN_CODE_LANGUAGE
    const theme = toValue(options.theme)
    const identity = toValue(options.cacheKey) || code

    return {
      code,
      language,
      theme,
      key: getCacheKey(identity, language, theme),
    }
  }

  function showPlain(code: string, key: string) {
    if (blocksSource === code && blocksKey === key) {
      return
    }

    resetToPlain(code, key)
  }

  function resetToPlain(code: string, key: string) {
    blocks.value = toPlainCodeBlocks(code)
    blocksSource = code
    blocksKey = key
    isHighlighted.value = false
  }

  function applyCached(blockTokens: CodeBlockToken[][], limit: number) {
    const next = [...blocks.value]
    let applied = 0

    for (let index = 0; index < next.length && applied < limit; index++) {
      const block = next[index]!

      if (block.tokens) {
        continue
      }

      next[index] = { ...block, tokens: blockTokens[index] ?? null }
      applied++
    }

    blocks.value = next

    return next.every((block) => {
      return !!block.tokens
    })
  }

  async function replayCache(
    blockTokens: CodeBlockToken[][],
    isCurrent: () => boolean,
  ) {
    while (!applyCached(blockTokens, CODE_BLOCKS_PER_FRAME)) {
      await waitForFrame()

      if (!isCurrent()) {
        return
      }
    }

    isHighlighted.value = true
  }

  async function tokenizeBlocks(
    resolved: ResolvedCodeHighlighter,
    theme: string,
    isCurrent: () => boolean,
  ): Promise<CodeBlockToken[][] | null> {
    const blockTokens: CodeBlockToken[][] = []
    let grammarState: GrammarState
    let index = 0

    while (index < blocks.value.length) {
      await waitForFrame()

      if (!isCurrent()) {
        return null
      }

      const startedAt = performance.now()
      const next = [...blocks.value]
      let colouredThisFrame = 0

      while (
        index < next.length
        && colouredThisFrame < CODE_BLOCKS_PER_FRAME
        && performance.now() - startedAt < TOKENIZE_BUDGET_MS
      ) {
        const block = next[index]!
        const endsWithNewline = block.text.endsWith(NEWLINE)
        const source = endsWithNewline ? block.text.slice(0, -1) : block.text
        const result = resolved.highlighter.codeToTokens(source, {
          lang: resolved.language,
          theme,
          grammarState,
        })

        const tokens = toBlockTokens(result.tokens, endsWithNewline)

        grammarState = result.grammarState
        blockTokens[index] = tokens
        next[index] = { ...block, tokens }
        index++
        colouredThisFrame++
      }

      blocks.value = next
    }

    return blockTokens
  }

  async function highlight() {
    const currentRun = ++runId
    const isCurrent = () => {
      return currentRun === runId && !isDisposed
    }
    const { code, language, theme, key } = readTarget()

    showPlain(code, key)

    const cached = readCache(key, code, blocks.value.length)

    if (cached) {
      await replayCache(cached, isCurrent)

      return
    }

    let resolved: ResolvedCodeHighlighter

    try {
      resolved = await loadCodeHighlighter(language, code)
    } catch {
      return
    }

    if (!isCurrent()) {
      return
    }

    let blockTokens: CodeBlockToken[][] | null

    try {
      blockTokens = await tokenizeBlocks(resolved, theme, isCurrent)
    } catch {
      if (isCurrent()) {
        resetToPlain(code, key)
      }

      return
    }

    if (!blockTokens || !isCurrent()) {
      return
    }

    writeCache(key, code, blockTokens)
    isHighlighted.value = true
  }

  const initial = readTarget()

  showPlain(initial.code, initial.key)

  const initialCached = readCache(
    initial.key,
    initial.code,
    blocks.value.length,
  )

  if (initialCached && applyCached(initialCached, CODE_BLOCKS_PER_FRAME)) {
    isHighlighted.value = true
  }

  watch(
    [
      () => toValue(options.code),
      () => toValue(options.language),
      () => toValue(options.theme),
      () => toValue(options.cacheKey),
    ],
    highlight,
  )

  onMounted(() => {
    if (!isHighlighted.value) {
      highlight()
    }
  })

  onScopeDispose(() => {
    isDisposed = true
  })

  return { blocks, isHighlighted }
}

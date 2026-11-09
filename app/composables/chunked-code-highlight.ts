import type { MaybeRefOrGetter, ShallowRef } from 'vue'
import type { CodeLine } from '~/composables/code-stream'

interface ChunkedCodeHighlightOptions {
  code: MaybeRefOrGetter<string>
  language: MaybeRefOrGetter<string | null | undefined>
  theme: MaybeRefOrGetter<string>
}

type GrammarState = NonNullable<
  ReturnType<
    Awaited<ReturnType<typeof loadCodeHighlighter>>['highlighter']['codeToTokens']
  >['grammarState']
>

const CHUNK_LINE_COUNT = 40
const HIGHLIGHT_CACHE_LIMIT = 24
const NEWLINE = '\n'

const highlightCache = new Map<string, CodeLine[]>()

function getCacheKey(code: string, language: string, theme: string): string {
  return `${language}\u0000${theme}\u0000${code}`
}

function rememberLines(key: string, lines: CodeLine[]) {
  highlightCache.delete(key)
  highlightCache.set(key, lines)

  if (highlightCache.size <= HIGHLIGHT_CACHE_LIMIT) {
    return
  }

  const oldestKey = highlightCache.keys().next().value

  if (oldestKey !== undefined) {
    highlightCache.delete(oldestKey)
  }
}

async function yieldToBrowser() {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

async function waitForPaint() {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0)
    })
  })
}

/**
 * Colours finished code without blocking the page: the plain text renders
 * first, then the code is tokenized in chunks of lines that carry the
 * grammar state across, yielding to the browser between chunks, so a
 * 3,000-line file never becomes one long task. Finished results are kept
 * per code, language and theme, so switching back to the same version is
 * instant. For code that is still streaming in use `useCodeStream`.
 */
export function useChunkedCodeHighlight(
  options: ChunkedCodeHighlightOptions,
): {
  lines: ShallowRef<CodeLine[]>
  isHighlighted: ShallowRef<boolean>
} {
  const initialCode = toValue(options.code)
  const initialCached = highlightCache.get(getCacheKey(
    initialCode,
    toValue(options.language) ?? PLAIN_CODE_LANGUAGE,
    toValue(options.theme),
  ))
  const lines = shallowRef<CodeLine[]>(
    initialCached ?? toPlainCodeLines(initialCode),
  )
  const isHighlighted = shallowRef<boolean>(!!initialCached)

  let runId = 0
  let isDisposed = false
  let linesSource = initialCode
  let linesTheme = toValue(options.theme)

  async function highlight() {
    const currentRun = ++runId
    const isCurrent = () => {
      return currentRun === runId && !isDisposed
    }
    const code = toValue(options.code)
    const language = toValue(options.language) ?? PLAIN_CODE_LANGUAGE
    const theme = toValue(options.theme)
    const key = getCacheKey(code, language, theme)
    const cached = highlightCache.get(key)

    if (cached) {
      lines.value = cached
      linesSource = code
      linesTheme = theme
      isHighlighted.value = true

      return
    }

    if (linesSource !== code || linesTheme !== theme) {
      lines.value = toPlainCodeLines(code)
      linesSource = code
      linesTheme = theme
    }

    const nextLines = [...lines.value]

    isHighlighted.value = false

    await waitForPaint()

    if (!isCurrent()) {
      return
    }

    let resolved: Awaited<ReturnType<typeof loadCodeHighlighter>>

    try {
      resolved = await loadCodeHighlighter(language, code)
    } catch {
      return
    }

    const texts = code.split(NEWLINE)
    let grammarState: GrammarState | undefined

    for (
      let start = 0;
      start < texts.length;
      start += CHUNK_LINE_COUNT
    ) {
      if (!isCurrent()) {
        return
      }

      try {
        const result = resolved.highlighter.codeToTokens(
          texts.slice(start, start + CHUNK_LINE_COUNT).join(NEWLINE),
          { lang: resolved.language, theme, grammarState },
        )

        grammarState = result.grammarState
        result.tokens.forEach((tokens, offset) => {
          const index = start + offset

          nextLines[index] = createCodeLine(
            index,
            toCodeSpans(tokens),
            index < texts.length - 1,
          )
        })
      } catch {
        return
      }

      lines.value = [...nextLines]
      await yieldToBrowser()
    }

    if (!isCurrent()) {
      return
    }

    rememberLines(key, lines.value)
    isHighlighted.value = true
  }

  watch(
    [
      () => toValue(options.code),
      () => toValue(options.language),
      () => toValue(options.theme),
    ],
    highlight,
  )

  onMounted(highlight)

  onScopeDispose(() => {
    isDisposed = true
  })

  return { lines, isHighlighted }
}

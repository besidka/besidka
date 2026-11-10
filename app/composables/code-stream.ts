import type { MaybeRefOrGetter, ShallowRef } from 'vue'
import type { ThemedToken } from 'shiki/core'
import type { ShikiStreamTokenizer } from '@shikijs/stream'
import type { ResolvedCodeHighlighter } from '~/utils/code-highlight'

export interface CodeSpan {
  content: string
  style: Record<string, string> | undefined
}

export interface CodeLine {
  key: number
  spans: CodeSpan[]
  newline: boolean
  signature: string
}

interface CodeStreamOptions {
  code: MaybeRefOrGetter<string>
  language: MaybeRefOrGetter<string | null | undefined>
  theme: MaybeRefOrGetter<string>
}

interface TokenizerState {
  tokenizer: ShikiStreamTokenizer
  highlighter: ResolvedCodeHighlighter['highlighter']
  grammar: unknown
  language: string
  theme: string
  source: string
  finishedLines: CodeLine[]
}

const NEWLINE_TOKEN = '\n'

function createLine(
  key: number,
  spans: CodeSpan[],
  newline: boolean,
): CodeLine {
  return {
    key,
    spans,
    newline,
    signature: JSON.stringify([spans, newline]),
  }
}

function toPlainLines(code: string): CodeLine[] {
  const texts = code.split(NEWLINE_TOKEN)

  return texts.map((text, index) => {
    return createLine(
      index,
      text ? [{ content: text, style: undefined }] : [],
      index < texts.length - 1,
    )
  })
}

function toSpans(tokens: ThemedToken[]): CodeSpan[] {
  return tokens.map((token) => {
    return { content: token.content, style: getCodeTokenStyle(token) }
  })
}

function getGrammar(resolved: ResolvedCodeHighlighter): unknown {
  if (resolved.language === PLAIN_CODE_LANGUAGE) {
    return null
  }

  return resolved.highlighter.getLanguage(resolved.language)
}

/**
 * Colours code that may still be streaming in, one line at a time. Plain
 * lines show first; once the language loads, lines are tokenized
 * incrementally with `@shikijs/stream`, so a finished line is tokenized and
 * rendered once and keeps the same object (and DOM node) while later chunks
 * arrive. Only the incomplete last line changes per chunk. Edits that are not
 * appends, a theme switch or a rebuilt highlighter start over, reusing every
 * line whose colours did not change.
 */
export function useCodeStream(options: CodeStreamOptions): {
  lines: ShallowRef<CodeLine[]>
  isHighlighted: ShallowRef<boolean>
} {
  const lines = shallowRef<CodeLine[]>(toPlainLines(toValue(options.code)))
  const isHighlighted = shallowRef<boolean>(false)

  let state: TokenizerState | null = null
  let isSyncing = false
  let isDirty = false
  let isDisposed = false

  function publish(next: CodeLine[]) {
    const previous = lines.value
    let isChanged = next.length !== previous.length

    const merged = next.map((line, index) => {
      const previousLine = previous[index]

      if (previousLine === line) {
        return line
      }

      if (previousLine?.signature === line.signature) {
        return previousLine
      }

      isChanged = true

      return line
    })

    if (state) {
      for (let index = 0; index < state.finishedLines.length; index++) {
        state.finishedLines[index] = merged[index]!
      }
    }

    if (isChanged) {
      lines.value = merged
    }
  }

  function showPlain(code: string) {
    state = null
    isHighlighted.value = false
    publish(toPlainLines(code))
  }

  function isStateCurrent(
    resolved: ResolvedCodeHighlighter,
    theme: string,
    code: string,
  ): boolean {
    return !!state
      && state.highlighter === resolved.highlighter
      && state.language === resolved.language
      && state.grammar === getGrammar(resolved)
      && state.theme === theme
      && code.startsWith(state.source)
  }

  async function tokenize(
    resolved: ResolvedCodeHighlighter,
    theme: string,
    code: string,
  ) {
    if (!state || !isStateCurrent(resolved, theme, code)) {
      state = {
        tokenizer: await createCodeTokenizer(resolved, theme),
        highlighter: resolved.highlighter,
        grammar: getGrammar(resolved),
        language: resolved.language,
        theme,
        source: '',
        finishedLines: [],
      }
    }

    const current = state
    const chunk = code.slice(current.source.length)

    current.source = code

    const { stable, unstable } = await current.tokenizer.enqueue(chunk)
    let lineTokens: ThemedToken[] = []

    for (const token of stable) {
      if (token.content !== NEWLINE_TOKEN) {
        lineTokens.push(token)

        continue
      }

      current.finishedLines.push(createLine(
        current.finishedLines.length,
        toSpans(lineTokens),
        true,
      ))
      lineTokens = []
    }

    const tail = createLine(
      current.finishedLines.length,
      toSpans(unstable),
      false,
    )

    publish([...current.finishedLines, tail])
    isHighlighted.value = true
  }

  async function syncOnce() {
    const code = toValue(options.code)
    const language = toValue(options.language)
    const theme = toValue(options.theme)

    let resolved: ResolvedCodeHighlighter

    try {
      resolved = await loadCodeHighlighter(language, code)
    } catch {
      showPlain(toValue(options.code))

      return
    }

    if (isDisposed) {
      return
    }

    try {
      await tokenize(resolved, theme, toValue(options.code))
    } catch {
      showPlain(toValue(options.code))
    }
  }

  async function sync() {
    if (!state) {
      publish(toPlainLines(toValue(options.code)))
    }

    if (isSyncing) {
      isDirty = true

      return
    }

    isSyncing = true

    try {
      do {
        isDirty = false
        await syncOnce()
      } while (isDirty && !isDisposed)
    } finally {
      isSyncing = false
    }
  }

  watch(
    [
      () => toValue(options.code),
      () => toValue(options.language),
      () => toValue(options.theme),
    ],
    sync,
  )

  onMounted(sync)

  onScopeDispose(() => {
    isDisposed = true
  })

  return { lines, isHighlighted }
}

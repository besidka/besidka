import type { ThemedToken } from 'shiki/core'
import type { ShikiStreamTokenizer } from '@shikijs/stream'
import type {
  CodeHighlighterPool,
  ResolvedCodeHighlighter,
} from '~/utils/code-highlight'

interface ClientHighlighting {
  pool: CodeHighlighterPool
  Tokenizer: typeof ShikiStreamTokenizer
}

let clientHighlighting: Promise<ClientHighlighting> | null = null

/**
 * Shiki is imported only here, dynamically, and only in the client build.
 * A static import from code the server can reach would ship its grammars
 * and themes in the Worker, where they never run. See
 * docs/code-highlighting.md.
 */
function importShiki() {
  if (import.meta.client) {
    return Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/langs'),
      import('shiki/themes/github-dark-high-contrast.mjs'),
      import('shiki/themes/github-light-high-contrast.mjs'),
      import('@shikijs/stream'),
    ])
  }

  return Promise.reject(new Error('Code highlighting runs only in the browser'))
}

async function createClientHighlighting(): Promise<ClientHighlighting> {
  const [
    { createHighlighterCore },
    { createJavaScriptRegexEngine },
    { bundledLanguages },
    darkTheme,
    lightTheme,
    { ShikiStreamTokenizer: Tokenizer },
  ] = await importShiki()
  const engine = createJavaScriptRegexEngine()
  const themes = [darkTheme.default, lightTheme.default]
  const pool = createCodeHighlighterPool({
    createHighlighter: () => {
      return createHighlighterCore({
        engine,
        themes,
        langs: [],
        warnings: false,
      })
    },
    languageImports: bundledLanguages,
  })

  return { pool, Tokenizer }
}

function useClientHighlighting(): Promise<ClientHighlighting> {
  if (!clientHighlighting) {
    clientHighlighting = createClientHighlighting()
    clientHighlighting.catch(() => {
      clientHighlighting = null
    })
  }

  return clientHighlighting
}

export async function loadCodeHighlighter(
  language: string | null | undefined,
  code: string,
): Promise<ResolvedCodeHighlighter> {
  const { pool } = await useClientHighlighting()

  return pool.load(language, code)
}

export async function createCodeTokenizer(
  resolved: ResolvedCodeHighlighter,
  theme: string,
): Promise<ShikiStreamTokenizer> {
  const { Tokenizer } = await useClientHighlighting()

  return new Tokenizer({
    highlighter: resolved.highlighter,
    lang: resolved.language,
    theme,
  })
}

export async function highlightCode(
  code: string,
  language: string | null | undefined,
  theme: string,
): Promise<ThemedToken[][]> {
  const resolved = await loadCodeHighlighter(language, code)

  return resolved.highlighter.codeToTokens(code, {
    lang: resolved.language,
    theme,
  }).tokens
}

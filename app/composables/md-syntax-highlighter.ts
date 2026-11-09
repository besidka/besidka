import type { HighlighterGeneric, ThemedToken } from 'shiki'
// Use `full` when bundle size is not an issue
// https://shiki.style/guide/bundles
// import { createHighlighter, bundledLanguages } from 'shiki/bundle/full'
import { createHighlighter, bundledLanguages } from 'shiki/bundle/web'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

let highlighter: HighlighterGeneric<any, any> | null = null

let promise: Promise<HighlighterGeneric<any, any>> | null = null

const STATIC_TOKENS_CACHE_LIMIT = 24

const staticTokensCache = new Map<string, ThemedToken[][]>()

/**
 * The highlighter when it has already loaded, so a component can colour code
 * on its first render instead of waiting a tick.
 */
export function getLoadedHighlighter(): HighlighterGeneric<any, any> | null {
  return highlighter
}

interface StaticTokensInput {
  highlighter: HighlighterGeneric<any, any>
  code: string
  lang: string
  theme: string
}

function getStaticTokensKey(input: StaticTokensInput): string {
  return `${input.lang}\u0000${input.theme}\u0000${input.code}`
}

export function getCachedStaticTokens(
  input: StaticTokensInput,
): ThemedToken[][] | null {
  return staticTokensCache.get(getStaticTokensKey(input)) ?? null
}

/**
 * Tokenizes finished code once and keeps the result for the same code,
 * language and theme. Unlike the streaming renderer, which re-renders once
 * per token and so grows quadratically with the length of a block, this is
 * one pass: use it for code that is complete, such as an artifact version.
 */
export function highlightStaticCode(
  input: StaticTokensInput,
): ThemedToken[][] {
  const key = getStaticTokensKey(input)
  const cached = staticTokensCache.get(key)

  if (cached) {
    return cached
  }

  const { tokens } = input.highlighter.codeToTokens(input.code, {
    lang: input.lang,
    theme: input.theme,
  })

  staticTokensCache.set(key, tokens)

  if (staticTokensCache.size > STATIC_TOKENS_CACHE_LIMIT) {
    const oldestKey = staticTokensCache.keys().next().value

    if (oldestKey !== undefined) {
      staticTokensCache.delete(oldestKey)
    }
  }

  return tokens
}

export async function useHighlighter() {
  if (!promise) {
    promise = createHighlighter({
      engine: createJavaScriptRegexEngine(),
      themes: ['github-dark-high-contrast', 'github-light-high-contrast'],
      langs: Object.keys(bundledLanguages),
    })
  }

  if (!highlighter) {
    highlighter = await promise
  }

  return highlighter
}

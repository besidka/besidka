import type { HighlighterGeneric } from 'shiki'
// Use `full` when bundle size is not an issue
// https://shiki.style/guide/bundles
// import { createHighlighter, bundledLanguages } from 'shiki/bundle/full'
import { createHighlighter, bundledLanguages } from 'shiki/bundle/web'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

let highlighter: HighlighterGeneric<any, any> | null = null

let promise: Promise<HighlighterGeneric<any, any>> | null = null

export async function useHighlighter() {
  if (!promise) {
    promise = createHighlighter({
      engine: createJavaScriptRegexEngine(),
      themes: [
        import('@shikijs/themes/github-dark'),
        import('@shikijs/themes/github-light'),
      ],
      langs: Object.keys(bundledLanguages),
    })
  }

  if (!highlighter) {
    highlighter = await promise
  }

  return highlighter
}

import type { HighlighterGeneric } from 'shiki'
import { createHighlighter, bundledLanguages } from 'shiki/bundle/full'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

let highlighter: HighlighterGeneric<any, any> | null = null

let promise: Promise<HighlighterGeneric<any, any>> | null = null

export async function useHighlighter() {
  if (!promise) {
    promise = createHighlighter({
      engine: createJavaScriptRegexEngine(),
      themes: ['github-dark', 'github-light'],
      langs: Object.keys(bundledLanguages),
    })
  }

  if (!highlighter) {
    highlighter = await promise
  }

  return highlighter
}

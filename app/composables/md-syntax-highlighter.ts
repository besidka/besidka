import type { HighlighterGeneric } from 'shiki'
import { createHighlighter } from 'shiki'
import { createJavaScriptRegexEngine } from 'shiki/engine-javascript.mjs'

let highlighter: HighlighterGeneric<any, any> | null = null

let promise: Promise<HighlighterGeneric<any, any>> | null = null

export async function useHighlighter() {
  if (!promise) {
    promise = createHighlighter({
      langs: ['vue', 'js', 'ts', 'css', 'html', 'json', 'yaml', 'markdown', 'bash'],
      themes: ['github-dark', 'github-light'],
      engine: createJavaScriptRegexEngine(),
    })
  }

  if (!highlighter) {
    highlighter = await promise
  }

  return highlighter
}

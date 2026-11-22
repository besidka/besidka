import type { Theme } from '@besidka/artifacts-protocol'
import { createHighlighterCore } from 'shiki/core'
import type { HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { LANGUAGE_LOADERS, PLAIN_LANGUAGE } from './languages.ts'

export const SHIKI_THEMES: Record<Theme, string> = {
  light: 'github-light-high-contrast',
  dark: 'github-dark-high-contrast',
}

export const MAX_HIGHLIGHT_LENGTH = 100_000

let highlighterPromise: Promise<HighlighterCore> | null = null

const languageLoads = new Map<string, Promise<void>>()

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [
      import('shiki/themes/github-light-high-contrast.mjs'),
      import('shiki/themes/github-dark-high-contrast.mjs'),
    ],
    langs: [],
  })

  return highlighterPromise
}

async function ensureLanguage(
  highlighter: HighlighterCore,
  language: string,
): Promise<string> {
  const loader = LANGUAGE_LOADERS[language]

  if (!loader) {
    return PLAIN_LANGUAGE
  }

  let load = languageLoads.get(language)

  if (!load) {
    load = highlighter.loadLanguage(loader)
    languageLoads.set(language, load)
  }

  try {
    await load
  } catch {
    languageLoads.delete(language)

    return PLAIN_LANGUAGE
  }

  return language
}

/**
 * Highlights code with the chat's Shiki themes and returns Shiki's HTML
 * (code is escaped by Shiki). Grammars load on first use, one chunk each.
 * Very long input stays plain so a huge block cannot stall the frame.
 */
export async function highlightCode(
  code: string,
  language: string,
  theme: Theme,
): Promise<string> {
  const highlighter = await getHighlighter()
  const lang = code.length > MAX_HIGHLIGHT_LENGTH
    ? PLAIN_LANGUAGE
    : await ensureLanguage(highlighter, language)

  return highlighter.codeToHtml(code, { lang, theme: SHIKI_THEMES[theme] })
}

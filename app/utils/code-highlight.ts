import type {
  HighlighterCore,
  LanguageRegistration,
  ThemedToken,
} from 'shiki/core'

export const CODE_THEME_DARK = 'github-dark-high-contrast'

export const CODE_THEME_LIGHT = 'github-light-high-contrast'

export const PLAIN_CODE_LANGUAGE = 'text'

/**
 * Language modules whose grammars inject into a root language in the eager
 * `shiki/bundle/web` highlighter this replaced (tagged templates such as
 * css`…` and sql`…` in JavaScript and TypeScript, Angular and Vue template
 * syntax in HTML derivatives). Each root gets its own highlighter that loads
 * these together with the root, so the result never depends on what other
 * code blocks loaded first. Checked against the eager highlighter by
 * tests/unit/scripts/shiki-token-parity.spec.ts.
 */
export const CODE_LANGUAGE_INJECTORS: Readonly<
  Record<string, readonly string[]>
> = {
  'angular-html': ['vue'],
  'angular-ts': ['ts-tags'],
  'html-derivative': ['angular-html', 'vue'],
  'javascript': ['ts-tags'],
  'jsx': ['ts-tags'],
  'typescript': ['ts-tags'],
}

/**
 * Lazily embedded languages a root uses without naming them: inline HTML in
 * Markdown, ESM and JSX in MDX. The eager bundle always had them loaded.
 */
export const CODE_LANGUAGE_IMPLICIT_EMBEDS: Readonly<
  Record<string, readonly string[]>
> = {
  markdown: ['html-derivative'],
  mdc: ['html-derivative'],
  mdx: ['tsx'],
}

const FONT_STYLE_ITALIC = 1

const FONT_STYLE_BOLD = 2

const FONT_STYLE_UNDERLINE = 4

const FONT_STYLE_STRIKETHROUGH = 8

const YAML_FRONTMATTER_FENCE = '---'

const TOML_FRONTMATTER_FENCE = '+++'

const EMBEDDED_LANGUAGE_PATTERNS: readonly RegExp[] = [
  /^[ \t>]*(?:`{3,}|~{3,})[ \t]*\{?[ \t]*\.?([\w#+.-]+)/gm,
  /\blang\s*=\s*["']?([\w#+.-]+)/g,
  /^[ \t]*:([\w-]+)/gm,
]

interface LanguageModule {
  default: LanguageRegistration[]
}

export type CodeLanguageImports = Record<
  string,
  () => Promise<LanguageModule>
>

export interface CodeHighlighterPoolOptions {
  createHighlighter: () => Promise<HighlighterCore>
  languageImports: CodeLanguageImports
}

export interface ResolvedCodeHighlighter {
  highlighter: HighlighterCore
  language: string
}

export interface CodeHighlighterPool {
  load: (
    language: string | null | undefined,
    code: string,
  ) => Promise<ResolvedCodeHighlighter>
}

interface RootHighlighter {
  highlighter: HighlighterCore
  embeddedLanguages: readonly string[]
  lazyLanguages: ReadonlySet<string>
  loadedLanguages: ReadonlySet<string>
}

interface RootState {
  current: Promise<RootHighlighter>
  queue: Promise<unknown>
}

export function normalizeCodeLanguage(
  language: string | null | undefined,
): string {
  return (language ?? '').trim().toLowerCase()
}

export function findEmbeddedLanguageCandidates(code: string): Set<string> {
  const candidates = new Set<string>()
  const opening = code.trimStart()

  if (opening.startsWith(YAML_FRONTMATTER_FENCE)) {
    candidates.add('yaml')
  }

  if (opening.startsWith(TOML_FRONTMATTER_FENCE)) {
    candidates.add('toml')
  }

  for (const pattern of EMBEDDED_LANGUAGE_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      const candidate = normalizeCodeLanguage(match[1])

      if (candidate) {
        candidates.add(candidate)
      }
    }
  }

  return candidates
}

/**
 * Hands out shiki core highlighters that colour code exactly like the eager
 * web bundle while loading grammars on demand. Every root language gets its
 * own highlighter, built in one `loadLanguage` call from the root, the
 * grammars that inject into it and the languages the code embeds. Shiki
 * freezes a grammar's injections the first time any loaded grammar references
 * it, and a grammar compiled before a lazily embedded language arrived never
 * picks that language up, so a shared or incrementally grown registry would
 * colour a block differently depending on what the reader opened before.
 * When code names a new embedded language (a fence in Markdown, `lang="…"` in
 * Vue), the root's highlighter is rebuilt with it. Unknown languages resolve
 * to plain `text`.
 */
export function createCodeHighlighterPool(
  options: CodeHighlighterPoolOptions,
): CodeHighlighterPool {
  const { languageImports } = options
  const catalogue = Object.keys(languageImports)
  const registrationImports = new Map<
    string,
    Promise<LanguageRegistration[]>
  >()
  const roots = new Map<string, RootState>()
  let plainHighlighter: Promise<HighlighterCore> | null = null

  function isKnownLanguage(id: string): boolean {
    return Object.hasOwn(languageImports, id)
  }

  function importRegistrations(id: string): Promise<LanguageRegistration[]> {
    let pending = registrationImports.get(id)

    if (!pending) {
      pending = languageImports[id]!().then((module) => {
        return module.default
      })
      registrationImports.set(id, pending)
      pending.catch(() => {
        registrationImports.delete(id)
      })
    }

    return pending
  }

  async function getRootName(id: string): Promise<string> {
    const registrations = await importRegistrations(id)

    return registrations.at(-1)?.name ?? id
  }

  /**
   * Registrations of several language modules in catalogue order, each
   * grammar once. The eager bundle registered its languages in that order,
   * and the order decides the order of a scope's injections.
   */
  async function collectRegistrations(
    ids: readonly string[],
  ): Promise<LanguageRegistration[]> {
    const sortedIds = [...new Set(ids)].sort((left, right) => {
      return catalogue.indexOf(left) - catalogue.indexOf(right)
    })
    const byName = new Map<string, LanguageRegistration>()

    for (const id of sortedIds) {
      for (const registration of await importRegistrations(id)) {
        if (!byName.has(registration.name)) {
          byName.set(registration.name, registration)
        }
      }
    }

    return [...byName.values()]
  }

  async function createRoot(
    rootName: string,
    embeddedLanguages: readonly string[],
  ): Promise<RootHighlighter> {
    const registrations = await collectRegistrations([
      ...CODE_LANGUAGE_INJECTORS[rootName] ?? [],
      ...CODE_LANGUAGE_IMPLICIT_EMBEDS[rootName] ?? [],
      ...embeddedLanguages,
      rootName,
    ])
    const rootRegistrations = await importRegistrations(rootName)
    const highlighter = await options.createHighlighter()

    await highlighter.loadLanguage(registrations)

    return {
      highlighter,
      embeddedLanguages,
      lazyLanguages: new Set(rootRegistrations.flatMap((registration) => {
        return registration.embeddedLangsLazy ?? []
      })),
      loadedLanguages: new Set(registrations.map((registration) => {
        return registration.name
      })),
    }
  }

  /**
   * Lazily embedded languages the code names that are not loaded yet. Only
   * complete lines count, so a fence info string cut mid-stream (`java` on
   * the way to `javascript`) never loads the wrong grammar.
   */
  async function findMissingEmbeddedLanguages(
    lazyLanguages: ReadonlySet<string>,
    loadedLanguages: ReadonlySet<string>,
    code: string,
  ): Promise<string[]> {
    if (!lazyLanguages.size) {
      return []
    }

    const completeLines = code.slice(0, code.lastIndexOf('\n') + 1)
    const missing = new Set<string>()

    for (const candidate of findEmbeddedLanguageCandidates(completeLines)) {
      if (!isKnownLanguage(candidate)) {
        continue
      }

      const name = await getRootName(candidate)

      if (lazyLanguages.has(name) && !loadedLanguages.has(name)) {
        missing.add(name)
      }
    }

    return [...missing]
  }

  async function createFirstRoot(
    rootName: string,
    code: string,
  ): Promise<RootHighlighter> {
    const rootRegistrations = await importRegistrations(rootName)
    const lazyLanguages = new Set(rootRegistrations.flatMap((registration) => {
      return registration.embeddedLangsLazy ?? []
    }))

    return createRoot(
      rootName,
      await findMissingEmbeddedLanguages(lazyLanguages, new Set(), code),
    )
  }

  function getRootState(rootName: string, code: string): RootState {
    let state = roots.get(rootName)

    if (!state) {
      const current = createFirstRoot(rootName, code)

      state = { current, queue: current }
      roots.set(rootName, state)
      current.catch(() => {
        roots.delete(rootName)
      })
    }

    return state
  }

  async function resolveRoot(
    rootName: string,
    state: RootState,
    code: string,
  ): Promise<RootHighlighter> {
    const root = await state.current
    const missing = await findMissingEmbeddedLanguages(
      root.lazyLanguages,
      root.loadedLanguages,
      code,
    )

    if (!missing.length) {
      return root
    }

    try {
      const rebuilt = await createRoot(rootName, [
        ...root.embeddedLanguages,
        ...missing,
      ])

      state.current = Promise.resolve(rebuilt)

      return rebuilt
    } catch {
      return root
    }
  }

  function getPlainHighlighter(): Promise<HighlighterCore> {
    if (!plainHighlighter) {
      plainHighlighter = options.createHighlighter()
    }

    return plainHighlighter
  }

  async function load(
    language: string | null | undefined,
    code: string,
  ): Promise<ResolvedCodeHighlighter> {
    const normalized = normalizeCodeLanguage(language)

    if (!normalized || !isKnownLanguage(normalized)) {
      return {
        highlighter: await getPlainHighlighter(),
        language: PLAIN_CODE_LANGUAGE,
      }
    }

    const rootName = await getRootName(normalized)
    const state = getRootState(rootName, code)
    const resolved = state.queue.then(() => {
      return resolveRoot(rootName, state, code)
    }, () => {
      return resolveRoot(rootName, state, code)
    })

    state.queue = resolved

    const root = await resolved

    return { highlighter: root.highlighter, language: rootName }
  }

  return { load }
}

/**
 * The same styles as `getTokenStyleObject` from `@shikijs/core`, written out
 * so this module needs no runtime shiki import (see the server-bundle rule in
 * docs/code-highlighting.md).
 */
export function getCodeTokenStyle(
  token: ThemedToken,
): Record<string, string> | undefined {
  const style: Record<string, string> = {}

  if (token.color) {
    style.color = token.color
  }

  if (token.bgColor) {
    style['background-color'] = token.bgColor
  }

  if (token.fontStyle) {
    if (token.fontStyle & FONT_STYLE_ITALIC) {
      style['font-style'] = 'italic'
    }

    if (token.fontStyle & FONT_STYLE_BOLD) {
      style['font-weight'] = 'bold'
    }

    const decorations: string[] = []

    if (token.fontStyle & FONT_STYLE_UNDERLINE) {
      decorations.push('underline')
    }

    if (token.fontStyle & FONT_STYLE_STRIKETHROUGH) {
      decorations.push('line-through')
    }

    if (decorations.length) {
      style['text-decoration'] = decorations.join(' ')
    }
  }

  return Object.keys(style).length ? style : undefined
}

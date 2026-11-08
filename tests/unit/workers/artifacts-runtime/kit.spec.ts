// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bundledLanguagesInfo } from 'shiki/bundle/web'
import {
  FEEDBACK_DURATION_MS,
  createButton,
  readSource,
  showOutcome,
} from '~~/workers/artifacts-runtime/src/kit/chrome'
import {
  LANGUAGE_ALIASES,
  LANGUAGE_LOADERS,
  PLAIN_LANGUAGE,
  resolveLanguage,
} from '~~/workers/artifacts-runtime/src/kit/languages'
import { upgradeCodeBlocks } from '~~/workers/artifacts-runtime/src/kit/upgrade'
import { markdownToHtml } from '~~/workers/artifacts-runtime/src/render/markdown'

function createRoot(html: string): HTMLElement {
  const root = document.createElement('div')

  root.innerHTML = html

  return root
}

describe('kit languages', () => {
  it('mirrors the language set of the chat highlighter (shiki web bundle)', () => {
    expect(Object.keys(LANGUAGE_LOADERS).sort()).toEqual(
      bundledLanguagesInfo.map((language) => {
        return language.id
      }).sort(),
    )

    const aliases = bundledLanguagesInfo.flatMap((language) => {
      return (language.aliases ?? []).map((alias) => {
        return [alias, language.id]
      })
    })

    expect(Object.entries(LANGUAGE_ALIASES).sort()).toEqual(aliases.sort())
  })

  it('resolves names and aliases and falls back to plain text', () => {
    expect(resolveLanguage('TS')).toBe('typescript')
    expect(resolveLanguage(' js ')).toBe('javascript')
    expect(resolveLanguage('vue')).toBe('vue')
    expect(resolveLanguage('cobol')).toBe(PLAIN_LANGUAGE)
    expect(resolveLanguage('__proto__')).toBe(PLAIN_LANGUAGE)
    expect(resolveLanguage(null)).toBe(PLAIN_LANGUAGE)
  })
})

describe('kit source text', () => {
  it('keeps text that starts on the first line exactly', () => {
    const element = document.createElement('div')

    element.textContent = '  indented()\n    deeper()\n\n'

    expect(readSource(element)).toBe('  indented()\n    deeper()')
  })

  it('dedents text written on its own lines', () => {
    const element = document.createElement('div')

    element.textContent = '\n\n    if (a) {\n      b()\n    }\n  '

    expect(readSource(element)).toBe('if (a) {\n  b()\n}')
  })
})

describe('code block upgrade', () => {
  it('upgrades every fenced block of a markdown artifact', () => {
    const root = createRoot(markdownToHtml([
      '```ts',
      'const a = 1 < 2',
      '```',
      '',
      '```',
      'plain',
      '```',
      '',
      '```mermaid',
      'graph TD; A-->B',
      '```',
    ].join('\n')))

    expect(upgradeCodeBlocks(root, { includeUnlabelled: true })).toBe(3)

    const codeBlocks = root.querySelectorAll('besidka-code')

    expect(codeBlocks).toHaveLength(2)
    expect(codeBlocks[0]?.getAttribute('lang')).toBe('ts')
    expect(codeBlocks[0]?.textContent).toBe('const a = 1 < 2\n')
    expect(codeBlocks[1]?.hasAttribute('lang')).toBe(false)
    expect(root.querySelector('besidka-mermaid')?.textContent)
      .toBe('graph TD; A-->B\n')
    expect(root.querySelector('pre')).toBeNull()
  })

  it('upgrades only language-tagged blocks in html and honours the opt-out', () => {
    const root = createRoot([
      '<pre><code class="language-python">print(1)</code></pre>',
      '<pre><code>untagged</code></pre>',
      '<pre data-besidka-raw><code class="language-js">raw()</code></pre>',
      '<pre><code class="language-js" data-besidka-raw>raw()</code></pre>',
      '<section data-besidka-raw>',
      '<pre><code class="language-js">raw()</code></pre>',
      '</section>',
      '<pre><span>x</span><code class="language-js">mixed()</code></pre>',
    ].join(''))

    expect(upgradeCodeBlocks(root)).toBe(1)
    expect(root.querySelector('besidka-code')?.getAttribute('lang'))
      .toBe('python')
    expect(root.querySelectorAll('pre')).toHaveLength(5)
  })
})

describe('kit button outcome', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('restarts the reset timer when a new outcome arrives', () => {
    vi.useFakeTimers()

    const button = createButton('kit-copy', 'copy', 'Copy')
    const labels = {
      idleIcon: 'copy' as const,
      idle: 'Copy',
      done: 'Copied!',
      failed: 'Copy failed',
    }

    showOutcome(button, { ok: false, message: 'denied' }, labels)
    vi.advanceTimersByTime(FEEDBACK_DURATION_MS - 100)
    showOutcome(button, { ok: true }, labels)
    vi.advanceTimersByTime(200)

    expect(button.element.getAttribute('aria-label')).toBe('Copied!')

    vi.advanceTimersByTime(FEEDBACK_DURATION_MS)

    expect(button.element.getAttribute('aria-label')).toBe('Copy')
  })
})

import { describe, expect, it } from 'vitest'
import {
  compareAfterContamination,
  compareImprovement,
  compareTokenParity,
  createLazyPool,
  deriveLanguageInjectors,
  WEB_LANGUAGE_IDS,
} from '../../../scripts/shiki-token-parity.mjs'
import {
  CODE_LANGUAGE_INJECTORS,
  PLAIN_CODE_LANGUAGE,
  findEmbeddedLanguageCandidates,
} from '../../../app/utils/code-highlight'

const PARITY_TIMEOUT_MS = 180000

describe('shiki token parity with the eager web bundle', () => {
  it('declares the injections the eager highlighter collects', async () => {
    expect(CODE_LANGUAGE_INJECTORS).toEqual(await deriveLanguageInjectors())
  }, PARITY_TIMEOUT_MS)

  it('tokenizes every web language identically, cold and warm, in both '
    + 'themes', async () => {
    const { comparisons, mismatches } = await compareTokenParity()

    expect(WEB_LANGUAGE_IDS).toHaveLength(57)
    expect(comparisons).toBeGreaterThan(4000)
    expect(mismatches).toEqual([])
  }, PARITY_TIMEOUT_MS)

  it('keeps TypeScript tagged templates after Vue and Markdown loaded',
    async () => {
      expect(await compareAfterContamination()).toBe(true)
    }, PARITY_TIMEOUT_MS)

  it('colours fences of languages the web bundle did not ship', async () => {
    const { eagerTokens, lazyTokens } = await compareImprovement()

    expect(eagerTokens).toBe(1)
    expect(lazyTokens).toBeGreaterThan(1)
  }, PARITY_TIMEOUT_MS)
})

describe('code highlighter pool', () => {
  it('resolves aliases to one highlighter per root language', async () => {
    const pool = createLazyPool()
    const short = await pool.load('ts', 'const a = 1')
    const long = await pool.load('TypeScript', 'const b = 2')

    expect(short.language).toBe('typescript')
    expect(long.highlighter).toBe(short.highlighter)
  })

  it('falls back to plain text for unknown or missing languages', async () => {
    const pool = createLazyPool()

    expect((await pool.load('no-such-language', 'x')).language)
      .toBe(PLAIN_CODE_LANGUAGE)
    expect((await pool.load(undefined, 'x')).language)
      .toBe(PLAIN_CODE_LANGUAGE)
  })

  it('rebuilds a root highlighter when the code names a new embed',
    async () => {
      const pool = createLazyPool()
      const before = await pool.load('markdown', '# Title')
      const cutFence = await pool.load('markdown', '# Title\n```jav')
      const after = await pool.load('markdown', '```python\nprint(1)\n```')
      const again = await pool.load('markdown', '```py\nprint(2)\n```')

      expect(cutFence.highlighter).toBe(before.highlighter)
      expect(after.highlighter).not.toBe(before.highlighter)
      expect(again.highlighter).toBe(after.highlighter)
    })

  it('finds fence, attribute, filter and frontmatter languages', () => {
    const code = [
      '---',
      'title: x',
      '---',
      '```TS {1}',
      '~~~ python',
      '<style lang="scss">',
      '  :markdown',
    ].join('\n')

    expect([...findEmbeddedLanguageCandidates(code)].sort())
      .toEqual(['markdown', 'python', 'scss', 'ts', 'yaml'])
  })
})

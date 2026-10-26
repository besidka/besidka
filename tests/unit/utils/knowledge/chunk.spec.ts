import { describe, expect, it } from 'vitest'
import { countKnowledgeChars, estimateKnowledgeTextTokens } from '#shared/utils/project-knowledge-budget'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import { chunkKnowledgeText } from '~~/server/utils/knowledge/chunk'

const TARGET = KNOWLEDGE_LIMITS.chunkTargetTokens

function chunk(text: string, overrides: {
  title?: string
  relativePath?: string | null
} = {}) {
  return chunkKnowledgeText({
    itemId: 'item-1',
    title: overrides.title ?? 'Guide',
    relativePath: overrides.relativePath ?? null,
    text,
  })
}

function tokensOf(text: string): number {
  return estimateKnowledgeTextTokens(countKnowledgeChars(text), 'default')
}

function withoutWhitespace(text: string): string {
  return text.replace(/\s+/g, '')
}

function joined(lines: ReturnType<typeof chunk>): string {
  return lines.map((line) => {
    return line.text
  }).join('')
}

function expectLossless(input: string, lines: ReturnType<typeof chunk>) {
  expect(withoutWhitespace(joined(lines))).toBe(withoutWhitespace(input))
}

function expectWellFormed(lines: ReturnType<typeof chunk>) {
  lines.forEach((line, index) => {
    expect(line.type).toBe('chunk')
    expect(line.itemId).toBe('item-1')
    expect(line.ordinal).toBe(index)
    expect(line.text.trim()).not.toBe('')
    expect(tokensOf(line.text)).toBeLessThanOrEqual(TARGET)
  })
}

function createSeededRandom(seed: number) {
  let state = seed

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296

    return state / 4_294_967_296
  }
}

describe('chunkKnowledgeText', () => {
  describe('basics', () => {
    it('returns no chunks for empty or whitespace-only text', () => {
      expect(chunk('')).toEqual([])
      expect(chunk('   \n\n\t  \n')).toEqual([])
    })

    it('keeps short text as one chunk with ordinal 0', () => {
      const lines = chunk('Just a short note.')

      expect(lines).toEqual([{
        type: 'chunk',
        itemId: 'item-1',
        ordinal: 0,
        breadcrumb: 'Guide',
        text: 'Just a short note.',
      }])
    })

    it('uses the relative path instead of the title in the breadcrumb', () => {
      const lines = chunk('Body', { relativePath: 'docs/guide.md' })

      expect(lines[0]!.breadcrumb).toBe('docs/guide.md')
    })

    it('trims leading blank lines and trailing whitespace only', () => {
      const lines = chunk('\n\n  Indented start\n\n\n')

      expect(lines[0]!.text).toBe('  Indented start')
    })
  })

  describe('headings and breadcrumbs', () => {
    it('adds the heading path to the breadcrumb', () => {
      const text = [
        '# Setup',
        '',
        'Install the tool.',
        '',
        '## Linux',
        '',
        'Use the package manager.',
      ].join('\n')
      const lines = chunk(text)

      expect(lines).toHaveLength(1)
      expect(lines[0]!.breadcrumb).toBe('Guide › Setup')
    })

    it('splits oversized sections at headings and tracks H1 and H2', () => {
      const filler = 'Lorem ipsum dolor sit amet. '.repeat(40)
      const text = [
        '# Setup',
        '',
        filler,
        '',
        '## Linux',
        '',
        filler,
        '',
        '## Windows',
        '',
        filler,
        '',
        '# Usage',
        '',
        filler,
      ].join('\n')
      const lines = chunk(text)
      const breadcrumbs = lines.map((line) => {
        return line.breadcrumb
      })

      expect(breadcrumbs).toContain('Guide › Setup')
      expect(breadcrumbs).toContain('Guide › Setup › Linux')
      expect(breadcrumbs).toContain('Guide › Setup › Windows')
      expect(breadcrumbs).toContain('Guide › Usage')
      expect(breadcrumbs).not.toContain('Guide › Usage › Windows')
      expectLossless(text, lines)
      expectWellFormed(lines)
    })

    it('starts an oversized section in a fresh chunk', () => {
      const filler = 'Lorem ipsum dolor sit amet. '.repeat(40)
      const text = `Intro paragraph.\n\n# Big\n\n${filler}\n\n${filler}`
      const lines = chunk(text)

      expect(lines[0]!.text).toBe('Intro paragraph.')
      expect(lines[1]!.text.startsWith('# Big')).toBe(true)
    })

    it('does not leave a heading stranded at the end of a chunk', () => {
      const filler = 'Word '.repeat(300)
      const text = `${filler}\n\n## Next topic\n\nBody of the next topic.`
      const lines = chunk(text)

      for (const line of lines) {
        expect(line.text.trimEnd().endsWith('## Next topic')).toBe(false)
      }

      expectLossless(text, lines)
    })

    it('ignores heading-like lines inside fenced blocks', () => {
      const text = [
        '# Real',
        '',
        '```bash',
        '# not a heading',
        '```',
        '',
        'After.',
      ].join('\n')
      const lines = chunk(text)

      expect(lines).toHaveLength(1)
      expect(lines[0]!.text).toContain('# not a heading')
    })

    it('does not treat a very long hash line as a heading', () => {
      const text = `# ${'a'.repeat(5_000)}\n\nBody`
      const lines = chunk(text)

      expect(lines.length).toBeGreaterThan(0)
      expectLossless(text, lines)
    })

    it('removes closing hashes and caps long heading text', () => {
      const longHeading = 'H'.repeat(200)
      const text = `## Title ##\n\n${'x '.repeat(900)}\n\n# ${longHeading}\n\n${'y '.repeat(900)}`
      const breadcrumbs = chunk(text).map((line) => {
        return line.breadcrumb
      })

      expect(breadcrumbs).toContain('Guide › Title')
      expect(breadcrumbs.some((breadcrumb) => {
        return breadcrumb === `Guide › ${'H'.repeat(80)}`
      })).toBe(true)
    })
  })

  describe('fenced blocks', () => {
    it('keeps a fitting fenced block whole', () => {
      const code = ['```ts', 'const a = 1', '', 'const b = 2', '```'].join('\n')
      const prose = 'Sentence one is here. '.repeat(70)
      const text = `${prose}\n\n${code}\n\n${prose}`
      const lines = chunk(text)
      const holder = lines.find((line) => {
        return line.text.includes('const a = 1')
      })

      expect(holder!.text).toContain('const b = 2')
      expect(holder!.text).toContain('```ts')
      expect(holder!.text.trimEnd().endsWith('```')).toBe(true)
      expectLossless(text, lines)
    })

    it('splits an oversized fenced block at line boundaries', () => {
      const codeLines = Array.from({ length: 400 }, (_value, index) => {
        return `const value${index} = ${index} * 2`
      })
      const text = ['```js', ...codeLines, '```'].join('\n')
      const lines = chunk(text)

      expect(lines.length).toBeGreaterThan(1)

      for (const line of lines) {
        for (const codeLine of line.text.split('\n')) {
          expect(
            codeLine === '```js'
            || codeLine === '```'
            || /^const value\d+ = \d+ \* 2$/.test(codeLine),
          ).toBe(true)
        }
      }

      expectLossless(text, lines)
      expectWellFormed(lines)
    })

    it('treats an unterminated fence as one block to the end', () => {
      const text = `Intro\n\n\`\`\`py\nprint(1)\n\n\n# still code\nprint(2)`
      const lines = chunk(text)

      expect(lines.map((line) => {
        return line.breadcrumb
      })).toEqual(['Guide'])
      expectLossless(text, lines)
    })

    it('closes a tilde fence only with tildes', () => {
      const text = '~~~\n```\n# inside\n~~~\n\n# After\n\nBody'
      const lines = chunk(text)

      expect(lines[0]!.text).toContain('# inside')
      expectLossless(text, lines)
    })
  })

  describe('long and unusual text', () => {
    it('splits long prose into chunks within the token target', () => {
      const text = Array.from({ length: 60 }, (_value, index) => {
        return `Paragraph ${index} says something fairly ordinary about the topic. `
          .repeat(8)
      }).join('\n\n')
      const lines = chunk(text)

      expect(lines.length).toBeGreaterThan(3)
      expectLossless(text, lines)
      expectWellFormed(lines)
    })

    it('splits an oversized paragraph at sentence boundaries', () => {
      const sentences = Array.from({ length: 200 }, (_value, index) => {
        return `This is sentence number ${index}.`
      })
      const text = sentences.join(' ')
      const lines = chunk(text)

      expect(lines.length).toBeGreaterThan(1)

      for (const line of lines) {
        expect(line.text.trimEnd().endsWith('.')).toBe(true)
      }

      expectLossless(text, lines)
      expectWellFormed(lines)
    })

    it('handles a single enormous line without spaces', () => {
      const text = 'abcdefghij'.repeat(30_000)
      const lines = chunk(text)

      expect(lines.length).toBeGreaterThan(100)
      expect(joined(lines)).toBe(text)
      expectWellFormed(lines)
    })

    it('handles a single enormous line of words', () => {
      const text = Array.from({ length: 80_000 }, (_value, index) => {
        return `w${index}`
      }).join(' ')
      const lines = chunk(text)

      expectLossless(text, lines)
      expectWellFormed(lines)
    })

    it('handles pure Cyrillic text within the target by its own rate', () => {
      const sentence = 'Це доволі довге українське речення про щось важливе. '
      const text = sentence.repeat(300)
      const lines = chunk(text)

      expect(lines.length).toBeGreaterThan(5)
      expectLossless(text, lines)
      expectWellFormed(lines)

      for (const line of lines.slice(0, -1)) {
        expect(tokensOf(line.text)).toBeGreaterThan(TARGET * 0.7)
      }
    })

    it('handles one enormous Cyrillic line without losing a character', () => {
      const text = 'щоденнийжурнал'.repeat(20_000)
      const lines = chunk(text)

      expect(joined(lines)).toBe(text)
      expectWellFormed(lines)
    })

    it('never splits a surrogate pair', () => {
      const text = '😀'.repeat(40_000)
      const lines = chunk(text)

      expect(joined(lines)).toBe(text)
      expectWellFormed(lines)

      for (const line of lines) {
        expect(line.text.isWellFormed()).toBe(true)
      }
    })

    it('handles CRLF line endings', () => {
      const text = '# Title\r\n\r\nFirst paragraph.\r\n\r\n```\r\ncode\r\n```\r\n'
      const lines = chunk(text)

      expect(lines).toHaveLength(1)
      expectLossless(text, lines)
    })

    it('stays fast on a huge whitespace-only run inside text', () => {
      const text = `start${' '.repeat(500_000)}end`
      const startedAt = Date.now()
      const lines = chunk(text)

      expect(Date.now() - startedAt).toBeLessThan(3_000)
      expect(withoutWhitespace(joined(lines))).toBe('startend')
    })

    it('is deterministic', () => {
      const text = '# A\n\nSome text. More text.\n\n## B\n\nEven more text.'

      expect(chunk(text)).toEqual(chunk(text))
    })

    it('never overlaps: each character run appears once', () => {
      const text = Array.from({ length: 500 }, (_value, index) => {
        return `unique-token-${index}`
      }).join(' ')
      const lines = chunk(text)
      const seen = joined(lines).match(/unique-token-\d+/g) ?? []

      expect(new Set(seen).size).toBe(500)
      expect(seen).toHaveLength(500)
    })
  })

  describe('property: no character is lost or duplicated', () => {
    const alphabets = [
      'abcdefghij .,!?\n',
      'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя .,!?\n',
      'aб字😀 .\n\t#`~',
      '# \n`~.!? abc',
    ]

    it.each(alphabets.map((alphabet, index) => {
      return { alphabet, seed: index + 1 }
    }))('reproduces random text over "$alphabet"', ({ alphabet, seed }) => {
      const random = createSeededRandom(seed)
      const characters = [...alphabet]

      for (let round = 0; round < 25; round++) {
        const length = Math.floor(random() * 6_000)
        let text = ''

        for (let index = 0; index < length; index++) {
          text += characters[Math.floor(random() * characters.length)]
        }

        const lines = chunk(text)

        expect(withoutWhitespace(joined(lines)))
          .toBe(withoutWhitespace(text))
        expectWellFormed(lines)
      }
    })
  })
})

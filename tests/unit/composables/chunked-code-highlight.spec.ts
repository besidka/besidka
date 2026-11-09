import { describe, expect, it } from 'vitest'
import type { ThemedToken } from 'shiki/core'
import {
  CODE_BLOCK_LINE_COUNT,
  toBlockTokens,
  toPlainCodeBlocks,
} from '../../../app/composables/chunked-code-highlight'

function createLines(count: number): string[] {
  return Array.from({ length: count }, (_line, index) => {
    return `line ${index}`
  })
}

function createToken(
  content: string,
  token: Partial<ThemedToken> = {},
): ThemedToken {
  return { content, offset: 0, ...token }
}

describe('composables/chunked-code-highlight', () => {
  describe('toPlainCodeBlocks', () => {
    it('splits code into blocks whose text joins back to the source', () => {
      const code = createLines(CODE_BLOCK_LINE_COUNT * 2 + 7).join('\n')
      const blocks = toPlainCodeBlocks(code)

      expect(blocks).toHaveLength(3)
      expect(blocks.map((block) => {
        return block.lineCount
      })).toEqual([CODE_BLOCK_LINE_COUNT, CODE_BLOCK_LINE_COUNT, 7])
      expect(blocks.map((block) => {
        return block.key
      })).toEqual([0, 1, 2])
      expect(blocks.map((block) => {
        return block.text
      }).join('')).toBe(code)
      expect(blocks[0]!.text.endsWith('\n')).toBe(true)
      expect(blocks[2]!.text.endsWith('\n')).toBe(false)
      expect(blocks.every((block) => {
        return block.tokens === null
      })).toBe(true)
    })

    it('keeps a trailing newline and blank lines', () => {
      const code = `${createLines(CODE_BLOCK_LINE_COUNT - 1).join('\n')}\n\n`
      const blocks = toPlainCodeBlocks(code)

      expect(blocks).toHaveLength(2)
      expect(blocks[1]!.lineCount).toBe(1)
      expect(blocks[1]!.text).toBe('')
      expect(blocks.map((block) => {
        return block.text
      }).join('')).toBe(code)
    })

    it('returns one empty block for empty code', () => {
      expect(toPlainCodeBlocks('')).toEqual([
        { key: 0, lineCount: 1, text: '', tokens: null },
      ])
    })
  })

  describe('toBlockTokens', () => {
    it('flattens token lines with newline tokens between them', () => {
      const tokens = toBlockTokens([
        [
          createToken('const', { color: '#ff0000', fontStyle: 1 }),
          createToken(' a'),
        ],
        [],
        [createToken('a', { color: '#00ff00', fontStyle: 2 })],
      ], false)

      expect(tokens).toEqual([
        { content: 'const', style: 'color:#ff0000;font-style:italic' },
        { content: ' a', style: undefined },
        { content: '\n', style: undefined },
        { content: '\n', style: undefined },
        { content: 'a', style: 'color:#00ff00;font-weight:bold' },
      ])
    })

    it('ends with a newline token when the block is not the last one', () => {
      const tokens = toBlockTokens([[createToken('x')]], true)

      expect(tokens.map((token) => {
        return token.content
      }).join('')).toBe('x\n')
    })
  })
})

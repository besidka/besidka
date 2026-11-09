import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import CodeStream from '../../../../app/components/prose/CodeStream.vue'
import {
  CODE_THEME_DARK,
  CODE_THEME_LIGHT,
} from '../../../../app/utils/code-highlight'
import {
  highlightCode,
  loadCodeHighlighter,
} from '../../../../app/composables/md-syntax-highlighter'

const SHORT_BLOCK = [
  'import { css } from \'lit\'',
  '',
  'export const styles = css`',
  '  :host { color: var(--accent); }',
  '`',
  'const total: number = [1, 2, 3].reduce((sum, value) => sum + value, 0)',
].join('\n')

const LONG_BLOCK_SECTIONS = 75

const MIN_CHUNK_LENGTH = 20

const MAX_CHUNK_LENGTH = 50

function createLongBlock(): string {
  const lines: string[] = []

  for (let index = 0; index < LONG_BLOCK_SECTIONS; index++) {
    lines.push(
      `/** Section ${index}: "quoted" and \`ticked\` text. */`,
      `export interface Item${index}<T = string> { id: number; value: T }`,
      `export async function load${index}(id: number): Promise<Item${index}> {`,
      `  const query = sql\`SELECT * FROM items WHERE id = \${id}\``,
      `  const pattern = /^item-${index}-\\d+$/u`,
      `  return { id, value: \`#\${id} of ${index}\` } // trailing comment`,
      '}',
      '',
    )
  }

  return lines.join('\n').trimEnd()
}

function splitIntoChunks(code: string): string[] {
  let seed = 42

  function random(): number {
    seed = (seed * 1103515245 + 12345) % 2147483648

    return seed / 2147483648
  }

  const chunks: string[] = []

  for (let index = 0; index < code.length;) {
    const length = MIN_CHUNK_LENGTH
      + Math.floor(random() * (MAX_CHUNK_LENGTH - MIN_CHUNK_LENGTH + 1))

    chunks.push(code.slice(index, index + length))
    index += length
  }

  return chunks
}

function getLineElements(wrapper: VueWrapper): HTMLElement[] {
  return [...wrapper.element.querySelectorAll<HTMLElement>('code > span')]
}

function getCodeText(wrapper: VueWrapper): string {
  return wrapper.get('[data-testid="shiki-code"]').element.textContent ?? ''
}

function describeSpans(wrapper: VueWrapper): string[][] {
  return getLineElements(wrapper).map((line) => {
    return [...line.querySelectorAll('span')].map((span) => {
      return `${span.textContent}|${span.style.color}`
    })
  })
}

async function describeTokens(
  code: string,
  language: string,
  theme: string,
): Promise<string[][]> {
  const tokens = await highlightCode(code, language, theme)

  return tokens.map((line) => {
    return line.map((token) => {
      const probe = document.createElement('span')

      probe.style.color = token.color ?? ''

      return `${token.content}|${probe.style.color}`
    })
  })
}

async function mountStream(
  code: string,
  language: string,
  theme: string = CODE_THEME_DARK,
): Promise<VueWrapper> {
  return mountSuspended(CodeStream, { props: { code, language, theme } })
}

async function waitForHighlight(wrapper: VueWrapper, code: string) {
  await vi.waitFor(() => {
    expect(wrapper.get('[data-testid="code-stream"]')
      .attributes('data-highlighted')).toBe('true')
    expect(getCodeText(wrapper)).toBe(code)
  }, { timeout: 15000 })
}

describe('prose/CodeStream.vue', () => {
  it('shows plain lines before the highlighter is ready', async () => {
    const wrapper = await mountStream(SHORT_BLOCK, 'typescript')

    expect(getCodeText(wrapper)).toBe(SHORT_BLOCK)
    expect(getLineElements(wrapper)).toHaveLength(6)
  })

  it('colours a finished block exactly like codeToTokens', async () => {
    const wrapper = await mountStream(SHORT_BLOCK, 'typescript')

    await waitForHighlight(wrapper, SHORT_BLOCK)

    expect(describeSpans(wrapper)).toEqual(
      await describeTokens(SHORT_BLOCK, 'typescript', CODE_THEME_DARK),
    )
  })

  it('recolours every line for the other theme', async () => {
    const wrapper = await mountStream(SHORT_BLOCK, 'ts')

    await waitForHighlight(wrapper, SHORT_BLOCK)
    await wrapper.setProps({ theme: CODE_THEME_LIGHT })
    await vi.waitFor(async () => {
      expect(describeSpans(wrapper)).toEqual(
        await describeTokens(SHORT_BLOCK, 'typescript', CODE_THEME_LIGHT),
      )
    }, { timeout: 15000 })
  })

  it('renders an unknown language as plain text in the theme colour',
    async () => {
      const code = 'just some words\nand more'
      const wrapper = await mountStream(code, 'no-such-language')

      await waitForHighlight(wrapper, code)

      expect(describeSpans(wrapper)).toEqual(
        await describeTokens(code, 'text', CODE_THEME_DARK),
      )
    })

  it('starts over when the code changes other than by appending',
    async () => {
      const wrapper = await mountStream(SHORT_BLOCK, 'typescript')

      await waitForHighlight(wrapper, SHORT_BLOCK)

      const firstLine = getLineElements(wrapper)[0]
      const edited = SHORT_BLOCK.replace('3].reduce', '4].reduce')

      await wrapper.setProps({ code: edited })
      await waitForHighlight(wrapper, edited)

      expect(describeSpans(wrapper)).toEqual(
        await describeTokens(edited, 'typescript', CODE_THEME_DARK),
      )
      expect(getLineElements(wrapper)[0]).toBe(firstLine)
    })

  it('streams a long block without touching finished lines', async () => {
    const code = createLongBlock()
    const chunks = splitIntoChunks(code)
    const { highlighter } = await loadCodeHighlighter('typescript', code)
    const codeToTokens = vi.spyOn(highlighter, 'codeToTokens')
    const wrapper = await mountStream('', 'typescript')
    const codeElement = wrapper.get('[data-testid="shiki-code"]').element
    const mutatedLines = new Set<number>()

    function recordMutations(records: MutationRecord[]) {
      const lineElements = getLineElements(wrapper)

      for (const record of records) {
        const target = record.target instanceof Element
          ? record.target
          : record.target.parentElement
        const line = target?.closest<HTMLElement>('code > span')

        if (line) {
          mutatedLines.add(lineElements.indexOf(line))
        }
      }
    }

    const observer = new MutationObserver(recordMutations)

    await waitForHighlight(wrapper, '')

    let source = ''
    let totalCalls = 0

    observer.observe(codeElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })

    for (const chunk of chunks) {
      const finishedBefore = source.split('\n').length - 1
      const finishedElements = getLineElements(wrapper)
        .slice(0, finishedBefore)
      const finishedMarkup = finishedElements.map((line) => {
        return line.innerHTML
      })

      codeToTokens.mockClear()
      mutatedLines.clear()
      source += chunk

      await wrapper.setProps({ code: source })
      await flushPromises()
      await vi.waitFor(() => {
        expect(getCodeText(wrapper)).toBe(source)
      })
      recordMutations(observer.takeRecords())

      const newlines = chunk.split('\n').length - 1

      totalCalls += codeToTokens.mock.calls.length
      expect(codeToTokens.mock.calls.length).toBeLessThanOrEqual(newlines + 1)
      const lineElements = getLineElements(wrapper)

      expect(finishedElements.every((line, index) => {
        return lineElements[index] === line
      })).toBe(true)
      expect(finishedElements.map((line) => {
        return line.innerHTML
      })).toEqual(finishedMarkup)

      for (const lineIndex of mutatedLines) {
        expect(lineIndex === -1 || lineIndex >= finishedBefore).toBe(true)
      }
    }

    observer.disconnect()

    expect(chunks.length).toBeGreaterThan(400)
    expect(totalCalls).toBeLessThanOrEqual(
      chunks.length + code.split('\n').length,
    )
    expect(describeSpans(wrapper)).toEqual(
      await describeTokens(code, 'typescript', CODE_THEME_DARK),
    )
  }, 120000)
})

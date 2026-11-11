import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import CodeView from '../../../../../app/components/Chat/Artifact/CodeView.client.vue'
import {
  CODE_THEME_LIGHT,
  getCodeTokenStyle,
} from '../../../../../app/utils/code-highlight'
import { highlightCode } from '../../../../../app/composables/md-syntax-highlighter'
import {
  CODE_BLOCK_LINE_COUNT,
  clearCodeHighlightCache,
} from '../../../../../app/composables/chunked-code-highlight'

enableAutoUnmount(afterEach)

beforeEach(() => {
  clearCodeHighlightCache()
})

function createReactSource(lineCount: number): string {
  const lines = [
    'import { useState } from \'react\'',
    '',
    'export default function Quiz() {',
    '  const [score, setScore] = useState(0)',
    '  const note = `multi-line template',
    '  still inside the template ${score}`',
    '  return (',
    '    <main className="quiz">',
  ]

  while (lines.length < lineCount - 3) {
    lines.push(`      <button onClick={() => setScore(score + ${lines.length})}>"${lines.length}"</button>`)
  }

  lines.push('    </main>', '  )', '}')

  return lines.join('\n')
}

function getView(wrapper: VueWrapper) {
  return wrapper.get('[data-testid="artifact-code-view"]')
}

async function waitForHighlight(wrapper: VueWrapper) {
  for (let attempt = 0; attempt < 400; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5))
    await flushPromises()

    if (getView(wrapper).attributes('data-highlighted') === 'true') {
      return
    }
  }

  throw new Error('code was never highlighted')
}

function normalizeStyle(style: string | undefined): string {
  return (style ?? '').replace(/\s+/g, '').replace(/;$/, '').toLowerCase()
}

function readTokens(wrapper: VueWrapper): string[] {
  return wrapper.findAll('[data-testid="artifact-code-block"] > span')
    .map((span) => {
      return {
        text: span.element.textContent ?? '',
        style: normalizeStyle(span.attributes('style')),
      }
    })
    .filter((token) => {
      return token.text !== '' && token.text !== '\n'
    })
    .map((token) => {
      return `${token.text}|${token.style}`
    })
}

async function readExpectedTokens(code: string): Promise<string[]> {
  const lines = await highlightCode(code, 'jsx', CODE_THEME_LIGHT)

  return lines.flat().filter((token) => {
    return token.content !== ''
  }).map((token) => {
    const style = getCodeTokenStyle(token)
    const text = style
      ? Object.entries(style).map(([property, value]) => {
        return `${property}:${value}`
      }).join(';')
      : ''

    return `${token.content}|${normalizeStyle(text)}`
  })
}

describe('Chat/Artifact/CodeView.client', () => {
  it('shows the plain source at once, then colours it block by block', async () => {
    const code = createReactSource(260)
    const wrapper = await mountSuspended(CodeView, {
      props: { code, language: 'jsx' },
    })
    const blocks = wrapper.findAll('[data-testid="artifact-code-block"]')

    expect(getView(wrapper).attributes('data-highlighted')).toBe('false')
    expect(getView(wrapper).element.textContent).toBe(code)
    expect(blocks).toHaveLength(Math.ceil(260 / CODE_BLOCK_LINE_COUNT))
    expect(blocks[0]!.attributes('style'))
      .toContain(`${CODE_BLOCK_LINE_COUNT}lh`)

    await waitForHighlight(wrapper)

    expect(getView(wrapper).element.textContent).toBe(code)
    expect(readTokens(wrapper)).toEqual(await readExpectedTokens(code))
    expect(readTokens(wrapper).some((token) => {
      return token.includes('color')
    })).toBe(true)
  })

  it('reuses the colours when the same version opens again', async () => {
    const code = createReactSource(120)
    const first = await mountSuspended(CodeView, {
      props: { code, language: 'jsx', cacheKey: 'artifact:1' },
    })

    await waitForHighlight(first)
    first.unmount()

    const second = await mountSuspended(CodeView, {
      props: { code, language: 'jsx', cacheKey: 'artifact:1' },
    })

    expect(getView(second).attributes('data-highlighted')).toBe('true')
    expect(getView(second).element.textContent).toBe(code)
  })

  it('replays cached colours over several frames for a long version',
    async () => {
      const code = createReactSource(CODE_BLOCK_LINE_COUNT * 8)
      const first = await mountSuspended(CodeView, {
        props: { code, language: 'jsx', cacheKey: 'artifact:2' },
      })

      await waitForHighlight(first)

      const expected = readTokens(first)

      first.unmount()

      const second = await mountSuspended(CodeView, {
        props: { code, language: 'jsx', cacheKey: 'artifact:2' },
      })
      const firstBlock = second.get('[data-testid="artifact-code-block"]')

      expect(firstBlock.find('span').exists()).toBe(true)

      await waitForHighlight(second)

      expect(readTokens(second)).toEqual(expected)
      expect(getView(second).element.textContent).toBe(code)
    })

  it('does not reuse colours cached for other code under the same key',
    async () => {
      const code = createReactSource(120)
      const first = await mountSuspended(CodeView, {
        props: { code, language: 'jsx', cacheKey: 'artifact:1' },
      })

      await waitForHighlight(first)
      first.unmount()

      const otherCode = `${code}\n// edited`
      const second = await mountSuspended(CodeView, {
        props: { code: otherCode, language: 'jsx', cacheKey: 'artifact:1' },
      })

      expect(getView(second).attributes('data-highlighted')).toBe('false')
      expect(getView(second).element.textContent).toBe(otherCode)

      await waitForHighlight(second)

      expect(getView(second).element.textContent).toBe(otherCode)
    })

  it('shows the new source as plain text when the code changes', async () => {
    const wrapper = await mountSuspended(CodeView, {
      props: { code: createReactSource(80), language: 'jsx' },
    })

    await waitForHighlight(wrapper)

    const nextCode = createReactSource(140)

    await wrapper.setProps({ code: nextCode })

    expect(getView(wrapper).attributes('data-highlighted')).toBe('false')
    expect(getView(wrapper).element.textContent).toBe(nextCode)

    await waitForHighlight(wrapper)

    expect(readTokens(wrapper)).toEqual(await readExpectedTokens(nextCode))
  })
})

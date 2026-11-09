import { describe, expect, it, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import CodeView from '../../../../../app/components/Chat/Artifact/CodeView.client.vue'
import { CODE_THEME_LIGHT } from '../../../../../app/utils/code-highlight'
import { highlightCode } from '../../../../../app/composables/md-syntax-highlighter'

enableAutoUnmount(afterEach)

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

async function waitForHighlight(wrapper: VueWrapper) {
  for (let attempt = 0; attempt < 400; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5))
    await flushPromises()

    if (wrapper.get('[data-testid="artifact-code-view"]')
      .attributes('data-highlighted') === 'true') {
      return
    }
  }

  throw new Error('code was never highlighted')
}

function readColours(wrapper: VueWrapper): string[][] {
  return wrapper.findAll('code > span').map((line) => {
    return line.findAll('span').map((span) => {
      return `${span.text()}|${span.attributes('style') ?? ''}`
    })
  })
}

describe('Chat/Artifact/CodeView.client', () => {
  it('shows the plain source at once, then colours it in chunks', async () => {
    const code = createReactSource(260)
    const wrapper = await mountSuspended(CodeView, {
      props: { code, language: 'jsx' },
    })
    const view = wrapper.get('[data-testid="artifact-code-view"]')

    expect(view.attributes('data-highlighted')).toBe('false')
    expect(view.text()).toBe(code)

    await waitForHighlight(wrapper)

    expect(wrapper.get('[data-testid="artifact-code-view"]').text()).toBe(code)

    const whole = await highlightCode(code, 'jsx', CODE_THEME_LIGHT)
    const colours = readColours(wrapper)

    expect(colours).toHaveLength(whole.length)
    expect(colours.map(line => line.length))
      .toEqual(whole.map(line => line.length))
    expect(colours[5]?.some(token => token.includes('color'))).toBe(true)
  })

  it('reuses the colours when the same version opens again', async () => {
    const code = createReactSource(120)
    const first = await mountSuspended(CodeView, {
      props: { code, language: 'jsx' },
    })

    await waitForHighlight(first)
    first.unmount()

    const second = await mountSuspended(CodeView, {
      props: { code, language: 'jsx' },
    })

    expect(second.get('[data-testid="artifact-code-view"]')
      .attributes('data-highlighted')).toBe('true')
  })
})

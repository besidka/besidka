import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import PreStream from '../../../../app/components/prose/PreStream.vue'
import { markdownSourceKey } from '../../../../app/composables/markdown-source'
import type { MarkdownSourceContext } from '../../../../app/composables/markdown-source'

const mocks = vi.hoisted(() => {
  return {
    copy: vi.fn(),
    renderAsync: vi.fn(),
  }
})

mockNuxtImport('useHighlighter', () => {
  return async () => {
    return { getLoadedLanguages: () => [] as string[] }
  }
})

mockNuxtImport('useClipboard', () => {
  return () => {
    return { copy: mocks.copy }
  }
})

vi.mock('pele/lazy', async () => {
  const actual = await vi.importActual<typeof import('pele/lazy')>(
    'pele/lazy',
  )

  return { ...actual, renderAsync: mocks.renderAsync }
})

vi.mock('shiki-stream/vue', async () => {
  const { defineComponent, h } = await import('vue')

  return {
    ShikiCachedRenderer: defineComponent({
      props: {
        code: { type: String, default: '' },
        lang: { type: String, default: '' },
        theme: { type: String, default: '' },
        highlighter: { type: Object, default: null },
      },
      setup(props) {
        return () => {
          return h('code', { 'data-testid': 'shiki-code' }, props.code)
        }
      },
    }),
  }
})

const VALID_DIAGRAM = 'flowchart LR\n  A[Start] --> B[Done]\n  B --> C[End]'
const INVALID_DIAGRAM = 'flowchart LR\n  A[Start --> B\n  B --> C'

async function mountPre(
  code: string,
  options: {
    language?: string
    context?: MarkdownSourceContext
  } = {},
): Promise<VueWrapper> {
  const provide: Record<symbol, () => MarkdownSourceContext> = {}

  if (options.context) {
    const context = options.context

    provide[markdownSourceKey as symbol] = () => context
  }

  return mountSuspended(PreStream, {
    props: {
      code,
      language: options.language ?? 'mermaid',
    },
    global: { provide },
  })
}

function findButton(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find((button) => {
    return button.text().includes(text)
  })
}

async function waitForDiagram(wrapper: VueWrapper): Promise<void> {
  await vi.waitFor(() => {
    expect(
      wrapper.find('[data-testid="mermaid-diagram"] svg').exists(),
    ).toBe(true)
  })
}

describe('prose/PreStream.vue mermaid', () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('pele/lazy')>(
      'pele/lazy',
    )

    mocks.renderAsync.mockImplementation(actual.renderAsync)
  })

  it('renders a valid complete diagram as an svg', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)

    expect(wrapper.find('[data-testid="shiki-code"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mermaid-error"]').exists()).toBe(false)
    expect(mocks.renderAsync).toHaveBeenCalledTimes(1)
  })

  it('copies the diagram source rather than the svg', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)
    await findButton(wrapper, 'Copy')!.trigger('click')

    expect(mocks.copy).toHaveBeenCalledWith(VALID_DIAGRAM)
  })

  it('hides the expand button and the height clamp in diagram view',
    async () => {
      const wrapper = await mountPre(VALID_DIAGRAM)

      await waitForDiagram(wrapper)

      expect(findButton(wrapper, 'Expand')).toBeUndefined()
      expect(wrapper.html()).not.toContain('max-h-30')

      await wrapper.get('[data-testid="mermaid-toggle"]').trigger('click')

      expect(findButton(wrapper, 'Expand')).toBeDefined()
      expect(wrapper.html()).toContain('max-h-30')
    })

  it('falls back to the code block with an error note on invalid syntax',
    async () => {
      const wrapper = await mountPre(INVALID_DIAGRAM)

      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="mermaid-error"]').exists())
          .toBe(true)
      })

      expect(wrapper.get('[data-testid="mermaid-error"]').text())
        .toContain('Couldn\'t render diagram')
      expect(wrapper.get('[data-testid="mermaid-error"]').text())
        .toMatch(/\(line \d+/)
      expect(wrapper.find('[data-testid="mermaid-diagram"]').exists())
        .toBe(false)
      expect(wrapper.get('[data-testid="shiki-code"]').text())
        .toBe(INVALID_DIAGRAM)
      expect(wrapper.find('[data-testid="mermaid-toggle"]').exists())
        .toBe(false)
    })

  it('clears the error note and renders once the code becomes valid',
    async () => {
      const wrapper = await mountPre(INVALID_DIAGRAM)

      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="mermaid-error"]').exists())
          .toBe(true)
      })

      await wrapper.setProps({ code: VALID_DIAGRAM })
      await waitForDiagram(wrapper)

      expect(wrapper.find('[data-testid="mermaid-error"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="shiki-code"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="mermaid-toggle"]').exists())
        .toBe(true)
    })

  it('truncates a very long error message', async () => {
    mocks.renderAsync.mockRejectedValueOnce(new Error('x'.repeat(500)))

    const wrapper = await mountPre('flowchart LR\n  LongError --> B')

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="mermaid-error"]').exists())
        .toBe(true)
    })

    const text = wrapper.get('[data-testid="mermaid-error"]').text()

    expect(text).toContain(`${'x'.repeat(200)}…`)
    expect(text).not.toContain('x'.repeat(201))
  })

  it('shows plain code and renders nothing while the fence is open',
    async () => {
      const wrapper = await mountPre('flowchart LR\n  A --> B', {
        context: {
          streaming: true,
          source: '```mermaid\nflowchart LR\n  A --> B',
        },
      })

      await flushPromises()

      expect(mocks.renderAsync).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="mermaid-diagram"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="mermaid-toggle"]').exists())
        .toBe(false)
      expect(wrapper.get('[data-testid="shiki-code"]').text())
        .toBe('flowchart LR\n  A --> B')
    })

  it('renders the diagram while streaming once the fence is closed',
    async () => {
      const wrapper = await mountPre('flowchart LR\n  A --> B', {
        context: {
          streaming: true,
          source: '```mermaid\nflowchart LR\n  A --> B\n```\n\nMore text',
        },
      })

      await waitForDiagram(wrapper)
    })

  it('does not render a half-received diagram when the rendered code '
    + 'lags behind a closed fence', async () => {
    const wrapper = await mountPre('flowchart LR\n  A', {
      context: {
        streaming: true,
        source: '```mermaid\nflowchart LR\n  A --> B\n```',
      },
    })

    await flushPromises()

    expect(mocks.renderAsync).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="mermaid-diagram"]').exists())
      .toBe(false)
  })

  it('renders the diagram when streaming ends', async () => {
    const wrapper = await mountPre('flowchart LR\n  A --> B', {
      context: { streaming: false, source: '' },
    })

    await waitForDiagram(wrapper)
  })

  it('toggles between diagram and code views', async () => {
    const wrapper = await mountPre(VALID_DIAGRAM)

    await waitForDiagram(wrapper)

    const toggle = wrapper.get('[data-testid="mermaid-toggle"]')

    expect(toggle.text()).toContain('Code')

    await toggle.trigger('click')

    expect(wrapper.find('[data-testid="mermaid-diagram"]').exists())
      .toBe(false)
    expect(wrapper.get('[data-testid="shiki-code"]').text())
      .toBe(VALID_DIAGRAM)
    expect(wrapper.get('[data-testid="mermaid-toggle"]').text())
      .toContain('Diagram')

    await wrapper.get('[data-testid="mermaid-toggle"]').trigger('click')
    await waitForDiagram(wrapper)

    expect(wrapper.find('[data-testid="shiki-code"]').exists()).toBe(false)
  })

  it('leaves non-mermaid blocks untouched', async () => {
    const wrapper = await mountPre('const answer = 42', {
      language: 'ts',
    })

    await flushPromises()

    expect(mocks.renderAsync).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="mermaid-toggle"]').exists())
      .toBe(false)
    expect(wrapper.get('[data-testid="shiki-code"]').text())
      .toBe('const answer = 42')
  })
})

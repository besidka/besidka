import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { ref, shallowRef } from 'vue'
import type { UIMessage } from 'ai'
import Reasoning from '../../../../app/components/Chat/Reasoning.vue'

const cachedConnectors = ref<unknown>({
  connectors: [{ id: 'conn1', slug: 'notion', title: 'Notion' }],
})

mockNuxtImport('useNuxtData', () => {
  return () => ({ data: cachedConnectors })
})
mockNuxtImport('useConnectorLibrary', () => {
  return () => ({})
})
mockNuxtImport('useUserSetting', () => {
  return () => ({
    reasoningExpanded: shallowRef<boolean>(false),
    reasoningAutoHide: shallowRef<boolean>(true),
  })
})

async function mountMessage(
  parts: unknown[],
  options: {
    isShared?: boolean
    searchProvider?: string
    streaming?: boolean
    reasoningLevel?: string
  } = {},
) {
  const wrapper = await mountSuspended(Reasoning, {
    props: {
      message: {
        id: 'msg-icons',
        role: 'assistant',
        parts,
        metadata: options.searchProvider
          ? { usage: { searchProvider: options.searchProvider } }
          : undefined,
      } as UIMessage,
      status: 'ready',
      reasoningLevel: options.reasoningLevel ?? 'off',
      turnStartedAt: 0,
      reasoningAccumulatedMs: 0,
      reasoningSegmentStartedAt: 0,
      isTurnThinkingHeld: false,
      isShared: options.isShared,
    },
    global: { stubs: { MDCCached: true } },
  })

  if (options.streaming) {
    await wrapper.setProps({ status: 'streaming', isTurnThinkingHeld: true })
  }

  return wrapper
}

function iconRoots(wrapper: Awaited<ReturnType<typeof mountMessage>>) {
  return wrapper.findAll('[data-testid="reasoning-step-icon"]')
}

function done(type: string, toolCallId: string, extra = {}) {
  return {
    type,
    toolCallId,
    state: 'output-available',
    input: {},
    output: {},
    ...extra,
  }
}

describe('Chat/Reasoning step icons', () => {
  it('shows the brand of the search tool that ran', async () => {
    const wrapper = await mountMessage([
      done('tool-web_search_brave', 'a', {
        input: { query: 'x' },
        output: { results: [] },
      }),
      done('tool-web_search_exa', 'b', {
        input: { query: 'y' },
        output: { results: [] },
      }),
    ])
    const providers = wrapper.findAllComponents({ name: 'ProviderIcon' })

    expect(providers.map(icon => icon.props('providerId')))
      .toEqual(['brave', 'exa'])
  })

  it('shows the provider that ran a native search, a globe while unknown', async () => {
    const known = await mountMessage(
      [done('tool-web_search_preview', 'a')],
      { searchProvider: 'anthropic' },
    )
    const unknown = await mountMessage([done('tool-web_search_preview', 'a')])

    expect(known.findComponent({ name: 'ProviderIcon' }).props('providerId'))
      .toBe('anthropic')
    expect(unknown.findComponent({ name: 'ProviderIcon' }).exists())
      .toBe(false)
    expect(iconRoots(unknown)[0]!.findComponent({ name: 'NuxtIcon' })
      .props('name')).toBe('lucide:globe')
  })

  it('shows a document by its file type and names the format', async () => {
    const wrapper = await mountMessage([
      done('tool-create_document', 'a', { input: { format: 'xlsx' } }),
    ])

    expect(wrapper.get('[data-testid="reasoning-step-title"]').text())
      .toBe('Created XLSX')
    expect(iconRoots(wrapper)[0]!.findComponent({ name: 'NuxtIcon' }).props('name'))
      .toBe('lucide:sheet')
  })

  it('shows sparkles for a skill and the memory icon for memory', async () => {
    const wrapper = await mountMessage([
      done('tool-activate_skill', 'a', {
        output: { skillId: 'sk1', name: 'Release notes' },
      }),
      done('tool-memory_list', 'b', { output: { entries: [] } }),
    ])
    const names = iconRoots(wrapper).map((root) => {
      return root.findComponent({ name: 'NuxtIcon' }).props('name')
    })

    expect(names).toEqual(['lucide:sparkles', 'lucide:book-user'])
    expect(wrapper.get('[data-testid="reasoning-skill-step-title"]').text())
      .toContain('Release notes')
  })

  it('shows a connector through the Besidka route', async () => {
    const wrapper = await mountMessage([{
      type: 'dynamic-tool',
      toolName: 'mcp__notion__search_pages',
      toolCallId: 'a',
      state: 'output-available',
      input: {},
      output: 'ok',
    }])

    expect(wrapper.get('[data-testid="reasoning-step-icon-image"]')
      .attributes('src')).toBe('/api/v1/connectors/conn1/icon')
    expect(wrapper.get('[data-testid="reasoning-connector-step-title"]').text())
      .toBe('Used Notion · search_pages')
  })

  it('shows a generic icon for a connector that is no longer known', async () => {
    const wrapper = await mountMessage([{
      type: 'dynamic-tool',
      toolName: 'mcp__gone__lookup',
      toolCallId: 'a',
      state: 'output-available',
      input: {},
      output: 'ok',
    }])

    expect(wrapper.find('[data-testid="reasoning-step-icon-image"]').exists())
      .toBe(false)
    expect(iconRoots(wrapper)[0]!.findComponent({ name: 'NuxtIcon' }).props('name'))
      .toBe('lucide:plug')
  })

  it('never requests a connector icon on a shared page', async () => {
    const wrapper = await mountMessage([{
      type: 'dynamic-tool',
      toolName: 'mcp__notion__search_pages',
      toolCallId: 'a',
      state: 'output-available',
      input: {},
      output: 'ok',
    }], { isShared: true })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(iconRoots(wrapper)[0]!.findComponent({ name: 'NuxtIcon' }).props('name'))
      .toBe('lucide:plug')
  })

  it('keeps every icon decorative', async () => {
    const wrapper = await mountMessage([
      done('tool-web_search_brave', 'a', { output: { results: [] } }),
      done('tool-create_document', 'b', { input: { format: 'docx' } }),
      done('tool-some_other_tool', 'c'),
    ])

    expect(iconRoots(wrapper)).toHaveLength(3)

    for (const root of iconRoots(wrapper)) {
      expect(root.attributes('aria-hidden')).toBe('true')
      expect(root.text()).toBe('')
    }
  })

  describe('header icon', () => {
    async function settleStreamingTitle() {
      await new Promise((resolve) => {
        setTimeout(resolve, 300)
      })
    }

    function pending(type: string, toolCallId: string, extra = {}) {
      return {
        type,
        toolCallId,
        state: 'input-available',
        input: {},
        ...extra,
      }
    }

    function headerIcon(wrapper: Awaited<ReturnType<typeof mountMessage>>) {
      return wrapper.get('[data-testid="reasoning-header-icon"]')
    }

    it('shows the connector icon for a running connector call', async () => {
      const wrapper = await mountMessage([{
        type: 'dynamic-tool',
        toolName: 'mcp__notion__search_pages',
        toolCallId: 'a',
        state: 'input-available',
        input: {},
      }], { streaming: true })

      await settleStreamingTitle()

      const header = headerIcon(wrapper)

      expect(header.attributes('aria-hidden')).toBe('true')
      expect(header.attributes('data-kind')).toBe('connector')
      expect(header.get('[data-testid="reasoning-step-icon-image"]')
        .attributes('src')).toBe('/api/v1/connectors/conn1/icon')
    })

    it('shows the web search icon for a running web search', async () => {
      const wrapper = await mountMessage(
        [pending('tool-web_search_brave', 'a', { input: { query: 'x' } })],
        { streaming: true },
      )

      await settleStreamingTitle()

      const header = headerIcon(wrapper)

      expect(header.attributes('data-kind')).toBe('provider')
      expect(header.findComponent({ name: 'ProviderIcon' })
        .props('providerId')).toBe('brave')
    })

    it('shows the same icon as the step row', async () => {
      const wrapper = await mountMessage(
        [pending('tool-activate_skill', 'a')],
        { streaming: true },
      )

      await settleStreamingTitle()

      const rowIcon = wrapper.get('[data-testid="reasoning-steps"]')
        .findComponent({ name: 'NuxtIcon' })

      expect(headerIcon(wrapper).findComponent({ name: 'NuxtIcon' })
        .props('name')).toBe(rowIcon.props('name'))
    })

    it('keeps the thinking icon while only thinking streams', async () => {
      const wrapper = await mountMessage([
        { type: 'reasoning', text: '**Planning**\n\nLooking at it.' },
      ], { streaming: true, reasoningLevel: 'high' })

      await settleStreamingTitle()

      const header = headerIcon(wrapper)

      expect(header.attributes('data-kind')).toBe('thinking')
      expect(header.find('[data-testid="reasoning-step-icon"]').exists())
        .toBe(false)
    })

    it('keeps the thinking icon on the finished generic label', async () => {
      const wrapper = await mountMessage([
        done('tool-web_search_brave', 'a', { output: { results: [] } }),
      ])

      expect(headerIcon(wrapper).attributes('data-kind')).toBe('thinking')
      expect(headerIcon(wrapper)
        .find('[data-testid="reasoning-step-icon"]').exists()).toBe(false)
    })

    it('keeps the header icon box the same size when it switches', async () => {
      const wrapper = await mountMessage([{
        type: 'dynamic-tool',
        toolName: 'mcp__notion__search_pages',
        toolCallId: 'a',
        state: 'input-available',
        input: {},
      }], { streaming: true })

      expect(headerIcon(wrapper).classes()).toContain('size-4')

      await settleStreamingTitle()

      expect(headerIcon(wrapper).classes()).toContain('size-4')
    })

    it('never requests a connector icon in the header on a shared page', async () => {
      const wrapper = await mountMessage([{
        type: 'dynamic-tool',
        toolName: 'mcp__notion__search_pages',
        toolCallId: 'a',
        state: 'input-available',
        input: {},
      }], { streaming: true, isShared: true })

      await settleStreamingTitle()

      expect(headerIcon(wrapper).find('img').exists()).toBe(false)
      expect(headerIcon(wrapper).findComponent({ name: 'NuxtIcon' })
        .props('name')).toBe('lucide:plug')
    })
  })
})

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
  options: { isShared?: boolean, searchProvider?: string } = {},
) {
  return await mountSuspended(Reasoning, {
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
      reasoningLevel: 'off',
      turnStartedAt: 0,
      reasoningAccumulatedMs: 0,
      reasoningSegmentStartedAt: 0,
      isTurnThinkingHeld: false,
      isShared: options.isShared,
    },
    global: { stubs: { MDCCached: true } },
  })
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
})

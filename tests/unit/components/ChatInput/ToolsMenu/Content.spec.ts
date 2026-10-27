import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'
import type { ChatInputToolsState } from '../../../../../app/types/chat-input-tools'
import Content from '../../../../../app/components/ChatInput/ToolsMenu/Content.vue'

mockNuxtImport('useUserSetting', () => {
  return () => ({
    reasoningExpanded: shallowRef(false),
    reasoningAutoHide: shallowRef(true),
    setReasoningExpanded: () => undefined,
    setReasoningAutoHide: () => undefined,
  })
})

function createState(
  overrides: {
    files?: boolean
    search?: boolean
    reasoning?: boolean
    lower?: boolean
  } = {},
): ChatInputToolsState {
  const {
    files = true,
    search = true,
    reasoning = true,
    lower = true,
  } = overrides

  return {
    isNewChat: true,
    webSearch: {
      visible: search,
      selected: 'off',
      options: [
        {
          value: 'web_search',
          label: 'Model\'s built-in search',
          enabled: true,
        },
      ],
      isToolCallingSupported: false,
      exaSearchLevel: 'auto',
      isAutoAvailable: false,
      isAutoPreferred: false,
      modelId: 'gemini-3.1-pro',
      billingProviderId: 'google',
    },
    reasoning: {
      visible: reasoning,
      mode: reasoning ? 'configurable' : 'none',
      level: 'medium',
      levels: ['low', 'medium', 'high'],
      canDisable: true,
      capability: { mode: 'levels', levels: ['low', 'medium', 'high'] },
      defaultLevel: 'medium',
    },
    image: { supported: lower, enabled: false, required: false },
    files: { visible: files, count: 0, isImageInputSupported: true },
    project: { visible: false, context: null },
    memory: { excluded: null },
    research: null,
    isDeepResearchModel: false,
    isResearchJobActive: false,
    isCapabilityResolved: true,
  }
}

async function mountContent(state: ChatInputToolsState) {
  return mountSuspended(Content, { props: { state } })
}

type ContentWrapper = Awaited<ReturnType<typeof mountContent>>

function layout(wrapper: ContentWrapper): string[] {
  return Array.from(wrapper.element.children).map((child) => {
    return child.getAttribute('data-section')
      ?? (child.getAttribute('data-testid') === 'tools-menu-divider'
        ? '---'
        : '?')
  })
}

describe('ChatInput/ToolsMenu/Content dividers', () => {
  it('separates every group with one divider when all are present',
    async () => {
      const wrapper = await mountContent(createState())

      expect(layout(wrapper)).toEqual([
        'add',
        '---',
        'search',
        '---',
        'reasoning',
        '---',
        'image',
      ])
    })

  it('uses the same divider element and classes for each one', async () => {
    const wrapper = await mountContent(createState())
    const dividers = wrapper.findAll('[data-testid="tools-menu-divider"]')

    expect(dividers).toHaveLength(3)

    for (const divider of dividers) {
      expect(divider.classes()).toEqual(
        ['h-px', 'mx-2', 'my-1', 'bg-base-content/10'],
      )
    }
  })

  it('draws no divider before Reasoning when web search is absent but '
    + 'Add is present', async () => {
    const wrapper = await mountContent(createState({ search: false }))

    expect(layout(wrapper)).toEqual([
      'add',
      '---',
      'reasoning',
      '---',
      'image',
    ])
  })

  it('draws no divider between Web search and a missing Reasoning',
    async () => {
      const wrapper = await mountContent(createState({ reasoning: false }))

      expect(layout(wrapper)).toEqual(['add', '---', 'search', '---', 'image'])
    })

  it('draws no leading divider when the Add group is absent', async () => {
    const wrapper = await mountContent(createState({ files: false }))

    expect(layout(wrapper)).toEqual([
      'search',
      '---',
      'reasoning',
      '---',
      'image',
    ])
  })

  it('draws no divider for a lone Reasoning section', async () => {
    const wrapper = await mountContent(
      createState({ files: false, search: false, lower: false }),
    )

    expect(layout(wrapper)).toEqual(['reasoning'])
  })

  it('draws no divider before Web search alone with nothing below',
    async () => {
      const wrapper = await mountContent(createState({
        files: false,
        reasoning: false,
        lower: false,
      }))

      expect(layout(wrapper)).toEqual(['search'])
    })
})

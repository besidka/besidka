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

describe('ChatInput/ToolsMenu/Content Run code row', () => {
  function withCodeExecution(
    codeExecution: ChatInputToolsState['codeExecution'],
  ): ChatInputToolsState {
    return { ...createState(), codeExecution }
  }

  it('shows the Run code section before the image row when visible',
    async () => {
      const wrapper = await mountContent(withCodeExecution({
        visible: true,
        enabled: false,
        providerId: 'anthropic',
      }))

      expect(layout(wrapper)).toEqual([
        'add',
        '---',
        'search',
        '---',
        'reasoning',
        '---',
        'code',
        'image',
      ])
      expect(wrapper.find('[data-testid="tools-code-execution-toggle"]')
        .exists()).toBe(true)
    })

  it('hides the row when it is not visible', async () => {
    const wrapper = await mountContent(withCodeExecution({
      visible: false,
      enabled: false,
      providerId: 'anthropic',
    }))

    expect(layout(wrapper)).not.toContain('code')
  })

  it('draws the lower group on its own when only Run code is there',
    async () => {
      const state = createState({
        lower: false,
        files: false,
        search: false,
        reasoning: false,
      })
      const wrapper = await mountContent({
        ...state,
        codeExecution: {
          visible: true,
          enabled: true,
          providerId: 'openai',
        },
      })

      expect(layout(wrapper)).toEqual(['code'])
    })

  it('forwards the toggle once the provider was confirmed', async () => {
    window.localStorage.setItem(
      'besidka:code-execution-confirmed:openai',
      'true',
    )

    const wrapper = await mountContent(withCodeExecution({
      visible: true,
      enabled: false,
      providerId: 'openai',
    }))

    await wrapper.get('[data-testid="tools-code-execution-toggle"]')
      .setValue(true)

    expect(wrapper.emitted('toggle-code-execution')).toEqual([[true]])
  })
})

describe('ChatInput/ToolsMenu/Content section titles', () => {
  it('puts an icon left of every titled section header', async () => {
    const wrapper = await mountContent(createState())

    for (const section of ['add', 'search', 'reasoning']) {
      const heading = wrapper.get(`[data-section="${section}"] h3`)

      expect(heading.find('[data-testid="tools-section-icon"]').exists())
        .toBe(true)
    }
  })

  it('titles the sections Add, Web search and Reasoning', async () => {
    const wrapper = await mountContent(createState())
    const titles = wrapper.findAll('h3').map(heading => heading.text())

    expect(titles).toEqual(['Add', 'Web search', 'Reasoning'])
  })
})

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
    skills?: boolean
    skillAttached?: boolean
    project?: boolean
    projectName?: string
  } = {},
): ChatInputToolsState {
  const {
    files = true,
    search = true,
    reasoning = true,
    lower = true,
    skills = false,
    skillAttached = false,
    project = false,
    projectName,
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
    artifacts: { visible: false, attached: [] },
    skills: {
      visible: skills,
      selected: skillAttached
        ? {
          skillId: 'skl1',
          name: 'writing-style',
          version: 1,
          source: 'menu',
        }
        : null,
      items: [{
        id: 'skl1',
        name: 'writing-style',
        description: 'Write in my voice',
        version: 1,
        mode: 'auto',
      }],
    },
    project: {
      visible: project,
      context: projectName ? { id: 'p1', name: projectName } : null,
    },
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

describe('ChatInput/ToolsMenu/Content skills', () => {
  it('adds one Add skill row to the Add section only when the user has an enabled skill', async () => {
    const hidden = await mountContent(createState())
    const shown = await mountContent(createState({ skills: true }))

    expect(hidden.find('[data-testid="tools-action-skills"]').exists())
      .toBe(false)
    expect(layout(shown)).toEqual(layout(hidden))
    expect(shown.get('[data-testid="tools-action-skills"]').text())
      .toContain('Add skill')
    expect(shown.get('[data-testid="tools-action-skills"]').text())
      .toContain('Skills you made or imported')
  })

  it('still renders the Add section when only the skill row is visible', async () => {
    const wrapper = await mountContent(createState({
      files: false,
      skills: true,
    }))

    expect(layout(wrapper)[0]).toBe('add')
    expect(wrapper.find('[data-testid="tools-action-attach"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="tools-action-skills"]').exists())
      .toBe(true)
  })

  it('shows a badge for an attached skill and opens the picker', async () => {
    const wrapper = await mountContent(createState({ skills: true }))

    expect(wrapper.get('[data-testid="tools-action-skills"]')
      .find('.badge').exists()).toBe(false)

    await wrapper.get('[data-testid="tools-action-skills"]').trigger('click')

    expect(wrapper.emitted('open-skills-picker')).toHaveLength(1)

    await wrapper.setProps({
      state: createState({ skills: true, skillAttached: true }),
    })

    expect(wrapper.get('[data-testid="tools-action-skills"] .badge').text())
      .toBe('1')
  })
})

describe('ChatInput/ToolsMenu/Content project row', () => {
  it('ends the Add section with the Project row after Add skill', async () => {
    const wrapper = await mountContent(createState({
      skills: true,
      project: true,
      projectName: 'Q4 launch',
    }))
    const rows = wrapper.findAll(
      '[data-section="add"] button[data-testid^="tools-"]',
    )

    expect(rows.at(-1)?.attributes('data-testid')).toBe('tools-project')
    expect(rows.at(-2)?.attributes('data-testid')).toBe('tools-action-skills')
    expect(rows.at(-1)?.text()).toContain('Q4 launch')
    expect(wrapper.find('[data-section="project"]').exists()).toBe(false)
  })

  it('renders the Add section when only the Project row is visible', async () => {
    const wrapper = await mountContent(createState({
      files: false,
      search: false,
      reasoning: false,
      lower: false,
      project: true,
    }))

    expect(layout(wrapper)).toEqual(['add'])
    expect(wrapper.get('[data-testid="tools-project"]').text())
      .toContain('None')
  })

  it('draws a divider between the Add section and the lower rows', async () => {
    const wrapper = await mountContent(createState({
      files: false,
      search: false,
      reasoning: false,
      project: true,
    }))

    expect(layout(wrapper)).toEqual(['add', '---', 'image'])
  })

  it('emits open-project-picker when the row is clicked', async () => {
    const wrapper = await mountContent(createState({ project: true }))

    await wrapper.get('[data-testid="tools-project"]').trigger('click')

    expect(wrapper.emitted('open-project-picker')).toHaveLength(1)
  })
})

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

describe('ChatInput/ToolsMenu/Content Add artifact row', () => {
  const ARTIFACT_ROW = '[data-testid="tools-action-artifacts"]'

  function withArtifacts(
    artifacts: ChatInputToolsState['artifacts'],
  ): ChatInputToolsState {
    return { ...createState(), artifacts }
  }

  it('is absent without access and leaves the Add section as before',
    async () => {
      const without = await mountContent(createState())
      const explicit = await mountContent(withArtifacts({
        visible: false,
        attached: [],
      }))

      expect(explicit.find(ARTIFACT_ROW).exists()).toBe(false)
      expect(explicit.html()).toBe(without.html())
      expect(layout(explicit)).toEqual([
        'add',
        '---',
        'search',
        '---',
        'reasoning',
        '---',
        'image',
      ])
      expect(explicit.text()).not.toContain('Add artifact')
    })

  it('shows Add artifact after Generated images with access', async () => {
    const wrapper = await mountContent(withArtifacts({
      visible: true,
      attached: [],
    }))
    const rows = wrapper.findAll(
      '[data-section="add"] button[data-testid^="tools-action-"]',
    ).map(row => row.attributes('data-testid'))

    expect(rows).toEqual([
      'tools-action-attach',
      'tools-action-library',
      'tools-action-generated',
      'tools-action-artifacts',
    ])
    expect(wrapper.find(ARTIFACT_ROW).text()).toContain('Add artifact')
    expect(wrapper.find(ARTIFACT_ROW).text())
      .toContain('Artifacts from your chats')
  })

  it('shows the attached count as a badge', async () => {
    const wrapper = await mountContent(withArtifacts({
      visible: true,
      attached: [
        {
          artifactId: 'a1',
          version: 1,
          kind: 'html',
          title: 'Quiz',
        },
        {
          artifactId: 'a2',
          version: 2,
          kind: 'svg',
          title: 'Logo',
        },
      ],
    }))

    expect(wrapper.find(ARTIFACT_ROW).find('.badge').text()).toBe('2')
  })

  it('emits open-artifact-picker when the row is clicked', async () => {
    const wrapper = await mountContent(withArtifacts({
      visible: true,
      attached: [],
    }))

    await wrapper.find(ARTIFACT_ROW).trigger('click')

    expect(wrapper.emitted('open-artifact-picker')).toHaveLength(1)
  })
})

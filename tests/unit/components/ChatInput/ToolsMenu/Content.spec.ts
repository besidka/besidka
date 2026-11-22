import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import { GOOGLE_DRIVE_TOOLS_HINT } from '#shared/utils/google-drive-tools'
import type { ChatInputToolsState } from '../../../../../app/types/chat-input-tools'
import Content from '../../../../../app/components/ChatInput/ToolsMenu/Content.vue'

const stepsExpanded = shallowRef<boolean>(false)

mockNuxtImport('useUserSetting', () => {
  return () => ({
    stepsExpanded,
    stepsAutoHide: shallowRef(true),
    setStepsExpanded: () => undefined,
    setStepsAutoHide: () => undefined,
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
    connectors?: boolean
    connectorsOn?: number
    connectorItems?: boolean
    project?: boolean
    projectName?: string
    drive?: boolean
    driveImporting?: number
  } = {},
): ChatInputToolsState {
  const {
    drive = false,
    driveImporting = 0,
    files = true,
    search = true,
    reasoning = true,
    lower = true,
    skills = false,
    skillAttached = false,
    connectors = false,
    connectorsOn = 0,
    connectorItems = true,
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
    googleDrive: { visible: drive, importing: driveImporting },
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
    connectors: {
      visible: connectors,
      items: !connectorItems
        ? []
        : [
          {
            id: 'c1',
            slug: 'notion',
            title: 'Notion',
            host: 'mcp.notion.com',
            status: 'ready',
            toolMode: 'manual',
            presetId: null,
            isIconAvailable: false,
          },
          {
            id: 'c2',
            slug: 'linear',
            title: 'Linear',
            host: 'mcp.linear.app',
            status: 'ready',
            toolMode: 'manual',
            presetId: null,
            isIconAvailable: false,
          },
        ],
      selectedIds: ['c1', 'c2'].slice(0, connectorsOn),
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

function fullLayout(wrapper: ContentWrapper): string[] {
  return Array.from(wrapper.element.children).map((child) => {
    return child.getAttribute('data-section')
      ?? (child.getAttribute('data-testid') === 'tools-menu-divider'
        ? '---'
        : '?')
  })
}

function layout(wrapper: ContentWrapper): string[] {
  const sections = fullLayout(wrapper)
  const stepsIndex = sections.indexOf('steps')

  if (stepsIndex === -1) {
    return sections
  }

  const hasDividerAfterSteps = sections[stepsIndex + 1] === '---'

  return sections.filter((_section, index) => {
    return index !== stepsIndex
      && !(hasDividerAfterSteps && index === stepsIndex + 1)
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

    expect(layout(wrapper).at(-1)).toBe('add')
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

describe('ChatInput/ToolsMenu/Content connectors row', () => {
  it('adds one Connectors row to the Add section and never lists connectors inline', async () => {
    const hidden = await mountContent(createState())
    const shown = await mountContent(createState({ connectors: true }))

    expect(hidden.find('[data-testid="tools-action-connectors"]').exists())
      .toBe(false)
    expect(layout(shown)).toEqual(layout(hidden))

    const row = shown.get('[data-testid="tools-action-connectors"]')

    expect(row.text()).toContain('Connectors')
    expect(shown.findAll('[data-testid="tools-action-connectors"]'))
      .toHaveLength(1)
    expect(shown.text()).not.toContain('Notion')
    expect(shown.text()).not.toContain('mcp.notion.com')
    expect(shown.element.querySelector('input[type="checkbox"][aria-label*="Notion"]'))
      .toBeNull()
  })

  it('renders the Add section when only the Connectors row is visible', async () => {
    const wrapper = await mountContent(createState({
      files: false,
      connectors: true,
    }))

    expect(layout(wrapper).at(-1)).toBe('add')
    expect(wrapper.find('[data-testid="tools-action-attach"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="tools-action-connectors"]').exists())
      .toBe(true)
  })

  describe('Google Drive row', () => {
    it('is not offered while google.drive is off', async () => {
      const wrapper = await mountContent(createState({ drive: false }))

      expect(wrapper.find('[data-testid="tools-action-google-drive"]')
        .exists()).toBe(false)
    })

    it('is one row named in full, with the copy label, that opens the '
      + 'Picker', async () => {
      const wrapper = await mountContent(createState({ drive: true }))
      const row = wrapper.get('[data-testid="tools-action-google-drive"]')

      expect(row.text()).toContain('Google Drive')
      expect(row.text()).toContain(
        'Saves a copy in your Besidka files',
      )
      expect(row.text()).not.toMatch(/\d/)
      expect(row.html()).not.toContain('googledrive')
      expect(wrapper.findAll('[data-testid="tools-action-google-drive"]'))
        .toHaveLength(1)
      expect(row.attributes('aria-label') ?? '').not.toContain('Drive file')

      await row.trigger('click')

      expect(wrapper.emitted('open-google-drive')).toHaveLength(1)
    })

    it('says where the model can use Drive and where it cannot, in one '
      + 'sentence under the row', async () => {
      const wrapper = await mountContent(createState({ drive: true }))
      const hint = wrapper.get('[data-testid="tools-google-drive-tools-hint"]')

      expect(hint.text()).toBe(GOOGLE_DRIVE_TOOLS_HINT)
      expect(hint.text()).toContain('gateway chat only after a Drive file is '
        + 'attached')
      expect(hint.text()).toContain('web search')
      expect(hint.text()).toContain('Run code')
    })

    it('shows no hint while google.drive is off', async () => {
      const wrapper = await mountContent(createState({ drive: false }))

      expect(wrapper.find('[data-testid="tools-google-drive-tools-hint"]')
        .exists()).toBe(false)
    })

    it('sits in the Add section beside the other file sources', async () => {
      const wrapper = await mountContent(createState({ drive: true }))
      const add = wrapper.get('[data-section="add"]')

      expect(add.find('[data-testid="tools-action-google-drive"]').exists())
        .toBe(true)
      expect(add.find('[data-testid="tools-action-attach"]').exists())
        .toBe(true)
    })

    it('shows how many files are being copied as a badge', async () => {
      const wrapper = await mountContent(createState({
        drive: true,
        driveImporting: 2,
      }))

      expect(wrapper.get('[data-testid="tools-action-google-drive"] .badge')
        .text()).toBe('2')
    })

    it('is hidden with the other file rows when files are not allowed',
      async () => {
        const wrapper = await mountContent(createState({
          files: false,
          drive: true,
        }))

        expect(wrapper.find('[data-testid="tools-action-google-drive"]')
          .exists()).toBe(false)
      })
  })

  it('shows how many connectors are on as a badge and opens the picker', async () => {
    const wrapper = await mountContent(createState({ connectors: true }))

    expect(wrapper.get('[data-testid="tools-action-connectors"]')
      .find('.badge').exists()).toBe(false)

    await wrapper.get('[data-testid="tools-action-connectors"]')
      .trigger('click')

    expect(wrapper.emitted('open-connectors-picker')).toHaveLength(1)

    await wrapper.setProps({
      state: createState({ connectors: true, connectorsOn: 2 }),
    })

    expect(wrapper.get('[data-testid="tools-action-connectors"] .badge').text())
      .toBe('2')
  })

  it('shows the row with no connectors at all', async () => {
    const wrapper = await mountContent(createState({
      connectors: true,
      connectorItems: false,
    }))

    expect(wrapper.find('[data-testid="tools-action-connectors"]').exists())
      .toBe(true)
    expect(wrapper.get('[data-testid="tools-action-connectors"]')
      .find('.badge').exists()).toBe(false)
  })

  it('counts only the Manual connectors that are on, never Besidka', async () => {
    const state = createState({ connectors: true, connectorsOn: 1 })
    const [first, second] = state.connectors?.items ?? []

    if (!state.connectors || !first || !second) {
      throw new Error('the state needs two connector items')
    }

    state.connectors = {
      ...state.connectors,
      items: [first, { ...second, toolMode: 'auto' }],
      selectedIds: [first.id, second.id],
    }

    const wrapper = await mountContent(state)

    expect(wrapper.get('[data-testid="tools-action-connectors"] .badge')
      .text()).toBe('1')
  })

  it('shows no badge when only Auto connectors are available', async () => {
    const state = createState({ connectors: true })
    const items = (state.connectors?.items ?? [])
      .map(item => ({ ...item, toolMode: 'auto' as const }))

    state.connectors = {
      visible: true,
      items,
      selectedIds: items.map(item => item.id),
    }

    const wrapper = await mountContent(state)

    expect(wrapper.get('[data-testid="tools-action-connectors"]')
      .find('.badge').exists()).toBe(false)
  })

  it('sits after Add skill and before the Project row', async () => {
    const wrapper = await mountContent(createState({
      skills: true,
      connectors: true,
      project: true,
    }))
    const rows = wrapper.findAll(
      '[data-section="add"] button[data-testid^="tools-"]',
    )
    const ids = rows.map(row => row.attributes('data-testid'))

    expect(ids.slice(-3)).toEqual([
      'tools-action-skills',
      'tools-action-connectors',
      'tools-project',
    ])
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

    expect(layout(wrapper)).toEqual(['image', '---', 'add'])
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
        'image',
        '---',
        'reasoning',
        '---',
        'search',
        '---',
        'add',
      ])
    })

  it('uses the same divider element and classes for each one', async () => {
    const wrapper = await mountContent(createState())
    const dividers = wrapper.findAll('[data-testid="tools-menu-divider"]')

    expect(dividers).toHaveLength(4)

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
      'image',
      '---',
      'reasoning',
      '---',
      'add',
    ])
  })

  it('draws no divider between Web search and a missing Reasoning',
    async () => {
      const wrapper = await mountContent(createState({ reasoning: false }))

      expect(layout(wrapper)).toEqual(['image', '---', 'search', '---', 'add'])
    })

  it('draws no leading divider when the Add group is absent', async () => {
    const wrapper = await mountContent(createState({ files: false }))

    expect(layout(wrapper)).toEqual([
      'image',
      '---',
      'reasoning',
      '---',
      'search',
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
        'code',
        'image',
        '---',
        'reasoning',
        '---',
        'search',
        '---',
        'add',
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

  it('titles the sections Steps, Reasoning, Web search and Add, top to bottom', async () => {
    const wrapper = await mountContent(createState())
    const titles = wrapper.findAll('h3').map(heading => heading.text())

    expect(titles).toEqual(['Steps', 'Reasoning', 'Web search', 'Add'])
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
        'image',
        '---',
        'reasoning',
        '---',
        'search',
        '---',
        'add',
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

describe('ChatInput/ToolsMenu/Content memory row', () => {
  function withMemory(excluded: boolean): ChatInputToolsState {
    return { ...createState(), memory: { excluded } }
  }

  it('sits first, above Reasoning, Web search and Add, because the menu opens upward', async () => {
    const wrapper = await mountContent(withMemory(false))
    const sections = layout(wrapper).filter(section => section !== '---')

    expect(sections).toEqual(['memory', 'image', 'reasoning', 'search', 'add'])
  })

  it('is one line: the label and the toggle, with no description under it', async () => {
    const wrapper = await mountContent(withMemory(false))
    const row = wrapper.get('[data-section="memory"] label')

    expect(row.text()).toBe('Use memory')
    expect((wrapper.get('[data-testid="new-chat-memory-note"]')
      .element as HTMLElement).style.display).toBe('none')
    expect(row.text()).not.toContain('Learns from this chat')
  })

  it('shows the description from an info button, like the Auto row', async () => {
    const wrapper = await mountContent(withMemory(false))
    const info = wrapper.get('[data-testid="new-chat-memory-info"]')

    expect(info.attributes('aria-expanded')).toBe('false')

    await info.trigger('click')

    const note = wrapper.get('[data-testid="new-chat-memory-note"]')

    expect(info.attributes('aria-expanded')).toBe('true')
    expect(info.attributes('aria-controls')).toBe(note.attributes('id'))
    expect((note.element as HTMLElement).style.display).not.toBe('none')
    expect(note.text()).toBe('Learns from this chat and finds it in chat search.')
  })

  it('keeps the excluded-memory helper in the same note', async () => {
    const wrapper = await mountContent(withMemory(true))

    await wrapper.get('[data-testid="new-chat-memory-info"]').trigger('click')

    expect(wrapper.get('[data-testid="new-chat-memory-note"]').text())
      .toContain('won\'t learn from this chat')
  })

  it('does not toggle memory when the info button is pressed', async () => {
    const wrapper = await mountContent(withMemory(false))

    await wrapper.get('[data-testid="new-chat-memory-info"]').trigger('click')

    expect(wrapper.emitted('update:use-memory')).toBeUndefined()
  })

  it('still emits the new value from the toggle', async () => {
    const wrapper = await mountContent(withMemory(false))

    await wrapper.get('[data-testid="new-chat-memory-toggle"]').setValue(false)

    expect(wrapper.emitted('update:use-memory')).toEqual([[false]])
  })
})

describe('ChatInput/ToolsMenu/Content steps section', () => {
  beforeEach(() => {
    stepsExpanded.value = false
  })

  function withMemory(excluded: boolean): ChatInputToolsState {
    return { ...createState(), memory: { excluded } }
  }

  function withReasoningOff(): ChatInputToolsState {
    const state = withMemory(false)

    return {
      ...state,
      reasoning: { ...state.reasoning, level: 'off' },
    }
  }

  it('sits directly above the memory section', async () => {
    const wrapper = await mountContent(withMemory(false))
    const sections = fullLayout(wrapper)

    expect(sections.slice(0, 3)).toEqual(['steps', '---', 'memory'])
  })

  it('shows Show steps expanded with reasoning Off and a Steps title',
    async () => {
      const wrapper = await mountContent(withReasoningOff())
      const section = wrapper.get('[data-section="steps"]')

      expect(section.get('h3').text()).toBe('Steps')
      expect(section.get('[data-testid="steps-expanded-toggle"]').exists())
        .toBe(true)
      expect(wrapper.get('[data-section="reasoning"]')
        .find('[data-testid="steps-expanded-toggle"]').exists()).toBe(false)
    })

  it('renders the Steps section even when reasoning is unavailable',
    async () => {
      const state = createState({ reasoning: false })
      const wrapper = await mountContent(state)

      expect(fullLayout(wrapper)).toContain('steps')
      expect(wrapper.find('[data-section="reasoning"]').exists())
        .toBe(false)
    })

  it('reveals Auto-hide only while steps are expanded', async () => {
    const wrapper = await mountContent(withReasoningOff())
    const autoHideReveal = () => {
      return wrapper.get('[data-testid="steps-auto-hide-toggle"]')
        .element
        .closest('[data-open]')
    }

    expect(autoHideReveal()?.getAttribute('data-open')).toBe('false')
    expect(autoHideReveal()?.hasAttribute('inert')).toBe(true)

    stepsExpanded.value = true
    await nextTick()

    expect(autoHideReveal()?.getAttribute('data-open')).toBe('true')
    expect(autoHideReveal()?.hasAttribute('inert')).toBe(false)
  })
})

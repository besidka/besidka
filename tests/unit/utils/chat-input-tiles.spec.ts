import { describe, expect, it } from 'vitest'
import type { ChatInputToolsState } from '~/types/chat-input-tools'
import {
  buildChatInputTiles,
  getChatInputTileToneClass,
  getReasoningLevelLabel,
  getWebSearchValueLabel,
  isAutoWebSearchActive,
} from '~/utils/chat-input-tiles'

type StateOverrides = {
  [Key in keyof ChatInputToolsState]?: ChatInputToolsState[Key] extends object
    ? Partial<ChatInputToolsState[Key]> | ChatInputToolsState[Key]
    : ChatInputToolsState[Key]
}

function createState(overrides: StateOverrides = {}): ChatInputToolsState {
  const base: ChatInputToolsState = {
    isNewChat: true,
    webSearch: {
      visible: true,
      selected: 'off',
      options: [],
      isToolCallingSupported: true,
      exaSearchLevel: 'auto',
      isAutoAvailable: false,
      isAutoPreferred: false,
      modelId: 'gemini-3.1-pro',
      billingProviderId: 'google',
    },
    reasoning: {
      visible: true,
      mode: 'configurable',
      level: 'medium',
      levels: ['low', 'medium', 'high'],
      canDisable: true,
      capability: { mode: 'levels', levels: ['low', 'medium', 'high'] },
      defaultLevel: 'medium',
    },
    image: {
      supported: true,
      enabled: false,
      required: false,
    },
    files: {
      visible: true,
      count: 0,
      isImageInputSupported: true,
    },
    project: {
      visible: true,
      context: null,
    },
    memory: {
      excluded: false,
    },
    research: null,
    isDeepResearchModel: false,
    isResearchJobActive: false,
    isCapabilityResolved: true,
  }

  return {
    ...base,
    ...overrides,
    webSearch: { ...base.webSearch, ...overrides.webSearch },
    reasoning: { ...base.reasoning, ...overrides.reasoning },
    image: { ...base.image, ...overrides.image },
    files: { ...base.files, ...overrides.files },
    project: { ...base.project, ...overrides.project },
    memory: { ...base.memory, ...overrides.memory },
  } as ChatInputToolsState
}

function tileIds(state: ChatInputToolsState): string[] {
  return buildChatInputTiles(state).map(tile => tile.id)
}

describe('buildChatInputTiles', () => {
  it('returns nothing for a new chat on product defaults', () => {
    expect(buildChatInputTiles(createState())).toEqual([])
  })

  it('returns nothing until the model capabilities resolve', () => {
    const state = createState({
      isCapabilityResolved: false,
      project: { context: { id: 'p1', name: 'Roadmap' } },
      memory: { excluded: true },
      webSearch: { selected: 'web_search_brave' },
      reasoning: { level: 'high' },
    })

    expect(buildChatInputTiles(state)).toEqual([])
  })

  it('orders project, memory, image tiles', () => {
    const state = createState({
      project: { context: { id: 'p1', name: 'Roadmap' } },
      memory: { excluded: true },
      image: { enabled: true },
      webSearch: { visible: false, selected: 'off' },
      reasoning: { visible: false },
    })

    expect(tileIds(state)).toEqual(['project', 'memory', 'image'])
  })

  it('orders project, memory, search and reasoning tiles', () => {
    const state = createState({
      project: { context: { id: 'p1', name: 'Roadmap' } },
      memory: { excluded: true },
      webSearch: { selected: 'web_search' },
      reasoning: { level: 'high' },
    })

    expect(tileIds(state)).toEqual([
      'project',
      'memory',
      'search',
      'reasoning',
    ])
  })

  it('describes the project tile with the project name and a remove label',
    () => {
      const [tile] = buildChatInputTiles(createState({
        project: { context: { id: 'p1', name: 'Q4 launch roadmap' } },
      }))

      expect(tile).toMatchObject({
        id: 'project',
        section: 'project',
        caption: 'Project',
        value: 'Q4 launch roadmap',
        ariaLabel: 'Project: Q4 launch roadmap',
        removeLabel: 'Remove project',
        icon: { kind: 'icon', name: 'lucide:folder' },
      })
    })

  it('shows a neutral Memory off tile only when memory is excluded', () => {
    expect(tileIds(createState({ memory: { excluded: false } })))
      .toEqual([])
    expect(tileIds(createState({ memory: { excluded: null } })))
      .toEqual([])

    const [tile] = buildChatInputTiles(createState({
      memory: { excluded: true },
    }))

    expect(tile).toMatchObject({
      id: 'memory',
      caption: 'Memory',
      value: 'Off',
      isNeutral: true,
      removeLabel: 'Use memory again',
      icon: { kind: 'icon', name: 'lucide:book-x' },
    })
  })

  it('makes the image tile non-removable and locked when image generation '
    + 'is required', () => {
    const [tile] = buildChatInputTiles(createState({
      image: { enabled: true, required: true },
      webSearch: { visible: false },
      reasoning: { visible: false },
    }))

    expect(tile).toMatchObject({
      id: 'image',
      caption: 'Mode',
      value: 'Image generation',
      chipLabel: 'Image generation',
      ariaLabel: 'Image generation is always on for this model',
      removeLabel: null,
      isLocked: true,
    })
    expect(tile?.value).not.toMatch(/required/i)
  })

  it('lets the user remove an optional image tile', () => {
    const [tile] = buildChatInputTiles(createState({
      image: { enabled: true },
      webSearch: { visible: false },
      reasoning: { visible: false },
    }))

    expect(tile).toMatchObject({
      caption: 'Mode',
      value: 'Image generation',
      chipLabel: 'Image generation',
      ariaLabel: 'Image generation is on',
      removeLabel: 'Turn off image generation',
      isLocked: false,
    })
  })

  it('hides search and reasoning tiles while their sections are hidden', () => {
    const state = createState({
      image: { enabled: true },
      webSearch: { visible: false, selected: 'web_search_brave' },
      reasoning: { visible: false, level: 'high' },
    })

    expect(tileIds(state)).toEqual(['image'])
  })

  it('shows only the deep research tile family for a research model', () => {
    const state = createState({
      isDeepResearchModel: true,
      research: {
        tier: 'thorough',
        assistModel: 'o4-mini',
        costEstimate: '~$1',
        timeEstimate: '5-30 min',
      },
      project: { context: { id: 'p1', name: 'Roadmap' } },
      image: { enabled: true },
      webSearch: { selected: 'web_search' },
      reasoning: { level: 'high' },
    })
    const tiles = buildChatInputTiles(state)

    expect(tiles.map(tile => tile.id)).toEqual(['project', 'deep-research'])
    expect(tiles[1]).toMatchObject({
      removeLabel: null,
      ariaLabel: 'Deep research is on for this model — ~$1 · 5-30 min',
    })
  })

  it('marks the deep research tile disabled while a job runs', () => {
    const [tile] = buildChatInputTiles(createState({
      isDeepResearchModel: true,
      isResearchJobActive: true,
    }))

    expect(tile?.isDisabled).toBe(true)
  })

  describe('search tile', () => {
    it('uses the globe for built-in search', () => {
      const [tile] = buildChatInputTiles(createState({
        webSearch: { selected: 'web_search' },
      }))

      expect(tile).toMatchObject({
        caption: 'Web search',
        value: 'Built-in',
        icon: { kind: 'icon', name: 'lucide:globe' },
        ariaLabel: 'Web search: Built-in',
        removeLabel: 'Turn off web search',
        isAuto: false,
      })
    })

    it('uses the provider icon for Brave', () => {
      const [tile] = buildChatInputTiles(createState({
        webSearch: { selected: 'web_search_brave' },
      }))

      expect(tile).toMatchObject({
        value: 'Brave',
        icon: { kind: 'provider', providerId: 'brave' },
      })
    })

    it('names the Exa depth', () => {
      const [tile] = buildChatInputTiles(createState({
        webSearch: { selected: 'web_search_exa', exaSearchLevel: 'deep' },
      }))

      expect(tile).toMatchObject({
        value: 'Exa · Deep',
        icon: { kind: 'provider', providerId: 'exa' },
        chipLabel: 'Search: Exa · Deep',
      })
    })

    it('keeps the provider and adds the Auto caption while Auto is active',
      () => {
        const [tile] = buildChatInputTiles(createState({
          webSearch: {
            selected: 'web_search_brave',
            isAutoAvailable: true,
            isAutoPreferred: true,
          },
        }))

        expect(tile).toMatchObject({
          caption: 'Auto search',
          value: 'Brave',
          isAuto: true,
          ariaLabel: 'Auto web search: Brave',
          icon: { kind: 'provider', providerId: 'brave' },
        })
      })

    it('ignores a preferred Auto that is not available', () => {
      const [tile] = buildChatInputTiles(createState({
        webSearch: {
          selected: 'web_search',
          isAutoAvailable: false,
          isAutoPreferred: true,
        },
      }))

      expect(tile?.isAuto).toBe(false)
      expect(tile?.caption).toBe('Web search')
    })
  })

  describe('reasoning tile', () => {
    it('is hidden when the level equals the saved default', () => {
      expect(tileIds(createState({
        reasoning: { level: 'low', defaultLevel: 'low' },
      }))).toEqual([])
    })

    it('appears when the level differs from the saved default', () => {
      const [tile] = buildChatInputTiles(createState({
        reasoning: { level: 'high', defaultLevel: 'low' },
      }))

      expect(tile).toMatchObject({
        id: 'reasoning',
        section: 'reasoning',
        value: 'High',
        removeLabel: null,
        ariaLabel: 'Reasoning: High. Your default is Low.',
        icon: { kind: 'reasoning', level: 'high' },
      })
    })

    it('appears when the model cannot honour the saved default', () => {
      const [tile] = buildChatInputTiles(createState({
        reasoning: {
          level: 'off',
          defaultLevel: 'off',
          canDisable: false,
          capability: {
            mode: 'levels',
            levels: ['low', 'medium', 'high'],
            cannotDisable: true,
            defaultLevel: 'medium',
          },
        },
      }))

      expect(tile?.value).toBe('Medium')
    })

    it('shows a forced level when the product default is off', () => {
      const [tile] = buildChatInputTiles(createState({
        reasoning: {
          level: 'medium',
          defaultLevel: 'off',
          canDisable: false,
          capability: {
            mode: 'levels',
            levels: ['low', 'medium', 'high'],
            cannotDisable: true,
            defaultLevel: 'medium',
          },
        },
      }))

      expect(tile).toMatchObject({
        value: 'Medium',
        ariaLabel: 'Reasoning: Medium. Your default is Off.',
      })
    })

    it('labels a toggle-mode model On', () => {
      const [tile] = buildChatInputTiles(createState({
        reasoning: {
          level: 'medium',
          defaultLevel: 'off',
          levels: ['medium'],
          capability: { mode: 'toggle' },
        },
      }))

      expect(tile?.value).toBe('On')
    })

    it('never shows for always-on or non-reasoning models', () => {
      expect(tileIds(createState({
        reasoning: { mode: 'always-on', level: 'high', defaultLevel: 'off' },
      }))).toEqual([])
      expect(tileIds(createState({
        reasoning: { mode: 'none', level: 'high', defaultLevel: 'off' },
      }))).toEqual([])
    })
  })
})

describe('chat input tile helpers', () => {
  it('formats web search values', () => {
    expect(getWebSearchValueLabel('web_search', 'auto')).toBe('Built-in')
    expect(getWebSearchValueLabel('web_search_brave', 'auto')).toBe('Brave')
    expect(getWebSearchValueLabel('web_search_exa', 'lite'))
      .toBe('Exa · Lite')
  })

  it('formats reasoning labels', () => {
    expect(getReasoningLevelLabel('high', false)).toBe('High')
    expect(getReasoningLevelLabel('high', true)).toBe('On')
    expect(getReasoningLevelLabel('off', true)).toBe('Off')
  })

  it('reports Auto as active only with a provider selected', () => {
    const { webSearch } = createState({
      webSearch: { isAutoAvailable: true, isAutoPreferred: true },
    })

    expect(isAutoWebSearchActive(webSearch)).toBe(false)
    expect(isAutoWebSearchActive({ ...webSearch, selected: 'web_search' }))
      .toBe(true)
  })

  it('picks a neutral tone for neutral tiles', () => {
    expect(getChatInputTileToneClass({ isNeutral: true }))
      .toContain('bg-base-content/7')
    expect(getChatInputTileToneClass({ isNeutral: false }))
      .toContain('bg-accent/10')
  })

  it('darkens both tones in the dark theme to keep the text legible', () => {
    expect(getChatInputTileToneClass({ isNeutral: true }))
      .toContain('dark:bg-base-300/40')
    expect(getChatInputTileToneClass({ isNeutral: false }))
      .toContain('dark:bg-(--color-accent-bg)/60')
  })
})

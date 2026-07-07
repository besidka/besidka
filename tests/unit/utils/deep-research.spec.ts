import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  buildInitialResearchPlanningMilestone,
  buildResearchStepInstructions,
  buildResearchSystemPrompt,
  createResearchMilestoneState,
  createResearchSourceRegistry,
  getUserMessageText,
  mapStepToResearchMilestones,
  registerResearchSources,
  shouldForceResearchSearch,
  shouldStopResearch,
} from '../../../server/utils/chats/deep-research'
import { getResearchBudget } from '../../../shared/utils/research'

function urlSource(url: string, title?: string) {
  return { type: 'source', sourceType: 'url', id: url, url, title }
}

describe('getUserMessageText', () => {
  it('joins and trims only text parts', () => {
    const parts = [
      { type: 'text', text: '  Hello ' },
      { type: 'file', url: 'https://example.com/a.png', mediaType: 'image/png' },
      { type: 'text', text: 'World' },
    ] as UIMessage['parts']

    expect(getUserMessageText(parts)).toBe('Hello\nWorld')
  })

  it('returns an empty string when there are no text parts', () => {
    const parts = [
      { type: 'file', url: 'https://example.com/a.png', mediaType: 'image/png' },
    ] as UIMessage['parts']

    expect(getUserMessageText(parts)).toBe('')
  })
})

describe('buildResearchSystemPrompt', () => {
  it('includes the topic and search budget without answers', () => {
    const budget = getResearchBudget('quick')
    const prompt = buildResearchSystemPrompt({
      topic: 'the future of renewable energy',
      answers: [],
      budget,
    })

    expect(prompt).toContain('the future of renewable energy')
    expect(prompt).toContain(`up to ${budget.maxSearches}`)
    expect(prompt).toContain(`around ${budget.targetSources} distinct`)
    expect(prompt).toContain('never stop after a single search')
    expect(prompt).not.toContain('clarified the scope')
  })

  it('includes clarifying answers when provided', () => {
    const budget = getResearchBudget('standard')
    const prompt = buildResearchSystemPrompt({
      topic: 'electric vehicle adoption',
      answers: [
        { id: 'q1', question: 'Which region?', answer: 'Europe' },
        { id: 'q2', question: 'Which timeframe?', answer: '2020-2025' },
      ],
      budget,
    })

    expect(prompt).toContain('clarified the scope')
    expect(prompt).toContain('Which region? -> Europe')
    expect(prompt).toContain('Which timeframe? -> 2020-2025')
  })
})

describe('mapStepToResearchMilestones', () => {
  it('emits a planning milestone once on the first step', () => {
    const state = createResearchMilestoneState()
    const registry = createResearchSourceRegistry()
    const budget = getResearchBudget('standard')

    const milestones = mapStepToResearchMilestones({
      step: {
        stepNumber: 0,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [],
        sources: [],
      },
      state,
      budget,
      registry,
    })

    expect(milestones).toEqual([
      {
        phase: 'planning',
        label: 'Planning the research',
        status: 'done',
        detail: 'Breaking the question into sub-topics and planning searches'
          + ` toward about ${budget.targetSources} sources.`,
      },
      {
        phase: 'analyzing',
        label: 'Analyzing the findings',
        status: 'active',
        count: 0,
      },
    ])
    expect(state.emittedPhases).toEqual(['planning'])
  })

  it('does not re-emit planning on later steps', () => {
    const state = createResearchMilestoneState()
    const registry = createResearchSourceRegistry()
    const budget = getResearchBudget('standard')

    mapStepToResearchMilestones({
      step: {
        stepNumber: 0,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [],
        sources: [],
      },
      state,
      budget,
      registry,
    })

    const milestones = mapStepToResearchMilestones({
      step: {
        stepNumber: 1,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [],
        sources: [],
      },
      state,
      budget,
      registry,
    })

    expect(milestones).toEqual([
      {
        phase: 'analyzing',
        label: 'Analyzing the findings',
        status: 'active',
        count: 0,
      },
    ])
  })

  it('tracks searching progress, capped at the search budget', () => {
    const state = createResearchMilestoneState()
    const registry = createResearchSourceRegistry()
    const budget = getResearchBudget('quick')

    mapStepToResearchMilestones({
      step: {
        stepNumber: 0,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [],
        sources: [],
      },
      state,
      budget,
      registry,
    })

    const firstSearch = mapStepToResearchMilestones({
      step: {
        stepNumber: 1,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [
          { toolName: 'web_search', input: { query: 'ai trends' } },
        ],
        sources: [],
      },
      state,
      budget,
      registry,
    })

    expect(firstSearch).toEqual([
      {
        phase: 'searching',
        label: 'Searching the web',
        status: 'active',
        count: 1,
        detail: 'ai trends',
      },
    ])

    const secondSearch = mapStepToResearchMilestones({
      step: {
        stepNumber: 2,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [
          { toolName: 'web_search', input: { query: 'a' } },
          { toolName: 'web_search', input: { query: 'b' } },
          { toolName: 'web_search', input: { query: 'c' } },
        ],
        sources: [],
      },
      state,
      budget,
      registry,
    })

    expect(secondSearch[0]).toMatchObject({
      phase: 'searching',
      count: budget.maxSearches,
    })
    expect(state.searchesRun).toBe(budget.maxSearches)
  })

  it('counts unique sources read and reports their domains', () => {
    const state = createResearchMilestoneState()
    const registry = createResearchSourceRegistry()
    const budget = getResearchBudget('standard')

    mapStepToResearchMilestones({
      step: {
        stepNumber: 0,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [],
        sources: [],
      },
      state,
      budget,
      registry,
    })

    const reading = mapStepToResearchMilestones({
      step: {
        stepNumber: 1,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [{ toolName: 'url_context' }],
        sources: [
          urlSource('https://www.a.com/page-1', 'A'),
          urlSource('https://b.com/page-2'),
        ],
      },
      state,
      budget,
      registry,
    })

    expect(reading).toEqual([
      {
        phase: 'reading',
        label: 'Reading sources',
        status: 'active',
        count: 2,
        detail: 'a.com, b.com',
      },
    ])
    expect(state.sourcesRead).toBe(2)
    expect(registry.uniqueUrls.size).toBe(2)
  })

  it('deduplicates repeated sources across steps', () => {
    const state = createResearchMilestoneState()
    const registry = createResearchSourceRegistry()
    const budget = getResearchBudget('standard')

    mapStepToResearchMilestones({
      step: {
        stepNumber: 0,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [{ toolName: 'web_search', input: { query: 'x' } }],
        sources: [urlSource('https://example.com/a')],
      },
      state,
      budget,
      registry,
    })

    mapStepToResearchMilestones({
      step: {
        stepNumber: 1,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [{ toolName: 'web_search', input: { query: 'y' } }],
        sources: [
          urlSource('https://example.com/a/'),
          urlSource('https://www.example.com/a'),
          urlSource('https://example.com/b'),
        ],
      },
      state,
      budget,
      registry,
    })

    expect(registry.uniqueUrls.size).toBe(2)
  })

  it('emits a done synthesizing milestone once the final text lands', () => {
    const state = createResearchMilestoneState()
    const registry = createResearchSourceRegistry()
    const budget = getResearchBudget('standard')

    mapStepToResearchMilestones({
      step: {
        stepNumber: 0,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [],
        sources: [],
      },
      state,
      budget,
      registry,
    })

    const synthesizing = mapStepToResearchMilestones({
      step: {
        stepNumber: 1,
        text: 'Final report body',
        finishReason: 'stop',
        toolCalls: [],
        sources: [],
      },
      state,
      budget,
      registry,
    })

    expect(synthesizing).toEqual([
      {
        phase: 'synthesizing',
        label: 'Writing the report',
        status: 'done',
        detail: 'Writing the report',
      },
    ])
    expect(state.emittedPhases).toContain('synthesizing')
  })

  it('populates a detail for the analyzing phase once sources have accumulated', () => {
    const state = createResearchMilestoneState()
    const registry = createResearchSourceRegistry()
    const budget = getResearchBudget('standard')

    mapStepToResearchMilestones({
      step: {
        stepNumber: 0,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [],
        sources: [],
      },
      state,
      budget,
      registry,
    })

    mapStepToResearchMilestones({
      step: {
        stepNumber: 1,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [
          { toolName: 'web_search', input: { query: 'ai trends' } },
        ],
        sources: [urlSource('https://example.com/a')],
      },
      state,
      budget,
      registry,
    })

    const analyzing = mapStepToResearchMilestones({
      step: {
        stepNumber: 2,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [],
        sources: [],
      },
      state,
      budget,
      registry,
    })

    expect(analyzing).toEqual([
      {
        phase: 'analyzing',
        label: 'Analyzing the findings',
        status: 'active',
        count: 1,
        detail: 'Cross-checking 1 sources',
      },
    ])
  })
})

describe('buildInitialResearchPlanningMilestone', () => {
  it('marks planning as emitted and returns a done planning milestone', () => {
    const state = createResearchMilestoneState()
    const budget = getResearchBudget('quick')

    const milestone = buildInitialResearchPlanningMilestone({
      state,
      budget,
    })

    expect(milestone).toEqual({
      phase: 'planning',
      label: 'Planning the research',
      status: 'done',
      detail: 'Breaking the question into sub-topics and planning searches'
        + ` toward about ${budget.targetSources} sources.`,
    })
    expect(state.emittedPhases).toEqual(['planning'])
  })

  it('does not duplicate the planning phase when called more than once', () => {
    const state = createResearchMilestoneState()
    const budget = getResearchBudget('quick')

    buildInitialResearchPlanningMilestone({ state, budget })
    buildInitialResearchPlanningMilestone({ state, budget })

    expect(state.emittedPhases).toEqual(['planning'])
  })

  it('prevents mapStepToResearchMilestones from re-emitting planning on the first step', () => {
    const state = createResearchMilestoneState()
    const registry = createResearchSourceRegistry()
    const budget = getResearchBudget('quick')

    buildInitialResearchPlanningMilestone({ state, budget })

    const milestones = mapStepToResearchMilestones({
      step: {
        stepNumber: 0,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [],
        sources: [],
      },
      state,
      budget,
      registry,
    })

    expect(milestones).not.toContainEqual(
      expect.objectContaining({ phase: 'planning' }),
    )
  })
})

describe('registerResearchSources', () => {
  it('deduplicates the same source across protocol and query-string variants', () => {
    const registry = createResearchSourceRegistry()

    const first = registerResearchSources({
      sources: [
        urlSource('http://example.com/report?utm_source=newsletter'),
      ],
      registry,
    })
    const second = registerResearchSources({
      sources: [urlSource('https://www.example.com/report?ref=abc')],
      registry,
    })

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
    expect(registry.uniqueUrls.size).toBe(1)
  })

  it('treats different paths on the same domain as distinct sources', () => {
    const registry = createResearchSourceRegistry()

    registerResearchSources({
      sources: [urlSource('https://example.com/a')],
      registry,
    })
    registerResearchSources({
      sources: [urlSource('https://example.com/b')],
      registry,
    })

    expect(registry.uniqueUrls.size).toBe(2)
  })

  it('ignores non-url sources and unparsable urls', () => {
    const registry = createResearchSourceRegistry()

    const added = registerResearchSources({
      sources: [
        {
          type: 'source',
          sourceType: 'document',
          url: 'https://example.com/x',
        },
        { type: 'source', sourceType: 'url', url: 'not-a-url' },
        null,
        'a string',
      ],
      registry,
    })

    expect(added).toHaveLength(0)
    expect(registry.uniqueUrls.size).toBe(0)
  })
})

describe('shouldForceResearchSearch', () => {
  it('forces another search while below target and not on the final step', () => {
    expect(shouldForceResearchSearch({
      stepNumber: 2,
      maxSteps: 12,
      sourceCount: 5,
      targetSources: 30,
    })).toBe(true)
  })

  it('releases forcing once the target source count is reached', () => {
    expect(shouldForceResearchSearch({
      stepNumber: 2,
      maxSteps: 12,
      sourceCount: 30,
      targetSources: 30,
    })).toBe(false)
  })

  it('releases forcing on the final step even when still below target', () => {
    expect(shouldForceResearchSearch({
      stepNumber: 11,
      maxSteps: 12,
      sourceCount: 5,
      targetSources: 30,
    })).toBe(false)
  })

  it('treats a step past the final index as final too', () => {
    expect(shouldForceResearchSearch({
      stepNumber: 12,
      maxSteps: 12,
      sourceCount: 5,
      targetSources: 30,
    })).toBe(false)
  })
})

describe('shouldStopResearch', () => {
  it('never stops while below the source target', () => {
    expect(shouldStopResearch({
      sourceCount: 10,
      targetSources: 30,
      lastStepToolCallCount: 0,
    })).toBe(false)
  })

  it('does not stop once the target is reached if the model is still mid-search', () => {
    expect(shouldStopResearch({
      sourceCount: 30,
      targetSources: 30,
      lastStepToolCallCount: 1,
    })).toBe(false)
  })

  it('stops once the target is reached and the last step made no tool calls', () => {
    expect(shouldStopResearch({
      sourceCount: 30,
      targetSources: 30,
      lastStepToolCallCount: 0,
    })).toBe(true)
  })

  it('stops when the target is exceeded and the step is a pure synthesis step', () => {
    expect(shouldStopResearch({
      sourceCount: 42,
      targetSources: 30,
      lastStepToolCallCount: 0,
    })).toBe(true)
  })
})

describe('buildResearchStepInstructions', () => {
  it('instructs the model to keep searching while forcing is active', () => {
    const budget = getResearchBudget('standard')
    const instructions = buildResearchStepInstructions({
      baseInstructions: 'Base prompt.',
      budget,
      sourceCount: 5,
      forceSearch: true,
    })

    expect(instructions).toContain('Base prompt.')
    expect(instructions).toContain(
      `you have gathered 5 of about ${budget.targetSources}`,
    )
    expect(instructions).toContain('Do NOT write the final report yet')
  })

  it('instructs the model to synthesize once forcing is released', () => {
    const budget = getResearchBudget('standard')
    const instructions = buildResearchStepInstructions({
      baseInstructions: 'Base prompt.',
      budget,
      sourceCount: 32,
      forceSearch: false,
    })

    expect(instructions).toContain(
      `you have gathered 32 sources (target about ${budget.targetSources})`,
    )
    expect(instructions).toContain('write the final cited report now')
  })
})

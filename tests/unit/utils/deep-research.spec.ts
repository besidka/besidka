import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  buildResearchSystemPrompt,
  createResearchMilestoneState,
  getUserMessageText,
  mapStepToResearchMilestones,
} from '../../../server/utils/chats/deep-research'
import { getResearchBudget } from '../../../shared/utils/research'

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
    expect(prompt).toContain(`up to ${budget.maxSearches} focused web searches`)
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
    })

    expect(milestones).toEqual([
      {
        phase: 'planning',
        label: 'Planned the research approach',
        status: 'done',
      },
      {
        phase: 'analyzing',
        label: 'Analyzing the findings',
        status: 'active',
      },
    ])
    expect(state.emittedPhases).toEqual(['planning'])
  })

  it('does not re-emit planning on later steps', () => {
    const state = createResearchMilestoneState()
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
    })

    expect(milestones).toEqual([
      {
        phase: 'analyzing',
        label: 'Analyzing the findings',
        status: 'active',
      },
    ])
  })

  it('tracks searching progress, capped at the search budget', () => {
    const state = createResearchMilestoneState()
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
    })

    expect(secondSearch[0]).toMatchObject({
      phase: 'searching',
      count: budget.maxSearches,
    })
    expect(state.searchesRun).toBe(budget.maxSearches)
  })

  it('accumulates sources read while reading', () => {
    const state = createResearchMilestoneState()
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
    })

    const reading = mapStepToResearchMilestones({
      step: {
        stepNumber: 1,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [{ toolName: 'url_context' }],
        sources: [{}, {}],
      },
      state,
      budget,
    })

    expect(reading).toEqual([
      {
        phase: 'reading',
        label: 'Reading sources',
        status: 'active',
        count: 2,
      },
    ])
    expect(state.sourcesRead).toBe(2)
  })

  it('emits a done synthesizing milestone once the final text lands', () => {
    const state = createResearchMilestoneState()
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
    })

    expect(synthesizing).toEqual([
      {
        phase: 'synthesizing',
        label: 'Writing the report',
        status: 'done',
      },
    ])
    expect(state.emittedPhases).toContain('synthesizing')
  })
})

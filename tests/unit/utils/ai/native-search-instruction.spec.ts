import { describe, expect, it } from 'vitest'
import {
  buildNativeSearchInstruction,
  shouldNudgeNativeWebSearch,
} from '../../../../server/utils/ai/native-search-instruction'

describe('shouldNudgeNativeWebSearch', () => {
  const nativeTools = { web_search_preview: { type: 'provider-defined' } }

  it('nudges when native search is requested without a forced choice', () => {
    expect(shouldNudgeNativeWebSearch(
      ['web_search'],
      { tools: nativeTools },
    )).toBe(true)
  })

  it('does not nudge when the provider forces the tool choice', () => {
    expect(shouldNudgeNativeWebSearch(
      ['web_search'],
      {
        tools: nativeTools,
        toolChoice: { type: 'tool', toolName: 'web_search_preview' },
      },
    )).toBe(false)
  })

  it('does not nudge when the provider keeps native search exclusive', () => {
    expect(shouldNudgeNativeWebSearch(
      ['web_search'],
      { tools: nativeTools, exclusiveNativeWebSearch: true },
    )).toBe(false)
  })

  it('does not nudge when web search was not requested', () => {
    expect(shouldNudgeNativeWebSearch(
      [],
      { tools: nativeTools },
    )).toBe(false)
  })

  it('does not nudge when no native search tool was registered', () => {
    expect(shouldNudgeNativeWebSearch(['web_search'], {})).toBe(false)
    expect(shouldNudgeNativeWebSearch(
      ['web_search'],
      { tools: { web_search_brave: {} } },
    )).toBe(false)
  })
})

describe('buildNativeSearchInstruction', () => {
  it('tells the model to search before answering', () => {
    const instruction = buildNativeSearchInstruction()

    expect(instruction).toContain('Web search is available via the web search')
    expect(instruction).toContain('Search the web before answering')
  })

  it('tells the model not to search for the date and names none', () => {
    const instruction = buildNativeSearchInstruction()

    expect(instruction.match(/do not search for the current date/g))
      .toHaveLength(1)
    expect(instruction).not.toMatch(/\d{4}/)
    expect(instruction).not.toContain('Today')
  })
})

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
    const instruction = buildNativeSearchInstruction(new Date(0))

    expect(instruction).toContain('Web search is available via the web search')
    expect(instruction).toContain('Search the web before answering')
  })

  it('appends the current date instruction once', () => {
    const instruction = buildNativeSearchInstruction(
      new Date('2026-10-05T12:00:00Z'),
    )

    expect(instruction.match(/Today's date is/g)).toHaveLength(1)
    expect(instruction).toContain('2026-10-05')
  })
})

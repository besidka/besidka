import { describe, expect, it } from 'vitest'
import { createToolRoundApprovalState } from '~~/server/utils/tool-approval/round-state'

describe('createToolRoundApprovalState', () => {
  it('restores Google taint and the Google tool read from the reply', () => {
    const state = createToolRoundApprovalState([
      { type: 'text', text: 'Looking it up.' },
      {
        type: 'tool-google__drive_search',
        toolCallId: 'call-g',
        state: 'output-available',
        output: { references: [{ id: 'file-1' }], bodyRemoved: true },
      },
    ])

    expect([...state.taint]).toEqual(['google'])
    expect(state.toolReadSources.has('google')).toBe(true)
    expect(state.counters.builtInCalls).toBe(0)
  })

  it('restores connector and Besidka taint as before', () => {
    const state = createToolRoundApprovalState([
      {
        type: 'dynamic-tool',
        toolName: 'mcp__linear__list_issues',
        toolCallId: 'call-c',
        state: 'output-available',
        output: 'issues',
      },
      {
        type: 'tool-besidka__list_chats',
        toolCallId: 'call-b',
        state: 'output-available',
        output: 'chats',
      },
    ])

    expect([...state.taint].sort()).toEqual(['besidka', 'connector'])
    expect(state.toolReadSources.size).toBe(0)
  })

  it('starts empty for a reply without tool results', () => {
    const state = createToolRoundApprovalState('not parts')

    expect(state.taint.size).toBe(0)
  })
})

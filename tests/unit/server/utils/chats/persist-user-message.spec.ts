import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { hasMeaningfulAssistantParts } from '~~/server/utils/chats/persist-user-message'

describe('hasMeaningfulAssistantParts', () => {
  it('counts a data-artifact reference as an answer', () => {
    expect(hasMeaningfulAssistantParts([{
      type: 'data-artifact',
      data: { artifactId: 'a', version: 1, kind: 'html', title: 'Quiz' },
    }] as UIMessage['parts'])).toBe(true)
  })

  it('counts a failed artifact tool call, not an unfinished one', () => {
    expect(hasMeaningfulAssistantParts([{
      type: 'tool-create_artifact',
      toolCallId: 'call-1',
      state: 'output-error',
      input: { kind: 'html', title: 'Quiz' },
      errorText: 'Too large',
    }] as UIMessage['parts'])).toBe(true)
    expect(hasMeaningfulAssistantParts([{
      type: 'tool-create_artifact',
      toolCallId: 'call-1',
      state: 'input-streaming',
      input: undefined,
    }] as UIMessage['parts'])).toBe(false)
  })

  it('still ignores an empty reply', () => {
    expect(hasMeaningfulAssistantParts([
      { type: 'step-start' },
      { type: 'text', text: '   ' },
    ] as UIMessage['parts'])).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { getReasoningLiveProps } from '~/utils/chat-reasoning-live'

describe('getReasoningLiveProps', () => {
  it('passes the live status and thinking state to the live message', () => {
    expect(getReasoningLiveProps(true, 'streaming', true))
      .toEqual({ status: 'streaming', isTurnThinkingHeld: true })
    expect(getReasoningLiveProps(true, 'submitted', false))
      .toEqual({ status: 'submitted', isTurnThinkingHeld: false })
  })

  it('keeps every earlier message settled during a new turn', () => {
    expect(getReasoningLiveProps(false, 'streaming', true))
      .toEqual({ status: 'ready', isTurnThinkingHeld: false })
  })
})

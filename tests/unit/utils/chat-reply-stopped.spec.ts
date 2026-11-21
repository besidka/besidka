import { describe, expect, it } from 'vitest'
import {
  REPLY_STOPPED_PART_TYPE,
  createReplyStoppedPart,
  hasReplyStoppedPart,
  isTextlessStoppedReply,
} from '#shared/utils/chat-reply-stopped'

describe('chat reply stopped part', () => {
  it('creates the marker with the stop time', () => {
    expect(createReplyStoppedPart(new Date('2026-11-20T20:38:30Z'))).toEqual({
      type: REPLY_STOPPED_PART_TYPE,
      data: { stoppedAt: '2026-11-20T20:38:30.000Z' },
    })
  })

  it('finds the marker in a reply and nothing elsewhere', () => {
    expect(hasReplyStoppedPart([
      { type: 'text', text: 'Hal' },
      createReplyStoppedPart(),
    ])).toBe(true)
    expect(hasReplyStoppedPart([{ type: 'text', text: 'Hello' }])).toBe(false)
    expect(hasReplyStoppedPart(null)).toBe(false)
    expect(hasReplyStoppedPart([null, 'text'])).toBe(false)
  })

  it('tells a stopped reply without answer text apart', () => {
    const reasoning = { type: 'reasoning', text: 'Looking it up' }

    expect(isTextlessStoppedReply([reasoning, createReplyStoppedPart()]))
      .toBe(true)
    expect(isTextlessStoppedReply([
      reasoning,
      { type: 'text', text: '  ' },
      createReplyStoppedPart(),
    ])).toBe(true)
    expect(isTextlessStoppedReply([
      { type: 'text', text: 'Half an answer' },
      createReplyStoppedPart(),
    ])).toBe(false)
    expect(isTextlessStoppedReply([reasoning])).toBe(false)
  })
})

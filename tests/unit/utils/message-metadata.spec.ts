import { describe, expect, it } from 'vitest'
import {
  getMessageMetadata,
  getMessageUsedTools,
} from '../../../shared/utils/message-metadata'

describe('getMessageMetadata', () => {
  it('returns usage and createdAt from message metadata', () => {
    const usage = {
      model: 'gpt-5.4',
      provider: 'openai',
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
    }

    const result = getMessageMetadata({
      metadata: { usage, createdAt: 'x' },
    })

    expect(result).toEqual({ usage, createdAt: 'x' })
  })

  it('falls back to the top-level createdAt when no metadata', () => {
    const result = getMessageMetadata({ createdAt: 'top-level' })

    expect(result).toEqual({
      usage: undefined,
      createdAt: 'top-level',
    })
  })

  it('returns undefined usage and createdAt for an empty message', () => {
    const result = getMessageMetadata({})

    expect(result).toEqual({ usage: undefined, createdAt: undefined })
  })
})

describe('getMessageUsedTools', () => {
  it('returns web_search when a source-url part is present', () => {
    const result = getMessageUsedTools({
      parts: [
        { type: 'text', text: 'hello' },
        { type: 'source-url' },
      ],
    })

    expect(result).toEqual(['web_search'])
  })

  it('returns web_search when a source-document part is present', () => {
    const result = getMessageUsedTools({
      parts: [{ type: 'source-document' }],
    })

    expect(result).toEqual(['web_search'])
  })

  it('returns an empty array for text-only parts', () => {
    const result = getMessageUsedTools({
      parts: [{ type: 'text', text: 'hello' }],
    })

    expect(result).toEqual([])
  })

  it('returns an empty array when parts is missing', () => {
    expect(getMessageUsedTools({})).toEqual([])
  })

  it('returns an empty array when parts is not an array', () => {
    expect(getMessageUsedTools({ parts: 'not-an-array' })).toEqual([])
  })
})

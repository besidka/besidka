import { describe, expect, it } from 'vitest'
import {
  MAX_LOGGED_SDK_WARNINGS,
  serializeSdkWarning,
  summarizeSdkWarnings,
} from '../../../../server/utils/ai/sdk-warnings'

describe('serializeSdkWarning', () => {
  it('keeps type, feature and details of an unsupported warning', () => {
    expect(serializeSdkWarning({
      type: 'unsupported',
      feature: 'file part media type application/pdf',
      details: 'Only images are supported',
    })).toEqual({
      type: 'unsupported',
      feature: 'file part media type application/pdf',
      details: 'Only images are supported',
    })
  })

  it('keeps setting and message of a deprecated warning', () => {
    expect(serializeSdkWarning({
      type: 'deprecated',
      setting: 'maxTokens',
      message: 'Use maxOutputTokens instead',
    })).toEqual({
      type: 'deprecated',
      setting: 'maxTokens',
      message: 'Use maxOutputTokens instead',
    })
  })

  it('keeps the message of an other warning', () => {
    expect(serializeSdkWarning({ type: 'other', message: 'Heads up' }))
      .toEqual({ type: 'other', message: 'Heads up' })
  })

  it('truncates very long text', () => {
    const serialized = serializeSdkWarning({
      type: 'other',
      message: 'x'.repeat(5_000),
    })

    expect(serialized.message?.length).toBeLessThan(400)
  })
})

describe('summarizeSdkWarnings', () => {
  it('returns undefined when no step has warnings', () => {
    expect(summarizeSdkWarnings([])).toBeUndefined()
    expect(summarizeSdkWarnings([{ warnings: [] }, {}])).toBeUndefined()
  })

  it('flattens warnings across steps and counts them', () => {
    const summary = summarizeSdkWarnings([
      { warnings: [{ type: 'other', message: 'first' }] },
      {},
      { warnings: [{ type: 'compatibility', feature: 'second' }] },
    ])

    expect(summary).toEqual({
      count: 2,
      warnings: [
        { type: 'other', message: 'first' },
        { type: 'compatibility', feature: 'second' },
      ],
    })
  })

  it('caps the list but reports the uncapped count', () => {
    const summary = summarizeSdkWarnings([{
      warnings: Array.from({ length: 25 }, (_value, index) => {
        return { type: 'other' as const, message: `warning ${index}` }
      }),
    }])

    expect(summary?.count).toBe(25)
    expect(summary?.warnings).toHaveLength(MAX_LOGGED_SDK_WARNINGS)
  })
})

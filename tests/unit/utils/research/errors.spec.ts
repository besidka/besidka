import { describe, expect, it } from 'vitest'
import { mapResearchProviderError } from '../../../../server/utils/chats/errors'
import { ResearchAdapterError } from '../../../../server/utils/research/adapter-error'

describe('mapResearchProviderError', () => {
  it('classifies an OpenAI 403 verification message', () => {
    const error = new ResearchAdapterError(403, {
      error: {
        message: 'Your organization must be verified to use this model.',
      },
    })

    const result = mapResearchProviderError({
      error,
      providerId: 'openai',
    })

    expect(result.code).toBe('research-verification-required')
    expect(result.status).toBe(403)
  })

  it('classifies an OpenAI 403 tier message', () => {
    const error = new ResearchAdapterError(403, {
      error: { message: 'This model requires a higher usage tier.' },
    })

    const result = mapResearchProviderError({
      error,
      providerId: 'openai',
    })

    expect(result.code).toBe('research-tier-required')
  })

  it('classifies a Google 403 permission message', () => {
    const error = new ResearchAdapterError(403, {
      error: { message: 'The caller does not have permission' },
    })

    const result = mapResearchProviderError({
      error,
      providerId: 'google',
    })

    expect(result.code).toBe('research-paid-tier-required')
  })

  it('classifies a 401 as provider-auth for either provider', () => {
    const openAiError = new ResearchAdapterError(401, {
      error: { message: 'Invalid API key' },
    })
    const googleError = new ResearchAdapterError(401, {
      error: { message: 'Invalid API key' },
    })

    expect(mapResearchProviderError({
      error: openAiError,
      providerId: 'openai',
    }).code).toBe('provider-auth')
    expect(mapResearchProviderError({
      error: googleError,
      providerId: 'google',
    }).code).toBe('provider-auth')
  })

  it('falls back to the caller-supplied code for an unclassified error', () => {
    const error = new ResearchAdapterError(500, {
      error: { message: 'Internal server error' },
    })

    const result = mapResearchProviderError({
      error,
      providerId: 'openai',
      code: 'research-start-failed',
      message: 'Could not start the research job.',
    })

    expect(result.code).toBe('research-start-failed')
    expect(result.message).toBe('Could not start the research job.')
  })

  it('falls back to normalizeChatError for a non-adapter error', () => {
    const result = mapResearchProviderError({
      error: new Error('network down'),
      providerId: 'openai',
    })

    expect(result.code).toBe('unknown')
  })

  it('never surfaces the raw provider message for a provider-auth error', () => {
    const error = new ResearchAdapterError(401, {
      error: {
        message: 'Incorrect API key provided: sk-bcd9f****...2b4f',
      },
    })

    const result = mapResearchProviderError({
      error,
      providerId: 'openai',
    })

    expect(result.code).toBe('provider-auth')
    expect(result.message).toBe(
      'The provider rejected the API credentials.',
    )
    expect(result.message).not.toContain('sk-')
  })
})

describe('ResearchAdapterError', () => {
  it('redacts a masked OpenAI key fragment from the stored message', () => {
    const error = new ResearchAdapterError(401, {
      error: {
        message: 'Incorrect API key provided: sk-bcd9f****...2b4f',
      },
    })

    expect(error.message).toContain('[redacted]')
    expect(error.message).not.toContain('sk-')
    expect(error.message).not.toContain('bcd9f')
  })

  it('redacts a raw unmasked key fragment from the stored message', () => {
    const error = new ResearchAdapterError(401, {
      message: 'Invalid API key: sk-live1234567890abcdefghijklmnop',
    })

    expect(error.message).toContain('[redacted]')
    expect(error.message).not.toContain('sk-live')
  })

  it('leaves an ordinary provider error message untouched', () => {
    const error = new ResearchAdapterError(500, {
      error: { message: 'The model is currently overloaded.' },
    })

    expect(error.message).toBe('The model is currently overloaded.')
  })
})

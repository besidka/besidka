import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordKeyEvent } from '../../../../server/utils/analytics/key-events'

const mocks = vi.hoisted(() => {
  return {
    set: vi.fn(),
    useRequestLogger: vi.fn(),
    requestEvent: { context: {} },
  }
})

vi.mock('~~/server/utils/logging/request-logger', () => {
  return { useRequestLogger: mocks.useRequestLogger }
})

describe('recordKeyEvent', () => {
  beforeEach(() => {
    mocks.set.mockReset()
    mocks.useRequestLogger.mockReset()
    mocks.useRequestLogger.mockReturnValue({ set: mocks.set })
    vi.stubGlobal('useEvent', () => mocks.requestEvent)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves the request logger from the current request event', () => {
    recordKeyEvent('openai', 'created')

    expect(mocks.useRequestLogger)
      .toHaveBeenCalledExactlyOnceWith(mocks.requestEvent)
  })

  it('throws instead of silently dropping the event outside a request', () => {
    vi.stubGlobal('useEvent', () => {
      throw new Error('no event context')
    })

    expect(() => recordKeyEvent('openai', 'created')).toThrow(
      'no event context',
    )
  })

  const keyProviderCases = [
    ['google', 'google'],
    ['openai', 'openai'],
    ['anthropic', 'anthropic'],
    ['xai', 'xai'],
    ['deepseek', 'deepseek'],
    ['moonshotai', 'moonshotai'],
    ['qwen', 'qwen'],
    ['openrouter', 'openrouter'],
    ['brave', 'brave'],
    ['exa', 'exa'],
    ['vercel-gateway', 'vercel'],
    ['cloudflare-gateway', 'cloudflare'],
  ] as const

  for (const [keyProviderId, provider] of keyProviderCases) {
    it(`logs ${keyProviderId} as provider ${provider}`, () => {
      recordKeyEvent(keyProviderId, 'created')

      expect(mocks.set).toHaveBeenCalledExactlyOnceWith({
        attributes: { keys: { provider, action: 'created' } },
      })
    })
  }

  for (const action of ['created', 'updated', 'deleted'] as const) {
    it(`logs the ${action} action`, () => {
      recordKeyEvent('openai', action)

      expect(mocks.set).toHaveBeenCalledWith({
        attributes: { keys: { provider: 'openai', action } },
      })
    })
  }

  it('does not set analytics.event', () => {
    recordKeyEvent('openai', 'created')

    expect(mocks.set.mock.calls[0]![0]).not.toHaveProperty('analytics')
  })

  it('falls back to the raw id for an unknown provider', () => {
    recordKeyEvent('mystery', 'deleted')

    expect(mocks.set).toHaveBeenCalledWith({
      attributes: { keys: { provider: 'mystery', action: 'deleted' } },
    })
  })

  it('uses an explicit logger when given', () => {
    const logger = { set: vi.fn() }

    recordKeyEvent('brave', 'updated', logger)

    expect(logger.set).toHaveBeenCalledWith({
      attributes: { keys: { provider: 'brave', action: 'updated' } },
    })
    expect(mocks.set).not.toHaveBeenCalled()
    expect(mocks.useRequestLogger).not.toHaveBeenCalled()
  })
})

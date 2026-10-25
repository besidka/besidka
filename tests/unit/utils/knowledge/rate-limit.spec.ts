import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enforceKnowledgeWriteRateLimit } from '~~/server/utils/knowledge/rate-limit'
import { createFakeKnowledgeKv } from '../../../setup/helpers/knowledge-api'

vi.mock('evlog', () => ({
  createError: (input: {
    message: string
    status?: number
    why?: string
    fix?: string
  }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
}))

describe('enforceKnowledgeWriteRateLimit', () => {
  let kv: ReturnType<typeof createFakeKnowledgeKv>

  function eventWithHeaders() {
    return { res: { headers: new Headers() } } as never
  }

  beforeEach(() => {
    kv = createFakeKnowledgeKv()
    vi.stubGlobal('useKV', () => kv)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-26T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows 60 requests in a window and rejects the 61st with 429', async () => {
    for (let count = 0; count < 60; count++) {
      await enforceKnowledgeWriteRateLimit(1)
    }

    const event = eventWithHeaders()

    await expect(enforceKnowledgeWriteRateLimit(1, event)).rejects
      .toMatchObject({
        status: 429,
        message: 'Too many requests',
        why: expect.any(String),
        fix: expect.any(String),
      })
    expect(Number((event as any).res.headers.get('retry-after')))
      .toBeGreaterThan(0)
  })

  it('counts each user separately', async () => {
    for (let count = 0; count < 60; count++) {
      await enforceKnowledgeWriteRateLimit(1)
    }

    await expect(enforceKnowledgeWriteRateLimit(2)).resolves.toBeUndefined()
    await expect(enforceKnowledgeWriteRateLimit(1)).rejects
      .toMatchObject({ status: 429 })
  })

  it('allows requests again once the window has passed', async () => {
    for (let count = 0; count < 60; count++) {
      await enforceKnowledgeWriteRateLimit(1)
    }

    vi.setSystemTime(new Date('2026-10-26T10:01:01Z'))

    await expect(enforceKnowledgeWriteRateLimit(1)).resolves.toBeUndefined()
  })

  it('keys the counter by user id under a knowledge prefix', async () => {
    await enforceKnowledgeWriteRateLimit(7)

    expect([...kv.values.keys()]).toEqual(['knowledge-write:rate-limit:7'])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSkillKv } from '../../../../../setup/helpers/skills-db'
import type { FakeSkillKv } from '../../../../../setup/helpers/skills-db'

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  logger: { set: vi.fn() },
}))

vi.mock('cloudflare:workers', () => ({ env: mocks.env }))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

const {
  enforceSkillBurstLimit,
  enforceSkillImportRateLimit,
} = await import('~~/server/utils/skills/import/rate-limit')

function createEvent() {
  const headers = new Headers()

  return { event: { context: {}, res: { headers } } as never, headers }
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number }
  }

  throw new Error('Expected a rejection')
}

describe('skills import rate limits', () => {
  let kv: FakeSkillKv

  beforeEach(() => {
    vi.clearAllMocks()
    kv = createFakeSkillKv()
    vi.stubGlobal('useKV', () => kv)

    for (const key of Object.keys(mocks.env)) {
      Reflect.deleteProperty(mocks.env, key)
    }
  })

  describe('burst limit', () => {
    it('is keyed by user and lets a request through while it succeeds', async () => {
      const limit = vi.fn(async () => ({ success: true }))

      mocks.env.SKILLS_RATE_LIMITER = { limit }

      await enforceSkillBurstLimit(createEvent().event, 7)

      expect(limit).toHaveBeenCalledWith({ key: 'skills-import:7' })
    })

    it('answers 429 with Retry-After 60 when the binding refuses', async () => {
      mocks.env.SKILLS_RATE_LIMITER = {
        limit: async () => ({ success: false }),
      }

      const { event, headers } = createEvent()
      const failure = await failureOf(enforceSkillBurstLimit(event, 7))

      expect(failure.status).toBe(429)
      expect(headers.get('Retry-After')).toBe('60')
    })

    it('is skipped when the binding is missing or throws', async () => {
      await expect(enforceSkillBurstLimit(createEvent().event, 7))
        .resolves.toBeUndefined()

      mocks.env.SKILLS_RATE_LIMITER = {
        limit: async () => {
          throw new Error('binding down')
        },
      }

      await expect(enforceSkillBurstLimit(createEvent().event, 7))
        .resolves.toBeUndefined()
    })
  })

  describe('hourly counter', () => {
    it('applies the burst limit first', async () => {
      mocks.env.SKILLS_RATE_LIMITER = {
        limit: async () => ({ success: false }),
      }

      const failure = await failureOf(
        enforceSkillImportRateLimit(createEvent().event, 7),
      )

      expect(failure.status).toBe(429)
      expect(kv.put).not.toHaveBeenCalled()
    })

    it('fails closed with 429 and Retry-After 60 when KV cannot be written', async () => {
      kv.put.mockImplementation(async () => {
        throw new Error('KV write limit')
      })

      const { event, headers } = createEvent()
      const failure = await failureOf(enforceSkillImportRateLimit(event, 7))

      expect(failure.status).toBe(429)
      expect(headers.get('Retry-After')).toBe('60')
      expect(mocks.logger.set).toHaveBeenCalledWith({
        attributes: {
          skills: {
            rateLimit: { failedClosed: true, error: 'KV write limit' },
          },
        },
      })
    })

    it('fails closed when KV cannot be read', async () => {
      kv.get.mockImplementation(async () => {
        throw new Error('KV read failed')
      })

      const failure = await failureOf(
        enforceSkillImportRateLimit(createEvent().event, 7),
      )

      expect(failure.status).toBe(429)
    })

    it('allows ten an hour per user and refuses the eleventh', async () => {
      for (let index = 0; index < 10; index += 1) {
        await enforceSkillImportRateLimit(createEvent().event, 7)
      }

      const { event, headers } = createEvent()

      expect((await failureOf(enforceSkillImportRateLimit(event, 7))).status)
        .toBe(429)
      expect(Number(headers.get('Retry-After'))).toBeGreaterThan(0)
      await expect(enforceSkillImportRateLimit(createEvent().event, 8))
        .resolves.toBeUndefined()
    })
  })
})

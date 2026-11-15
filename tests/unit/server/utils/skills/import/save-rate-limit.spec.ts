import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SKILL_SAVES_PER_HOUR } from '#shared/utils/skills-policy'
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

const { enforceSkillSaveRateLimit } = await import(
  '~~/server/utils/skills/import/rate-limit'
)

function createEvent() {
  const headers = new Headers()

  return { event: { context: {}, res: { headers } } as never, headers }
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, message: string }
  }

  throw new Error('Expected a rejection')
}

describe('enforceSkillSaveRateLimit', () => {
  let kv: FakeSkillKv

  beforeEach(() => {
    vi.clearAllMocks()
    kv = createFakeSkillKv()
    vi.stubGlobal('useKV', () => kv)
  })

  it('allows 120 saves an hour and then answers 429 with a retry time', async () => {
    expect(SKILL_SAVES_PER_HOUR).toBe(120)

    for (let save = 0; save < SKILL_SAVES_PER_HOUR; save++) {
      await enforceSkillSaveRateLimit(createEvent().event, 7)
    }

    const { event, headers } = createEvent()
    const failure = await failureOf(enforceSkillSaveRateLimit(event, 7))

    expect(failure.status).toBe(429)
    expect(failure.message).toBe('Too many skill saves')
    expect(Number(headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('counts each user separately and apart from imports', async () => {
    for (let save = 0; save < SKILL_SAVES_PER_HOUR; save++) {
      await enforceSkillSaveRateLimit(createEvent().event, 7)
    }

    await expect(enforceSkillSaveRateLimit(createEvent().event, 8))
      .resolves.toBeUndefined()

    const keys = [...kv.values.keys()]

    expect(keys.every((key) => {
      return key.includes('skills-save-rate-limit')
    })).toBe(true)
  })

  it('does not call the import burst limiter', async () => {
    const limit = vi.fn(async () => ({ success: false }))

    mocks.env.SKILLS_RATE_LIMITER = { limit }

    await enforceSkillSaveRateLimit(createEvent().event, 7)

    expect(limit).not.toHaveBeenCalled()
  })

  it('fails closed with 429 and Retry-After 60 when KV cannot be written', async () => {
    kv.put.mockImplementation(async () => {
      throw new Error('KV write limit')
    })

    const { event, headers } = createEvent()
    const failure = await failureOf(enforceSkillSaveRateLimit(event, 7))

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
})

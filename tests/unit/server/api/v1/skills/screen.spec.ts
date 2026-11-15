import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeSkillFiles } from '#shared/utils/skills/analyze'
import type { SkillArchiveFile } from '#shared/utils/skills/archive'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  createFakeSkillKv,
  seedSkillWithFiles,
} from '../../../../../setup/helpers/skills-db'
import type {
  FakeSkillBucket,
  FakeSkillKv,
} from '../../../../../setup/helpers/skills-db'
import {
  createSkillsRouteEvent,
  stubSkillsRouteGlobals,
} from '../../../../../setup/helpers/skills-route'
import { skillMarkdown } from '../../../../../setup/helpers/skill-archives'

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(),
  logger: { set: vi.fn() },
  decide: vi.fn(),
  resolveModel: vi.fn(),
  requireLegalConsent: vi.fn(),
  enforceRateLimit: vi.fn(),
  order: [] as string[],
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    experimental_decide: (...args: unknown[]) => mocks.decide(...args),
  }
})

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

vi.mock('nuxt/server', async () => {
  const { skillsNuxtServerMockFactory } = await import(
    '../../../../../setup/helpers/skills-route'
  )

  return await skillsNuxtServerMockFactory()
})

vi.mock('~~/server/utils/features/guards', () => ({
  requireFeature: async (_event: unknown, flag: string) => {
    if (!mocks.flags.has(flag)) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }

    mocks.order.push('feature')

    return { active: true }
  },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

vi.mock('~~/server/utils/legal/consent', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/legal/consent')
  >()

  return {
    ...actual,
    requireLegalConsent: (...args: unknown[]) => {
      return mocks.requireLegalConsent(...args)
    },
  }
})

vi.mock('~~/server/utils/skills/import/rate-limit', () => ({
  enforceSkillScreenRateLimit: (...args: unknown[]) => {
    return mocks.enforceRateLimit(...args)
  },
}))

vi.mock('~~/server/utils/jev/roles', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/jev/roles')
  >()

  return {
    ...actual,
    resolveJevRoleModel: (...args: unknown[]) => mocks.resolveModel(...args),
  }
})

const { createJevDecisionModel } = await import('~~/server/utils/jev/client')
const { stageSkillImport } = await import(
  '~~/server/utils/skills/import/stage'
)

const encoder = new TextEncoder()

async function importHandler(path: string) {
  const { default: handler } = await import(path)

  return handler as (input: unknown) => Promise<any>
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string }
  }

  throw new Error('Expected a rejection')
}

function archiveFile(path: string, text: string): SkillArchiveFile {
  return { path, bytes: encoder.encode(text), text }
}

describe('skill screen routes', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeSkillKv
  let bucket: FakeSkillBucket
  let userId: number
  let stageId: string
  let skillId: string

  function stageEvent(overrides: {
    headers?: Record<string, string>
    body?: unknown
    stage?: string
  } = {}) {
    return createSkillsRouteEvent({
      params: { stageId: overrides.stage ?? stageId },
      headers: overrides.headers,
      body: overrides.body ?? {},
    })
  }

  function versionEvent(overrides: {
    body?: unknown
    version?: string
    id?: string
  } = {}) {
    return createSkillsRouteEvent({
      params: { id: overrides.id ?? skillId, v: overrides.version ?? '1' },
      body: overrides.body ?? {},
    })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    kv = createFakeSkillKv()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db, null)
    mocks.flags.clear()
    mocks.flags.add('skills')
    mocks.order.length = 0
    mocks.decide.mockReset()
    mocks.decide.mockImplementation(async () => {
      return {
        answers: Object.fromEntries([
          'i2_attack',
          'k1_send_out',
          'k2_conceal',
          'k3_secrets',
          'k4_run_remote',
          'k5_off_purpose',
        ].map((id) => {
          return [id, { type: 'boolean', probability: 0.01 }]
        })),
        usage: { inputTokens: 5 },
      }
    })
    mocks.resolveModel.mockReset()
    mocks.resolveModel.mockImplementation(async () => {
      return createJevDecisionModel('ts-test-key')
    })
    mocks.requireLegalConsent.mockReset()
    mocks.requireLegalConsent.mockImplementation(async () => {
      mocks.order.push('consent')
    })
    mocks.enforceRateLimit.mockReset()
    mocks.enforceRateLimit.mockImplementation(async () => {
      mocks.order.push('rate-limit')
    })
    stubSkillsRouteGlobals({ userId, db: testDb.db, kv, bucket })

    const files = [archiveFile('SKILL.md', skillMarkdown())]
    const analysis = await analyzeSkillFiles({ files, folderName: null })

    if (!analysis.ok) {
      throw new Error('Invalid sample')
    }

    stageId = (await stageSkillImport({
      kv,
      bucket,
      userId,
      source: 'zip',
      sourceVersion: 'sha256-aaaaaaaaaaaaaaaa',
      fileName: 'review.zip',
      analysis,
      files,
    })).stageId
    skillId = (await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: { 'SKILL.md': skillMarkdown() },
    })).skillId
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  describe('POST /api/v1/skills/import/[stageId]/screen', () => {
    it('checks session, feature, consent and rate limit before any work', async () => {
      const handler = await importHandler(
        '~~/server/api/v1/skills/import/[stageId]/screen.post',
      )
      const result = await handler(stageEvent())

      expect(result.state).toBe('screened')
      expect(mocks.order).toEqual(['feature', 'consent', 'rate-limit'])
      expect(mocks.requireLegalConsent).toHaveBeenCalledWith(userId)
      expect(mocks.enforceRateLimit).toHaveBeenCalledWith(
        expect.anything(),
        userId,
      )
    })

    it('answers 401 without a session and sends nothing', async () => {
      stubSkillsRouteGlobals({ userId: 0, db: testDb.db, kv, bucket })

      const handler = await importHandler(
        '~~/server/api/v1/skills/import/[stageId]/screen.post',
      )

      expect((await failureOf(handler(stageEvent()))).status).toBe(401)
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('answers 404 when the skills flag is off', async () => {
      mocks.flags.clear()

      const handler = await importHandler(
        '~~/server/api/v1/skills/import/[stageId]/screen.post',
      )

      expect((await failureOf(handler(stageEvent()))).status).toBe(404)
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('refuses a cross-site request before consent and the limiter', async () => {
      const handler = await importHandler(
        '~~/server/api/v1/skills/import/[stageId]/screen.post',
      )
      const failure = await failureOf(handler(stageEvent({
        headers: { 'sec-fetch-site': 'cross-site' },
      })))

      expect(failure.status).toBe(403)
      expect(mocks.requireLegalConsent).not.toHaveBeenCalled()
      expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('stops on a missing consent', async () => {
      mocks.requireLegalConsent.mockRejectedValue(
        Object.assign(new Error('Consent'), { status: 403 }),
      )

      const handler = await importHandler(
        '~~/server/api/v1/skills/import/[stageId]/screen.post',
      )

      expect((await failureOf(handler(stageEvent()))).status).toBe(403)
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('stops on the rate limit', async () => {
      mocks.enforceRateLimit.mockRejectedValue(
        Object.assign(new Error('Too many'), { status: 429 }),
      )

      const handler = await importHandler(
        '~~/server/api/v1/skills/import/[stageId]/screen.post',
      )

      expect((await failureOf(handler(stageEvent()))).status).toBe(429)
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('rejects a body that is not { rest?: boolean }', async () => {
      const handler = await importHandler(
        '~~/server/api/v1/skills/import/[stageId]/screen.post',
      )

      expect((await failureOf(handler(stageEvent({
        body: { rest: 'yes' },
      })))).status).toBe(400)
      expect((await failureOf(handler(stageEvent({
        body: { other: true },
      })))).status).toBe(400)
      await expect(handler(stageEvent({ body: undefined }))).resolves
        .toMatchObject({ state: 'screened' })
    })

    it('answers 404 for the stage of another account', async () => {
      const otherUserId = await seedUser(testDb.db, null)
      const files = [archiveFile('SKILL.md', skillMarkdown())]
      const analysis = await analyzeSkillFiles({ files, folderName: null })

      if (!analysis.ok) {
        throw new Error('Invalid sample')
      }

      const foreign = await stageSkillImport({
        kv,
        bucket,
        userId: otherUserId,
        source: 'zip',
        sourceVersion: 'sha256-bbbbbbbbbbbbbbbb',
        fileName: 'review.zip',
        analysis,
        files,
      })
      const handler = await importHandler(
        '~~/server/api/v1/skills/import/[stageId]/screen.post',
      )

      expect((await failureOf(handler(stageEvent({
        stage: foreign.stageId,
      })))).status).toBe(404)
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('answers unavailable and sends nothing without a key or with the role off', async () => {
      mocks.resolveModel.mockResolvedValue(null)

      const handler = await importHandler(
        '~~/server/api/v1/skills/import/[stageId]/screen.post',
      )

      await expect(handler(stageEvent())).resolves.toMatchObject({
        state: 'unavailable',
        calls: 0,
      })
      expect(mocks.decide).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/v1/skills/[id]/versions/[v]/screen', () => {
    it('runs the same checks and screens the version', async () => {
      const handler = await importHandler(
        '~~/server/api/v1/skills/[id]/versions/[v]/screen.post',
      )
      const result = await handler(versionEvent())

      expect(result.state).toBe('screened')
      expect(mocks.order).toEqual(['feature', 'consent', 'rate-limit'])
    })

    it('refuses a cross-site request and a version that is not a number', async () => {
      const handler = await importHandler(
        '~~/server/api/v1/skills/[id]/versions/[v]/screen.post',
      )
      const crossSite = createSkillsRouteEvent({
        params: { id: skillId, v: '1' },
        headers: { 'sec-fetch-site': 'cross-site' },
        body: {},
      })

      expect((await failureOf(handler(crossSite))).status).toBe(403)
      expect((await failureOf(handler(versionEvent({
        version: 'abc',
      })))).status).toBe(404)
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('answers 404 for a skill that is not yours', async () => {
      const otherUserId = await seedUser(testDb.db, null)
      const foreign = await seedSkillWithFiles(testDb.db, bucket, {
        userId: otherUserId,
        files: { 'SKILL.md': skillMarkdown() },
      })
      const handler = await importHandler(
        '~~/server/api/v1/skills/[id]/versions/[v]/screen.post',
      )

      expect((await failureOf(handler(versionEvent({
        id: foreign.skillId,
      })))).status).toBe(404)
      expect(mocks.decide).not.toHaveBeenCalled()
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillKv,
  seedSkill,
} from '../../setup/helpers/skills-db'
import {
  GITHUB_SHA_ONE,
  GITHUB_SHA_TWO,
  createGithubMock,
} from '../../setup/helpers/github-mock'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const SCHEDULED_TIME = Date.UTC(2026, 10, 14, 12, 0, 0)
const HOURLY_CRON = '0 * * * *'

function createLoggerDouble() {
  const set = vi.fn()
  const emit = vi.fn().mockReturnValue(undefined)
  const createLogger = vi.fn().mockReturnValue({ set, emit })

  return { set, emit, createLogger }
}

async function importSweep() {
  return import('../../../server/plugins/skills-update-sweep')
}

describe('skills update sweep plugin', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('logs counts only and emits 200', async () => {
    const github = createGithubMock()

    github.setBranch('main', GITHUB_SHA_TWO)
    await seedSkill(testDb.db, userId, {
      sourceKind: 'github',
      sourceUrl: 'https://github.com/o/r',
      sourceRef: 'main',
      sourceVersion: GITHUB_SHA_ONE,
    })

    const { set, emit, createLogger } = createLoggerDouble()
    const { runSkillsUpdateSweepJob } = await importSweep()

    await runSkillsUpdateSweepJob({
      controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: testDb.db,
      kv: createFakeSkillKv(),
      fetchImpl: github.fetch as unknown as typeof fetch,
    })

    expect(createLogger).toHaveBeenCalledWith({
      method: 'CRON',
      path: '/internal/jobs/skills-update-sweep',
      requestId: `skills-update-sweep-${SCHEDULED_TIME}`,
    })
    expect(set).toHaveBeenCalledWith({
      attributes: {
        skillsUpdateSweep: {
          cron: HOURLY_CRON,
          skillsConsidered: 1,
          skillsChecked: 1,
          updatesFound: 1,
          upToDate: 0,
          missing: 0,
          failed: 0,
          rateLimited: false,
        },
      },
    })
    expect(JSON.stringify(set.mock.calls)).not.toMatch(/https?:|o\/r|main/)
    expect(emit).toHaveBeenCalledWith({ status: 200 })
  })

  it('emits 500 and logs the error when the database fails', async () => {
    const { set, emit, createLogger } = createLoggerDouble()
    const { runSkillsUpdateSweepJob } = await importSweep()

    await runSkillsUpdateSweepJob({
      controller: { cron: HOURLY_CRON, scheduledTime: SCHEDULED_TIME },
      createLogger,
      db: {
        select: () => {
          throw new Error('d1 down')
        },
      } as never,
      kv: createFakeSkillKv(),
    })

    expect(set).toHaveBeenCalledWith({
      attributes: { skillsUpdateSweep: { error: 'd1 down' } },
    })
    expect(emit).toHaveBeenCalledWith({ status: 500 })
  })

  it('registers a handler that runs on the hourly cron only', async () => {
    const hooks: Array<(payload: unknown) => Promise<void>> = []
    const plugin = (await importSweep()).default as unknown as (
      nitroApp: unknown,
    ) => void

    plugin({
      hooks: {
        hook: (_name: string, handler: (payload: unknown) => Promise<void>) => {
          hooks.push(handler)
        },
      },
    })

    expect(hooks).toHaveLength(1)

    await hooks[0]!({
      controller: { cron: '*/5 * * * *', scheduledTime: SCHEDULED_TIME },
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  minutesBefore,
  seedEntry,
  seedProject,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const LEASE_KEY_PREFIX = 'project-memory-refreshing:'

async function loadMemoryModule() {
  return await import('~~/server/utils/projects/memory')
}

describe('project memory utils', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let leaseValue: string | null
  let kvGet: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, {})
    leaseValue = null
    kvGet = vi.fn(async () => leaseValue)
    vi.stubGlobal('useKV', () => ({ get: kvGet }))
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  async function readProject(projectId: string) {
    return await testDb.db.query.projects.findFirst({
      where: { id: projectId },
    })
  }

  describe('markProjectsMemoryStale', () => {
    it('marks an idle project without entries stale', async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'idle',
        memoryError: 'old error',
      })
      const { markProjectsMemoryStale } = await loadMemoryModule()

      await markProjectsMemoryStale([projectId], userId, testDb.db)

      const project = await readProject(projectId)

      expect(project?.memoryStatus).toBe('stale')
      expect(project?.memoryDirtyAt).toBeInstanceOf(Date)
      expect(project?.memoryError).toBeNull()
    })

    it('marks a project that already has entries stale', async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'ready',
      })

      await seedEntry(testDb.db, userId, { projectId })

      const { markProjectsMemoryStale } = await loadMemoryModule()

      await markProjectsMemoryStale([projectId], userId, testDb.db)

      const project = await readProject(projectId)

      expect(project?.memoryStatus).toBe('stale')
      expect(project?.memoryDirtyAt).toBeInstanceOf(Date)
    })

    it('marks a migrated project stale', async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'ready',
        memoryMigratedAt: minutesBefore(100),
      })
      const { markProjectsMemoryStale } = await loadMemoryModule()

      await markProjectsMemoryStale([projectId], userId, testDb.db)

      expect((await readProject(projectId))?.memoryStatus).toBe('stale')
    })

    it('never touches a disabled project', async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'disabled',
      })
      const { markProjectsMemoryStale } = await loadMemoryModule()

      await markProjectsMemoryStale([projectId], userId, testDb.db)

      const project = await readProject(projectId)

      expect(project?.memoryStatus).toBe('disabled')
      expect(project?.memoryDirtyAt).toBeNull()
    })

    it('only touches projects of the given user', async () => {
      const otherUserId = await seedUser(testDb.db, {})
      const projectId = await seedProject(testDb.db, otherUserId, {
        memoryStatus: 'ready',
      })
      const { markProjectsMemoryStale } = await loadMemoryModule()

      await markProjectsMemoryStale([projectId], userId, testDb.db)

      expect((await readProject(projectId))?.memoryStatus).toBe('ready')
    })

    it('ignores empty ids and does nothing without projects', async () => {
      const update = vi.fn()
      const { markProjectsMemoryStale } = await loadMemoryModule()

      await markProjectsMemoryStale(
        [null, undefined],
        userId,
        { update } as never,
      )

      expect(update).not.toHaveBeenCalled()
    })

    it('updates a project listed twice once', async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'idle',
      })
      const update = vi.spyOn(testDb.db, 'update')
      const { markProjectsMemoryStale } = await loadMemoryModule()

      await markProjectsMemoryStale(
        [projectId, projectId, null],
        userId,
        testDb.db,
      )

      expect(update).toHaveBeenCalledTimes(1)
    })
  })

  describe('display status', () => {
    it('reports a refreshing project without a live lease as stale', async () => {
      const { resolveProjectMemoryDisplayStatus } = await loadMemoryModule()

      expect(
        await resolveProjectMemoryDisplayStatus('refreshing', 'project-1'),
      ).toBe('stale')
      expect(kvGet).toHaveBeenCalledWith(`${LEASE_KEY_PREFIX}project-1`)
    })

    it('keeps refreshing while the lease is held', async () => {
      leaseValue = '1'

      const { resolveProjectMemoryDisplayStatus } = await loadMemoryModule()

      expect(
        await resolveProjectMemoryDisplayStatus('refreshing', 'project-1'),
      ).toBe('refreshing')
    })

    it('treats an unreadable lease as held and logs it', async () => {
      const logger = { set: vi.fn() }

      kvGet.mockRejectedValueOnce(new Error('kv down'))

      const { resolveProjectMemoryDisplayStatus } = await loadMemoryModule()

      expect(
        await resolveProjectMemoryDisplayStatus(
          'refreshing',
          'project-1',
          logger,
        ),
      ).toBe('refreshing')
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          projectMemoryLease: {
            operation: 'get',
            error: 'kv down',
          },
        },
      })
    })

    it.each([
      'idle',
      'stale',
      'ready',
      'failed',
      'unavailable',
      'disabled',
    ] as const)('returns %s unchanged without reading the lease', async (
      status,
    ) => {
      const { resolveProjectMemoryDisplayStatus } = await loadMemoryModule()

      expect(
        await resolveProjectMemoryDisplayStatus(status, 'project-1'),
      ).toBe(status)
      expect(kvGet).not.toHaveBeenCalled()
    })
  })

  describe('getMemoryProviderId', () => {
    it('maps a gateway selection to its key provider id', async () => {
      const { getMemoryProviderId } = await loadMemoryModule()

      expect(getMemoryProviderId({
        gatewayId: null,
        providerId: 'openai',
      } as never)).toBe('openai')
      expect(getMemoryProviderId({
        gatewayId: 'vercel',
        providerId: 'openai',
      } as never)).not.toBe('openai')
    })
  })

  describe('exported text helpers', () => {
    it('joins only trimmed text parts', async () => {
      const { projectMemoryMessageText } = await loadMemoryModule()

      expect(projectMemoryMessageText([
        { type: 'text', text: '  first  ' },
        { type: 'reasoning', text: 'hidden' },
        { type: 'text', text: '   ' },
        { type: 'text', text: 'second' },
      ] as never)).toBe('first\nsecond')
      expect(projectMemoryMessageText(null as never)).toBe('')
    })

    it('truncates with an ellipsis only past the limit', async () => {
      const { truncateProjectMemoryText } = await loadMemoryModule()

      expect(truncateProjectMemoryText('abc', 3)).toBe('abc')
      expect(truncateProjectMemoryText('abcdef', 4)).toBe('abc…')
    })
  })
})

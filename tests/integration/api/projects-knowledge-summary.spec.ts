import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import {
  createKnowledgeApiHarness,
  knowledgeEvent,
  loadKnowledgeHandler,
} from '../../setup/helpers/knowledge-api'
import type { KnowledgeApiHarness } from '../../setup/helpers/knowledge-api'

const mocks = vi.hoisted(() => ({
  invalidateStorageCache: vi.fn(),
  commitKnowledgeChange: vi.fn(),
  ensureKnowledgePackFresh: vi.fn(),
  createRequestLogger: vi.fn(),
  backgroundLogger: { set: vi.fn(), emit: vi.fn() },
}))

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
  useLogger: () => ({ set: vi.fn() }),
  createRequestLogger: (...args: unknown[]) => {
    return mocks.createRequestLogger(...args)
  },
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

vi.mock('~~/server/utils/knowledge/pack', () => ({
  commitKnowledgeChange: mocks.commitKnowledgeChange,
  ensureKnowledgePackFresh: mocks.ensureKnowledgePackFresh,
}))

const OWNER = 1
const PROJECT = 10
const projectPublicId = encodePublicId(PROJECT)

describe('project knowledge summary API', () => {
  let harness: KnowledgeApiHarness

  async function getSummary(waitUntil?: (promise: Promise<unknown>) => void) {
    const handler = await loadKnowledgeHandler('summary')

    return await handler(knowledgeEvent({
      projectId: projectPublicId,
      waitUntil,
    }))
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    harness = createKnowledgeApiHarness()
    harness.install()
    mocks.ensureKnowledgePackFresh.mockResolvedValue(undefined)
    mocks.createRequestLogger.mockReturnValue(mocks.backgroundLogger)
  })

  afterEach(() => {
    harness.close()
  })

  it('returns an empty summary for a project without knowledge', async () => {
    harness.testDb.insertProject({ id: PROJECT, userId: OWNER })

    expect(await getSummary()).toEqual({
      projectId: projectPublicId,
      mode: 'auto',
      version: 0,
      packVersion: null,
      items: [],
      totals: {
        latinChars: 0,
        cyrillicChars: 0,
        otherChars: 0,
        textBytes: 0,
        items: 0,
      },
    })
  })

  it('lists the items in pack order with totals computed from the database', async () => {
    harness.testDb.insertProject({
      id: PROJECT,
      userId: OWNER,
      knowledgeMode: 'search',
      knowledgeVersion: 3,
      knowledgePackVersion: 3,
    })
    harness.testDb.insertItem({
      id: 2,
      userId: OWNER,
      projectId: PROJECT,
      title: 'Second',
      createdAt: 2000,
      textBytes: 30,
      latinChars: 10,
      cyrillicChars: 5,
      otherChars: 1,
    })
    harness.testDb.insertItem({
      id: 1,
      userId: OWNER,
      projectId: PROJECT,
      title: 'First',
      createdAt: 1000,
      textBytes: 12,
      latinChars: 4,
      cyrillicChars: 2,
      otherChars: 3,
    })
    harness.testDb.insertProject({ id: 11, userId: OWNER })
    harness.testDb.insertItem({
      userId: OWNER,
      projectId: 11,
      title: 'Elsewhere',
      textBytes: 999,
    })

    const summary = await getSummary()

    expect(summary).toMatchObject({
      projectId: projectPublicId,
      mode: 'search',
      version: 3,
      packVersion: 3,
      totals: {
        latinChars: 14,
        cyrillicChars: 7,
        otherChars: 4,
        textBytes: 42,
        items: 2,
      },
    })
    expect(summary.items.map((item: { title: string }) => {
      return item.title
    })).toEqual(['First', 'Second'])
    expect(summary.items[0]).toMatchObject({
      id: encodePublicId(1),
      projectId: projectPublicId,
      kind: 'note',
      sendAsNativePdf: false,
      pinned: false,
    })
  })

  it('schedules a pack refresh through waitUntil when the pack is behind', async () => {
    harness.testDb.insertProject({
      id: PROJECT,
      userId: OWNER,
      knowledgeVersion: 3,
      knowledgePackVersion: 1,
    })

    const waitUntil = vi.fn()

    await getSummary(waitUntil)

    expect(waitUntil).toHaveBeenCalledOnce()
    expect(mocks.ensureKnowledgePackFresh).toHaveBeenCalledWith({
      userId: OWNER,
      projectId: PROJECT,
      logger: mocks.backgroundLogger,
    })
  })

  it('gives the background rebuild its own logger and emits it when done', async () => {
    harness.testDb.insertProject({
      id: PROJECT,
      userId: OWNER,
      knowledgeVersion: 3,
      knowledgePackVersion: 1,
    })

    const scheduled: Array<Promise<unknown>> = []

    await getSummary((promise) => {
      scheduled.push(promise)
    })

    expect(mocks.createRequestLogger).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', waitUntil: expect.any(Function) }),
    )
    expect(mocks.backgroundLogger.set).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: OWNER,
        projectId: projectPublicId,
      }),
    )

    await Promise.all(scheduled)

    expect(mocks.backgroundLogger.emit).toHaveBeenCalledOnce()
  })

  it('emits the background logger even when the rebuild rejects', async () => {
    harness.testDb.insertProject({
      id: PROJECT,
      userId: OWNER,
      knowledgeVersion: 3,
      knowledgePackVersion: 1,
    })
    mocks.ensureKnowledgePackFresh.mockRejectedValue(new Error('boom'))

    const scheduled: Array<Promise<unknown>> = []

    await getSummary((promise) => {
      scheduled.push(promise)
    })
    await Promise.allSettled(scheduled)

    expect(mocks.backgroundLogger.emit).toHaveBeenCalledOnce()
  })

  it('is never cached', async () => {
    harness.testDb.insertProject({ id: PROJECT, userId: OWNER })

    const handler = await loadKnowledgeHandler('summary')
    const event = knowledgeEvent({ projectId: projectPublicId })

    await handler(event)

    expect(event.res.headers.get('cache-control')).toBe('no-store')
  })

  it('creates no background logger when the pack is fresh', async () => {
    harness.testDb.insertProject({
      id: PROJECT,
      userId: OWNER,
      knowledgeVersion: 2,
      knowledgePackVersion: 2,
    })

    await getSummary(vi.fn())

    expect(mocks.createRequestLogger).not.toHaveBeenCalled()
  })

  it('schedules a refresh when no pack exists yet', async () => {
    harness.testDb.insertProject({
      id: PROJECT,
      userId: OWNER,
      knowledgeVersion: 1,
      knowledgePackVersion: null,
    })

    const waitUntil = vi.fn()

    await getSummary(waitUntil)

    expect(waitUntil).toHaveBeenCalledOnce()
  })

  it('does not schedule anything when the pack is fresh', async () => {
    harness.testDb.insertProject({
      id: PROJECT,
      userId: OWNER,
      knowledgeVersion: 2,
      knowledgePackVersion: 2,
    })

    const waitUntil = vi.fn()

    await getSummary(waitUntil)

    expect(waitUntil).not.toHaveBeenCalled()
    expect(mocks.ensureKnowledgePackFresh).not.toHaveBeenCalled()
  })

  it('does not wait for the rebuild', async () => {
    harness.testDb.insertProject({
      id: PROJECT,
      userId: OWNER,
      knowledgeVersion: 2,
      knowledgePackVersion: 1,
    })
    mocks.ensureKnowledgePackFresh.mockReturnValue(new Promise(() => {}))

    const summary = await getSummary(vi.fn())

    expect(summary.version).toBe(2)
  })

  it('skips the rebuild instead of running it inline without waitUntil', async () => {
    harness.testDb.insertProject({
      id: PROJECT,
      userId: OWNER,
      knowledgeVersion: 2,
      knowledgePackVersion: 1,
    })

    const summary = await getSummary()

    expect(summary.packVersion).toBe(1)
    expect(mocks.ensureKnowledgePackFresh).not.toHaveBeenCalled()
  })

  it('does not touch R2', async () => {
    harness.testDb.insertProject({ id: PROJECT, userId: OWNER })
    harness.testDb.insertItem({ userId: OWNER, projectId: PROJECT })

    await getSummary()

    expect(harness.bucket.calls).toEqual([])
  })
})

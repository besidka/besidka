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
  createRequestLogger: () => ({ set: vi.fn(), emit: vi.fn() }),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

const OWNER = 1
const PROJECT = 10
const projectPublicId = encodePublicId(PROJECT)

function createFakeKv() {
  const values = new Map<string, string>()

  return {
    values,
    get: async (key: string) => {
      return values.get(key) ?? null
    },
    put: async (key: string, value: string) => {
      values.set(key, value)
    },
    delete: async (key: string) => {
      values.delete(key)
    },
  }
}

describe('project knowledge routes with the real pack module', () => {
  let harness: KnowledgeApiHarness

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    harness = createKnowledgeApiHarness()
    harness.install()
    vi.stubGlobal('useKV', () => createFakeKv())
    harness.testDb.insertProject({ id: PROJECT, userId: OWNER })
    harness.testDb.insertStorage({ userId: OWNER })
    mocks.invalidateStorageCache.mockResolvedValue(undefined)
  })

  afterEach(() => {
    harness.close()
  })

  it('creates a note, builds a pack, then deletes the item with its text object', async () => {
    const createHandler = await loadKnowledgeHandler('noteCreate')
    const note = await createHandler(knowledgeEvent({
      projectId: projectPublicId,
      body: { title: 'Plan', body: '# Plan\n\nShip the thing.' },
    }))
    const afterCreate = harness.testDb.getProjectRow(PROJECT)

    expect(afterCreate).toMatchObject({
      knowledge_version: 1,
      knowledge_pack_version: 1,
    })

    const objectKeys = [...harness.bucket.objects.keys()].sort()

    expect(objectKeys).toEqual([
      `knowledge/u${OWNER}/p${PROJECT}/items/1.md`,
      `knowledge/u${OWNER}/p${PROJECT}/pack/v1.jsonl.gz`,
    ])

    const deleteHandler = await loadKnowledgeHandler('itemDelete')
    const result = await deleteHandler(knowledgeEvent({
      projectId: projectPublicId,
      itemId: note.id,
    }))

    expect(result).toEqual({ version: 2, packVersion: 2 })
    expect(harness.testDb.countItems(PROJECT)).toBe(0)
    expect(harness.bucket.objects.has(
      `knowledge/u${OWNER}/p${PROJECT}/items/1.md`,
    )).toBe(false)
    expect(harness.testDb.getProjectRow(PROJECT)).toMatchObject({
      knowledge_version: 2,
      knowledge_pack_version: 2,
    })
  })

  it('removes the objects of every id of a commit remove', async () => {
    const createHandler = await loadKnowledgeHandler('noteCreate')
    const first = await createHandler(knowledgeEvent({
      projectId: projectPublicId,
      body: { title: 'One', body: 'First body' },
    }))
    const second = await createHandler(knowledgeEvent({
      projectId: projectPublicId,
      body: { title: 'Two', body: 'Second body' },
    }))
    const commitHandler = await loadKnowledgeHandler('commit')
    const result = await commitHandler(knowledgeEvent({
      projectId: projectPublicId,
      body: { remove: [first.id, second.id] },
    }))

    expect(result).toMatchObject({ removed: 2, skipped: [] })
    expect(harness.testDb.countItems(PROJECT)).toBe(0)
    expect(
      [...harness.bucket.objects.keys()].filter((key) => {
        return key.includes('/items/')
      }),
    ).toEqual([])
  })
  it('rebuilds a current pack on an empty commit after an uncommitted batch', async () => {
    const createHandler = await loadKnowledgeHandler('noteCreate')

    await createHandler(knowledgeEvent({
      projectId: projectPublicId,
      body: { title: 'Plan', body: 'First body' },
    }))

    expect(harness.testDb.getProjectRow(PROJECT)).toMatchObject({
      knowledge_version: 1,
      knowledge_pack_version: 1,
    })

    const itemsHandler = await loadKnowledgeHandler('itemsCreate')

    await itemsHandler(knowledgeEvent({
      projectId: projectPublicId,
      body: {
        items: [{
          title: 'Second upload',
          mediaType: 'text/plain',
          extractor: 'text',
          extractStatus: 'ready',
          text: 'Aurora launches in May.',
        }],
      },
    }))

    expect(harness.testDb.getProjectRow(PROJECT)).toMatchObject({
      knowledge_version: 2,
      knowledge_pack_version: 1,
    })

    const commitHandler = await loadKnowledgeHandler('commit')
    const result = await commitHandler(knowledgeEvent({
      projectId: projectPublicId,
      body: {},
    }))

    expect(result).toMatchObject({ version: 2, packVersion: 2, removed: 0 })
    expect(harness.testDb.getProjectRow(PROJECT)).toMatchObject({
      knowledge_version: 2,
      knowledge_pack_version: 2,
    })

    expect(harness.bucket.objects.has(
      `knowledge/u${OWNER}/p${PROJECT}/pack/v2.jsonl.gz`,
    )).toBe(true)
    expect(harness.bucket.calls).toContainEqual({
      operation: 'get',
      key: `knowledge/u${OWNER}/p${PROJECT}/items/2.md`,
    })
  })

  it('does not bump or rebuild when an uncommitted batch only repeats an item', async () => {
    const itemsHandler = await loadKnowledgeHandler('itemsCreate')
    const body = {
      items: [{
        title: 'Upload',
        mediaType: 'text/plain',
        extractor: 'text',
        extractStatus: 'ready',
        contentHash: 'c'.repeat(64),
        text: 'Same text.',
      }],
    }

    await itemsHandler(knowledgeEvent({ projectId: projectPublicId, body }))

    const commitHandler = await loadKnowledgeHandler('commit')

    await commitHandler(knowledgeEvent({
      projectId: projectPublicId,
      body: {},
    }))

    const before = harness.testDb.getProjectRow(PROJECT)

    await itemsHandler(knowledgeEvent({ projectId: projectPublicId, body }))
    await commitHandler(knowledgeEvent({
      projectId: projectPublicId,
      body: {},
    }))

    expect(before).toMatchObject({
      knowledge_version: 1,
      knowledge_pack_version: 1,
    })
    expect(harness.testDb.getProjectRow(PROJECT)).toEqual(before)
  })
})

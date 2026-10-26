import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  KnowledgePackHeader,
  KnowledgePackLine,
} from '#shared/types/project-knowledge.d'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { loadKnowledgeSendData } from '~~/server/utils/knowledge/send-data'
import { createKnowledgeTestDb } from '../../../setup/helpers/knowledge-send-db'

const USER_ID = 1
const OTHER_USER_ID = 2
const PROJECT_ID = 5
const PACK_VERSION = 3

const mocks = vi.hoisted(() => ({
  readKnowledgePack: vi.fn(),
}))

vi.mock('~~/server/utils/knowledge/pack', () => ({
  readKnowledgePack: (input: unknown) => mocks.readKnowledgePack(input),
}))

function buildPack(itemId: string): {
  header: KnowledgePackHeader
  lines: KnowledgePackLine[]
} {
  return {
    header: {
      type: 'header',
      version: PACK_VERSION,
      builtAt: '2026-10-25T00:00:00.000Z',
      items: [{
        itemId,
        updatedAt: '2026-10-25T00:00:00.000Z',
        chunks: 1,
      }],
    },
    lines: [{
      type: 'chunk',
      itemId,
      ordinal: 0,
      breadcrumb: 'Section 0',
      text: 'first chunk',
    }],
  }
}

describe('loadKnowledgeSendData', () => {
  let testDb: ReturnType<typeof createKnowledgeTestDb>
  let loggerSet: ReturnType<typeof vi.fn>

  beforeEach(() => {
    testDb = createKnowledgeTestDb()
    mocks.readKnowledgePack.mockReset()
    mocks.readKnowledgePack.mockResolvedValue(null)
    loggerSet = vi.fn()
    vi.stubGlobal('useDb', () => testDb.db)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  function load() {
    return loadKnowledgeSendData({
      userId: USER_ID,
      projectId: PROJECT_ID,
      logger: { set: loggerSet },
    })
  }

  function seedProject(packVersion: number | null = PACK_VERSION) {
    testDb.insertProject({
      id: PROJECT_ID,
      userId: USER_ID,
      knowledgeMode: 'search',
      knowledgeVersion: 4,
      knowledgePackVersion: packVersion,
    })
    testDb.insertItem({
      id: 11,
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Notes',
      latinChars: 20,
    })
  }

  describe('items and state', () => {
    it('returns null without a pack read when the project has no items', async () => {
      testDb.insertProject({ id: PROJECT_ID, userId: USER_ID })

      const data = await load()

      expect(data).toBeNull()
      expect(mocks.readKnowledgePack).not.toHaveBeenCalled()
    })

    it('returns null when the items belong to another user', async () => {
      testDb.insertProject({ id: PROJECT_ID, userId: OTHER_USER_ID })
      testDb.insertItem({
        id: 11,
        userId: OTHER_USER_ID,
        projectId: PROJECT_ID,
      })

      expect(await load()).toBeNull()
    })

    it('returns null when the project row is not the user', async () => {
      testDb.insertProject({ id: PROJECT_ID, userId: OTHER_USER_ID })
      testDb.insertItem({ id: 11, userId: USER_ID, projectId: PROJECT_ID })

      expect(await load()).toBeNull()
    })

    it('reads the project state', async () => {
      seedProject()

      const data = await load()

      expect(data?.state).toEqual({
        mode: 'search',
        version: 4,
        packVersion: PACK_VERSION,
      })
    })

    it('defaults a never-built project to null mode and version 0', async () => {
      testDb.insertProject({ id: PROJECT_ID, userId: USER_ID })
      testDb.insertItem({ id: 11, userId: USER_ID, projectId: PROJECT_ID })

      const data = await load()

      expect(data?.state).toEqual({
        mode: null,
        version: 0,
        packVersion: null,
      })
    })

    it('maps items to the wire shape with public ids', async () => {
      seedProject()
      testDb.insertFile({ id: 7, userId: USER_ID, storageKey: 'users/1/a.pdf' })
      testDb.insertItem({
        id: 12,
        userId: USER_ID,
        projectId: PROJECT_ID,
        fileId: 7,
        title: 'Contract',
        relativePath: 'legal/contract.pdf',
        mediaType: 'application/pdf',
        sizeBytes: 2048,
        pageCount: 14,
        sendAsNativePdf: true,
        pinned: true,
        latinChars: 100,
        cyrillicChars: 50,
        otherChars: 5,
      })

      const data = await load()
      const note = data?.items.find(item => item.id === encodePublicId(11))
      const pdf = data?.items.find(item => item.id === encodePublicId(12))

      expect(data?.items).toHaveLength(2)
      expect(note).toMatchObject({
        projectId: encodePublicId(PROJECT_ID),
        fileId: null,
        storageKey: null,
        sendAsNativePdf: false,
        pinned: false,
      })
      expect(pdf).toMatchObject({
        projectId: encodePublicId(PROJECT_ID),
        fileId: encodePublicId(7),
        storageKey: 'users/1/a.pdf',
        title: 'Contract',
        relativePath: 'legal/contract.pdf',
        mediaType: 'application/pdf',
        sizeBytes: 2048,
        pageCount: 14,
        sendAsNativePdf: true,
        pinned: true,
        latinChars: 100,
        cyrillicChars: 50,
        otherChars: 5,
        extractStatus: 'ready',
      })
      expect(pdf?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('does not join a file owned by another user', async () => {
      seedProject()
      testDb.insertFile({
        id: 7,
        userId: OTHER_USER_ID,
        storageKey: 'users/2/a.pdf',
      })
      testDb.insertItem({
        id: 12,
        userId: USER_ID,
        projectId: PROJECT_ID,
        fileId: 7,
      })

      const data = await load()
      const pdf = data?.items.find(item => item.id === encodePublicId(12))

      expect(pdf?.storageKey).toBeNull()
    })

    it('resolves to null and logs when the database fails', async () => {
      vi.stubGlobal('useDb', () => {
        throw new Error('d1 unavailable')
      })

      expect(await load()).toBeNull()
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { knowledge: { error: 'd1 unavailable' } },
      })
    })
  })

  describe('loadPack', () => {
    it('does not read the pack until loadPack is called', async () => {
      seedProject()

      await load()

      expect(mocks.readKnowledgePack).not.toHaveBeenCalled()
    })

    it('reads the pack through readKnowledgePack at the pointer version',
      async () => {
        const pack = buildPack(encodePublicId(11))

        seedProject()
        mocks.readKnowledgePack.mockResolvedValueOnce(pack)

        const data = await load()

        expect(await data!.loadPack()).toBe(pack)
        expect(mocks.readKnowledgePack).toHaveBeenCalledTimes(1)
        expect(mocks.readKnowledgePack).toHaveBeenCalledWith({
          userId: USER_ID,
          projectId: PROJECT_ID,
          version: PACK_VERSION,
        })
        expect(loggerSet).not.toHaveBeenCalled()
      })

    it('memoizes the pack per call', async () => {
      seedProject()
      mocks.readKnowledgePack.mockResolvedValue(buildPack('x'))

      const data = await load()
      const [first, second] = await Promise.all([
        data!.loadPack(),
        data!.loadPack(),
      ])
      const third = await data!.loadPack()

      expect(first).not.toBeNull()
      expect(second).toBe(first)
      expect(third).toBe(first)
      expect(mocks.readKnowledgePack).toHaveBeenCalledTimes(1)
    })

    it('memoizes a null result too, without a second read', async () => {
      seedProject()

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(await data!.loadPack()).toBeNull()
      expect(mocks.readKnowledgePack).toHaveBeenCalledTimes(1)
    })

    it('returns null without a read when no pack was built', async () => {
      seedProject(null)

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(mocks.readKnowledgePack).not.toHaveBeenCalled()
      expect(loggerSet).not.toHaveBeenCalled()
    })

    it('loads each call of loadKnowledgeSendData separately', async () => {
      seedProject()
      mocks.readKnowledgePack.mockResolvedValue(buildPack('x'))

      const first = await load()
      const second = await load()

      await first!.loadPack()
      await second!.loadPack()

      expect(mocks.readKnowledgePack).toHaveBeenCalledTimes(2)
    })

    it('returns null and logs when readKnowledgePack rejects', async () => {
      seedProject()
      mocks.readKnowledgePack.mockRejectedValueOnce(new Error('r2 timeout'))

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { knowledge: { error: 'r2 timeout' } },
      })
    })
  })
})

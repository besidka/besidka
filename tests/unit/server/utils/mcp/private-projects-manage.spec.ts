import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeItem } from '#shared/types/project-knowledge.d'

const mocks = vi.hoisted(() => {
  return {
    decodeKnowledgeEntityId: vi.fn(),
    commitKnowledgeRequest: vi.fn(),
    updateKnowledgeItemMetadata: vi.fn(),
    updateKnowledgeMode: vi.fn(),
    updateKnowledgeNote: vi.fn(),
    enforceKnowledgeWriteRateLimit: vi.fn(),
    renameProject: vi.fn(),
    setProjectPinned: vi.fn(),
    setProjectArchived: vi.fn(),
    deleteProject: vi.fn(),
    applyProjectMemoryEnabled: vi.fn(),
    applyProjectUseAccountMemory: vi.fn(),
    refreshProjectMemoryFromChats: vi.fn(),
    toggleProjectMemory: vi.fn(),
    listKnowledgeItems: vi.fn(),
    toKnowledgeItemWire: vi.fn(),
    getResults: [] as unknown[],
    logger: { set: vi.fn() },
  }
})

vi.mock('~~/server/utils/knowledge/access', () => {
  return { decodeKnowledgeEntityId: mocks.decodeKnowledgeEntityId }
})

vi.mock('~~/server/utils/knowledge/ingest', () => {
  return {
    commitKnowledgeRequest: mocks.commitKnowledgeRequest,
    createKnowledgeNote: vi.fn(),
    hashKnowledgeText: vi.fn(),
    ingestKnowledgeItems: vi.fn(),
    updateKnowledgeItemMetadata: mocks.updateKnowledgeItemMetadata,
    updateKnowledgeMode: mocks.updateKnowledgeMode,
    updateKnowledgeNote: mocks.updateKnowledgeNote,
  }
})

vi.mock('~~/server/utils/knowledge/rate-limit', () => {
  return {
    enforceKnowledgeWriteRateLimit: mocks.enforceKnowledgeWriteRateLimit,
  }
})

vi.mock('~~/server/utils/knowledge/items', () => {
  return {
    listKnowledgeItems: mocks.listKnowledgeItems,
    toKnowledgeItemWire: mocks.toKnowledgeItemWire,
  }
})

vi.mock('~~/server/utils/knowledge/text-store', () => {
  return { getKnowledgeItemText: vi.fn() }
})

vi.mock('~~/server/utils/projects/lifecycle', () => {
  return {
    renameProject: mocks.renameProject,
    setProjectPinned: mocks.setProjectPinned,
    setProjectArchived: mocks.setProjectArchived,
    deleteProject: mocks.deleteProject,
  }
})

vi.mock('~~/server/utils/projects/memory-toggle', () => {
  return {
    applyProjectMemoryEnabled: mocks.applyProjectMemoryEnabled,
    applyProjectUseAccountMemory: mocks.applyProjectUseAccountMemory,
  }
})

vi.mock('~~/server/utils/projects/memory-refresh', () => {
  return {
    refreshProjectMemoryFromChats: mocks.refreshProjectMemoryFromChats,
    toggleProjectMemory: mocks.toggleProjectMemory,
  }
})

const {
  MCP_KNOWLEDGE_DELETE_MAX_ITEMS,
  deleteMcpKnowledgeItems,
  deleteMcpProject,
  getMcpProject,
  listMcpProjects,
  updateMcpKnowledgeItem,
  updateMcpProject,
} = await import('~~/server/utils/mcp/private/projects')

function createQueuedDb() {
  const chain = {
    from: () => chain,
    where: () => chain,
    get: async () => mocks.getResults.shift(),
  }

  return {
    select: () => chain,
  } as unknown as ReturnType<typeof useDb>
}

function projectState(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proj1',
    name: 'Vaimo',
    knowledgeMode: null,
    pinnedAt: null,
    archivedAt: null,
    memoryStatus: 'idle',
    memoryUpdatedAt: null,
    useAccountMemory: null,
    ...overrides,
  }
}

function knowledgeItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item1',
    kind: 'note',
    title: 'Note',
    description: null,
    ...overrides,
  }
}

function knowledgeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: 'item1',
    projectId: 'proj1',
    kind: 'note',
    fileId: null,
    title: 'Note',
    description: null,
    relativePath: null,
    folderId: null,
    contentHash: null,
    mediaType: 'text/markdown',
    sizeBytes: null,
    pageCount: null,
    textBytes: 4,
    latinChars: 4,
    cyrillicChars: 0,
    otherChars: 0,
    extractStatus: 'ready',
    extractError: null,
    extractor: 'note',
    sendAsNativePdf: false,
    pinned: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('MCP project management domain functions', () => {
  beforeEach(() => {
    for (const mock of [
      mocks.decodeKnowledgeEntityId,
      mocks.commitKnowledgeRequest,
      mocks.updateKnowledgeItemMetadata,
      mocks.updateKnowledgeMode,
      mocks.updateKnowledgeNote,
      mocks.enforceKnowledgeWriteRateLimit,
      mocks.renameProject,
      mocks.setProjectPinned,
      mocks.setProjectArchived,
      mocks.deleteProject,
      mocks.applyProjectMemoryEnabled,
      mocks.applyProjectUseAccountMemory,
      mocks.refreshProjectMemoryFromChats,
      mocks.toggleProjectMemory,
      mocks.listKnowledgeItems,
      mocks.toKnowledgeItemWire,
    ]) {
      mock.mockReset()
    }

    mocks.getResults = []
    mocks.decodeKnowledgeEntityId.mockReturnValue(7)
    mocks.toKnowledgeItemWire.mockImplementation((row: unknown) => row)
  })

  describe('updateMcpProject', () => {
    it('answers 404 for a foreign project and writes nothing', async () => {
      mocks.getResults = [undefined]

      await expect(updateMcpProject(
        createQueuedDb(),
        1,
        { projectId: 'proj1', name: 'New' },
        mocks.logger,
      )).rejects.toMatchObject({ status: 404 })
      expect(mocks.renameProject).not.toHaveBeenCalled()
    })

    it('answers 404 for a malformed project id', async () => {
      mocks.decodeKnowledgeEntityId.mockReturnValue(null)

      await expect(updateMcpProject(
        createQueuedDb(),
        1,
        { projectId: '!!', pinned: true },
        mocks.logger,
      )).rejects.toMatchObject({ status: 404 })
      expect(mocks.setProjectPinned).not.toHaveBeenCalled()
    })

    it('rejects a call without any field', async () => {
      mocks.getResults = [{ id: 'proj1' }]

      await expect(updateMcpProject(
        createQueuedDb(),
        1,
        { projectId: 'proj1' },
        mocks.logger,
      )).rejects.toMatchObject({ status: 400 })
    })

    it('rejects an invalid name before any write', async () => {
      for (const name of ['   ', 'x'.repeat(101), 'bad‮name']) {
        mocks.getResults = [{ id: 'proj1' }]

        await expect(updateMcpProject(
          createQueuedDb(),
          1,
          { projectId: 'proj1', name, pinned: true },
          mocks.logger,
        )).rejects.toMatchObject({ status: 400 })
      }

      expect(mocks.renameProject).not.toHaveBeenCalled()
      expect(mocks.setProjectPinned).not.toHaveBeenCalled()
    })

    it('sets the given values and passes them explicitly, never toggling',
      async () => {
        mocks.getResults = [
          { id: 'proj1' },
          projectState({
            name: 'New',
            pinnedAt: new Date('2026-10-02T00:00:00.000Z'),
            archivedAt: null,
            knowledgeMode: 'search',
            memoryStatus: 'ready',
            useAccountMemory: false,
          }),
          { total: 3 },
        ]

        const result = await updateMcpProject(
          createQueuedDb(),
          1,
          {
            projectId: 'proj1',
            name: '  New  ',
            pinned: true,
            archived: false,
            knowledgeMode: 'search',
            memoryEnabled: true,
            useAccountMemory: false,
          },
          mocks.logger,
        )

        expect(mocks.renameProject)
          .toHaveBeenCalledWith(expect.anything(), 1, 'proj1', 'New')
        expect(mocks.setProjectPinned)
          .toHaveBeenCalledWith(expect.anything(), 1, 'proj1', true)
        expect(mocks.setProjectArchived)
          .toHaveBeenCalledWith(expect.anything(), 1, 'proj1', false)
        expect(mocks.updateKnowledgeMode).toHaveBeenCalledWith(
          { userId: 1, projectId: 7, logger: mocks.logger },
          'search',
        )
        expect(mocks.applyProjectUseAccountMemory)
          .toHaveBeenCalledWith('proj1', 1, false, expect.anything())
        expect(mocks.applyProjectMemoryEnabled)
          .toHaveBeenCalledWith('proj1', 1, true, expect.anything(), {
            forwardOnly: true,
          })
        expect(result).toEqual({
          id: 'proj1',
          name: 'New',
          pinned: true,
          archived: false,
          knowledgeMode: 'search',
          memory: {
            enabled: true,
            status: 'ready',
            useAccountMemory: false,
            updatedAt: null,
            entryCount: 3,
          },
        })
      })

    it('touches only the fields that were sent', async () => {
      mocks.getResults = [
        { id: 'proj1' },
        projectState(),
        { total: 0 },
      ]

      await updateMcpProject(
        createQueuedDb(),
        1,
        { projectId: 'proj1', archived: true },
        mocks.logger,
      )

      expect(mocks.setProjectArchived).toHaveBeenCalledTimes(1)
      expect(mocks.renameProject).not.toHaveBeenCalled()
      expect(mocks.setProjectPinned).not.toHaveBeenCalled()
      expect(mocks.updateKnowledgeMode).not.toHaveBeenCalled()
      expect(mocks.applyProjectMemoryEnabled).not.toHaveBeenCalled()
      expect(mocks.applyProjectUseAccountMemory).not.toHaveBeenCalled()
      expect(mocks.enforceKnowledgeWriteRateLimit).not.toHaveBeenCalled()
    })

    it('uses the knowledge write limiter only for the knowledge mode',
      async () => {
        mocks.getResults = [
          { id: 'proj1' },
          projectState(),
          { total: 0 },
        ]

        await updateMcpProject(
          createQueuedDb(),
          1,
          { projectId: 'proj1', knowledgeMode: 'full' },
          mocks.logger,
        )

        expect(mocks.enforceKnowledgeWriteRateLimit)
          .toHaveBeenCalledWith(1)
      })

    it('turning memory on never refreshes from chats', async () => {
      mocks.getResults = [
        { id: 'proj1' },
        projectState({ memoryStatus: 'idle' }),
        { total: 0 },
      ]

      const result = await updateMcpProject(
        createQueuedDb(),
        1,
        { projectId: 'proj1', memoryEnabled: true },
        mocks.logger,
      )

      expect(mocks.applyProjectMemoryEnabled)
        .toHaveBeenCalledWith('proj1', 1, true, expect.anything(), {
          forwardOnly: true,
        })
      expect(mocks.refreshProjectMemoryFromChats).not.toHaveBeenCalled()
      expect(mocks.toggleProjectMemory).not.toHaveBeenCalled()
      expect(result.memory.enabled).toBe(true)
    })

    it('reports memory as off when the project is disabled', async () => {
      mocks.getResults = [
        { id: 'proj1' },
        projectState({ memoryStatus: 'disabled' }),
        { total: 2 },
      ]

      const result = await updateMcpProject(
        createQueuedDb(),
        1,
        { projectId: 'proj1', memoryEnabled: false },
        mocks.logger,
      )

      expect(mocks.applyProjectMemoryEnabled)
        .toHaveBeenCalledWith('proj1', 1, false, expect.anything(), {
          forwardOnly: true,
        })
      expect(result.memory).toMatchObject({
        enabled: false,
        status: 'disabled',
        entryCount: 2,
      })
    })
  })

  describe('deleteMcpProject', () => {
    it('answers 404 for a foreign project and deletes nothing', async () => {
      mocks.getResults = [undefined]

      await expect(deleteMcpProject(
        createQueuedDb(),
        1,
        { projectId: 'proj1', confirmName: 'Vaimo' },
        mocks.logger,
      )).rejects.toMatchObject({ status: 404 })
      expect(mocks.deleteProject).not.toHaveBeenCalled()
    })

    it('refuses when confirmName differs from the current name', async () => {
      for (const confirmName of ['vaimo', 'Vaimo ', 'Other']) {
        mocks.getResults = [{ id: 'proj1' }, { name: 'Vaimo' }]

        await expect(deleteMcpProject(
          createQueuedDb(),
          1,
          { projectId: 'proj1', confirmName },
          mocks.logger,
        )).rejects.toMatchObject({
          status: 400,
          message: expect.stringContaining('Ask the user'),
        })
      }

      expect(mocks.deleteProject).not.toHaveBeenCalled()
    })

    it('deletes through the shared cascade and reports detached chats',
      async () => {
        mocks.getResults = [{ id: 'proj1' }, { name: 'Vaimo' }]
        mocks.deleteProject.mockResolvedValue({ chatsDetached: 4 })

        const result = await deleteMcpProject(
          createQueuedDb(),
          1,
          { projectId: 'proj1', confirmName: 'Vaimo' },
          mocks.logger,
        )

        expect(mocks.deleteProject).toHaveBeenCalledWith(
          expect.anything(),
          1,
          'proj1',
          mocks.logger,
        )
        expect(result).toEqual({
          id: 'proj1',
          deleted: true,
          chatsDetached: 4,
        })
      })
  })

  describe('updateMcpKnowledgeItem', () => {
    it('answers 404 for a foreign project', async () => {
      mocks.getResults = [undefined]

      await expect(updateMcpKnowledgeItem(
        createQueuedDb(),
        1,
        { projectId: 'proj1', itemId: 'item1', pinned: true },
        mocks.logger,
      )).rejects.toMatchObject({ status: 404 })
    })

    it('answers 404 for a malformed or foreign item id', async () => {
      mocks.decodeKnowledgeEntityId
        .mockReturnValueOnce(7)
        .mockReturnValueOnce(null)
      mocks.getResults = [{ id: 'proj1' }]

      await expect(updateMcpKnowledgeItem(
        createQueuedDb(),
        1,
        { projectId: 'proj1', itemId: '!!', pinned: true },
        mocks.logger,
      )).rejects.toMatchObject({ status: 404 })

      mocks.decodeKnowledgeEntityId.mockReturnValue(7)
      mocks.getResults = [{ id: 'proj1' }, undefined]

      await expect(updateMcpKnowledgeItem(
        createQueuedDb(),
        1,
        { projectId: 'proj1', itemId: 'item9', pinned: true },
        mocks.logger,
      )).rejects.toMatchObject({ status: 404 })
      expect(mocks.updateKnowledgeItemMetadata).not.toHaveBeenCalled()
    })

    it('rejects a title or text edit on a non-note', async () => {
      for (const fields of [{ title: 'New' }, { body: 'New text' }]) {
        mocks.getResults = [
          { id: 'proj1' },
          knowledgeItemRow({ kind: 'file' }),
        ]

        await expect(updateMcpKnowledgeItem(
          createQueuedDb(),
          1,
          { projectId: 'proj1', itemId: 'item1', ...fields },
          mocks.logger,
        )).rejects.toMatchObject({
          status: 400,
          message: 'Only notes can change title or text.',
        })
      }

      expect(mocks.updateKnowledgeNote).not.toHaveBeenCalled()
      expect(mocks.updateKnowledgeItemMetadata).not.toHaveBeenCalled()
    })

    it('rejects a call without any field', async () => {
      mocks.getResults = [{ id: 'proj1' }, knowledgeItemRow()]

      await expect(updateMcpKnowledgeItem(
        createQueuedDb(),
        1,
        { projectId: 'proj1', itemId: 'item1' },
        mocks.logger,
      )).rejects.toMatchObject({ status: 400 })
    })

    it('rejects an over-long description', async () => {
      mocks.getResults = [{ id: 'proj1' }, knowledgeItemRow()]

      await expect(updateMcpKnowledgeItem(
        createQueuedDb(),
        1,
        {
          projectId: 'proj1',
          itemId: 'item1',
          description: 'x'.repeat(101),
        },
        mocks.logger,
      )).rejects.toMatchObject({ status: 400 })
      expect(mocks.updateKnowledgeNote).not.toHaveBeenCalled()
    })

    it('routes note title, text and description to the note update',
      async () => {
        const row = knowledgeItemRow()

        mocks.getResults = [
          { id: 'proj1' },
          row,
          knowledgeItem({ title: 'New', description: null }),
        ]
        mocks.updateKnowledgeNote.mockResolvedValue(
          knowledgeItem({ title: 'New', description: null }),
        )

        const result = await updateMcpKnowledgeItem(
          createQueuedDb(),
          1,
          {
            projectId: 'proj1',
            itemId: 'item1',
            title: 'New',
            body: 'New text',
            description: null,
          },
          mocks.logger,
        )

        expect(mocks.enforceKnowledgeWriteRateLimit)
          .toHaveBeenCalledWith(1)
        expect(mocks.updateKnowledgeNote).toHaveBeenCalledWith(
          { userId: 1, projectId: 7, logger: mocks.logger },
          row,
          { title: 'New', body: 'New text', description: null },
        )
        expect(mocks.updateKnowledgeItemMetadata).not.toHaveBeenCalled()
        expect(result).toMatchObject({ id: 'item1', title: 'New' })
      })

    it('sends a note description through the note update, pinned through '
      + 'the metadata update', async () => {
      const row = knowledgeItemRow()

      mocks.getResults = [
        { id: 'proj1' },
        row,
        knowledgeItem({ pinned: true, description: 'Short' }),
      ]
      mocks.updateKnowledgeItemMetadata.mockResolvedValue(
        knowledgeItem({ pinned: true }),
      )
      mocks.updateKnowledgeNote.mockResolvedValue(
        knowledgeItem({ pinned: true, description: 'Short' }),
      )

      const result = await updateMcpKnowledgeItem(
        createQueuedDb(),
        1,
        {
          projectId: 'proj1',
          itemId: 'item1',
          description: 'Short',
          pinned: true,
        },
        mocks.logger,
      )

      expect(mocks.updateKnowledgeItemMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 7 }),
        row,
        { pinned: true },
      )
      expect(mocks.updateKnowledgeNote).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 7 }),
        row,
        { description: 'Short' },
      )
      expect(result).toMatchObject({ pinned: true, description: 'Short' })
    })

    it('returns the re-read row, not the pre-write row', async () => {
      const row = knowledgeItemRow()

      mocks.getResults = [
        { id: 'proj1' },
        row,
        knowledgeItem({ pinned: true, description: 'Fresh' }),
      ]
      mocks.updateKnowledgeNote.mockResolvedValue(
        knowledgeItem({ pinned: false, description: 'Stale' }),
      )

      const result = await updateMcpKnowledgeItem(
        createQueuedDb(),
        1,
        {
          projectId: 'proj1',
          itemId: 'item1',
          description: 'Fresh',
          pinned: true,
        },
        mocks.logger,
      )

      expect(mocks.getResults).toEqual([])
      expect(mocks.toKnowledgeItemWire).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({ pinned: true, description: 'Fresh' })
    })

    it('routes a file description and flags to the metadata update',
      async () => {
        const row = knowledgeItemRow({ kind: 'file' })

        mocks.getResults = [
          { id: 'proj1' },
          row,
          knowledgeItem({ kind: 'file', description: 'Spec' }),
        ]
        mocks.updateKnowledgeItemMetadata.mockResolvedValue(
          knowledgeItem({ kind: 'file', description: 'Spec' }),
        )

        await updateMcpKnowledgeItem(
          createQueuedDb(),
          1,
          {
            projectId: 'proj1',
            itemId: 'item1',
            description: 'Spec',
            sendAsNativePdf: false,
          },
          mocks.logger,
        )

        expect(mocks.updateKnowledgeItemMetadata).toHaveBeenCalledWith(
          expect.objectContaining({ projectId: 7 }),
          row,
          { description: 'Spec', sendAsNativePdf: false },
        )
        expect(mocks.updateKnowledgeNote).not.toHaveBeenCalled()
      })
  })

  describe('deleteMcpKnowledgeItems', () => {
    it('answers 404 for a foreign project and deletes nothing', async () => {
      mocks.getResults = [undefined]

      await expect(deleteMcpKnowledgeItems(
        createQueuedDb(),
        1,
        { projectId: 'proj1', itemIds: ['item1'] },
        mocks.logger,
      )).rejects.toMatchObject({ status: 404 })
      expect(mocks.commitKnowledgeRequest).not.toHaveBeenCalled()
    })

    it('rejects an empty list and more than the maximum', async () => {
      const tooMany = Array.from(
        { length: MCP_KNOWLEDGE_DELETE_MAX_ITEMS + 1 },
        (_value, index) => {
          return `item${index}`
        },
      )

      for (const itemIds of [[], tooMany]) {
        await expect(deleteMcpKnowledgeItems(
          createQueuedDb(),
          1,
          { projectId: 'proj1', itemIds },
          mocks.logger,
        )).rejects.toMatchObject({ status: 400 })
      }

      expect(mocks.commitKnowledgeRequest).not.toHaveBeenCalled()
    })

    it('reports how many were deleted and which ids were skipped',
      async () => {
        mocks.getResults = [{ id: 'proj1' }]
        mocks.commitKnowledgeRequest.mockResolvedValue({
          version: 3,
          packVersion: 3,
          removed: 2,
          skipped: ['ghost'],
        })

        const result = await deleteMcpKnowledgeItems(
          createQueuedDb(),
          1,
          { projectId: 'proj1', itemIds: ['item1', 'item2', 'ghost'] },
          mocks.logger,
        )

        expect(mocks.enforceKnowledgeWriteRateLimit)
          .toHaveBeenCalledWith(1)
        expect(mocks.commitKnowledgeRequest).toHaveBeenCalledWith(
          { userId: 1, projectId: 7, logger: mocks.logger },
          { remove: ['item1', 'item2', 'ghost'], folderId: null },
        )
        expect(result).toEqual({ deleted: 2, skipped: ['ghost'] })
      })
  })

  describe('getMcpProject', () => {
    it('adds pinned, createdAt, memory and knowledge totals', async () => {
      mocks.getResults = [
        { id: 'proj1' },
        {
          id: 'proj1',
          name: 'Vaimo',
          instructions: 'Be brief',
          knowledgeMode: 'full',
          pinnedAt: new Date('2026-10-02T00:00:00.000Z'),
          archivedAt: null,
          activityAt: new Date('2026-10-03T00:00:00.000Z'),
          createdAt: new Date('2026-10-01T00:00:00.000Z'),
          memoryStatus: 'ready',
          memoryUpdatedAt: new Date('2026-10-03T00:00:00.000Z'),
          useAccountMemory: null,
        },
        { total: 5 },
      ]
      mocks.listKnowledgeItems.mockResolvedValue([
        knowledgeItem({ textBytes: 10 }),
        knowledgeItem({ id: 'item2', textBytes: 32 }),
      ])

      const project = await getMcpProject(createQueuedDb(), 1, 'proj1')

      expect(project).toMatchObject({
        id: 'proj1',
        instructions: 'Be brief',
        knowledgeMode: 'full',
        pinned: true,
        archived: false,
        createdAt: '2026-10-01T00:00:00.000Z',
        activityAt: '2026-10-03T00:00:00.000Z',
        memory: {
          enabled: true,
          status: 'ready',
          useAccountMemory: true,
          updatedAt: '2026-10-03T00:00:00.000Z',
          entryCount: 5,
        },
        knowledgeTotals: {
          items: 2,
          textBytes: 42,
          limits: { maxItems: 500, maxTextBytes: 2 * 1024 * 1024 },
        },
      })
      expect(project.knowledge).toHaveLength(2)
    })
  })

  describe('listMcpProjects options', () => {
    function createListDb(rows: unknown[]) {
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: async () => rows,
      }

      return {
        select: () => chain,
      } as unknown as ReturnType<typeof useDb>
    }

    it('accepts a name cursor only when sorting by name', async () => {
      const cursor = JSON.stringify({
        sortBy: 'name',
        name: 'Vaimo',
        id: 'abc',
      })

      await expect(listMcpProjects(createListDb([]), 1, { cursor }))
        .rejects.toMatchObject({ status: 400 })
      await expect(listMcpProjects(
        createListDb([]),
        1,
        { cursor, sortBy: 'name', pinnedOnly: true },
      )).resolves.toMatchObject({ projects: [], nextCursor: null })
    })

    it('hands out a name cursor on a full page', async () => {
      const rows = [{
        id: 'abc',
        name: 'Vaimo',
        instructions: null,
        knowledgeMode: null,
        pinnedAt: null,
        archivedAt: null,
        activityAt: new Date('2026-10-01T00:00:00.000Z'),
      }]
      const result = await listMcpProjects(
        createListDb(rows),
        1,
        { limit: 1, sortBy: 'name' },
      )

      expect(JSON.parse(result.nextCursor!)).toEqual({
        sortBy: 'name',
        name: 'Vaimo',
        id: 'abc',
      })
    })
  })
})

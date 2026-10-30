import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    calls: [] as string[],
    findChatOriginFiles: vi.fn(),
    findMessageOriginFiles: vi.fn(),
    cleanupFilesOrphanedByChatDeletion: vi.fn(),
    detachChatsFromMemory: vi.fn(),
    removeChatsFromSearchIndex: vi.fn(),
    removeMessageRowsFromSearchIndex: vi.fn(),
    refreshProjectActivityAt: vi.fn(),
    markProjectsMemoryStale: vi.fn(),
    logger: { set: vi.fn() },
  }
})

vi.mock('~~/server/utils/files/chat-deletion-cleanup', () => {
  return {
    findChatOriginFiles: mocks.findChatOriginFiles,
    findMessageOriginFiles: mocks.findMessageOriginFiles,
    cleanupFilesOrphanedByChatDeletion:
      mocks.cleanupFilesOrphanedByChatDeletion,
  }
})

vi.mock('~~/server/utils/memory/chat-deletion', () => {
  return { detachChatsFromMemory: mocks.detachChatsFromMemory }
})

vi.mock('~~/server/utils/search/index-writer', () => {
  return {
    removeChatsFromSearchIndex: mocks.removeChatsFromSearchIndex,
    removeMessageRowsFromSearchIndex: mocks.removeMessageRowsFromSearchIndex,
    safeDecodePublicId: (publicId: string) => {
      const match = publicId.match(/^row-(\d+)$/)

      return match ? Number(match[1]) : null
    },
  }
})

vi.mock('~~/server/utils/projects/activity', () => {
  return { refreshProjectActivityAt: mocks.refreshProjectActivityAt }
})

vi.mock('~~/server/utils/projects/memory', () => {
  return { markProjectsMemoryStale: mocks.markProjectsMemoryStale }
})

const {
  deleteChat,
  deleteChatMessage,
  moveChatsToProject,
  renameChat,
  setChatMemoryExclusion,
  setChatPinnedAt,
} = await import('~~/server/utils/chats/lifecycle')

const USER_ID = 3

interface FakeDbOptions {
  returnedChat?: { id: string, projectId: string | null }
  message?: { id: string } | undefined
  deletedMessageRows?: number
}

function createDb(options: FakeDbOptions = {}) {
  const updates: Array<{ values: Record<string, unknown> }> = []
  const deletes: string[] = []
  const selectChain: Record<string, unknown> = {}

  for (const method of ['from', 'where', 'groupBy', 'having']) {
    selectChain[method] = () => selectChain
  }

  const db = {
    update: () => {
      return {
        set: (values: Record<string, unknown>) => {
          updates.push({ values })

          const whereResult = {
            returning: () => {
              return { get: async () => options.returnedChat }
            },
            then: (resolve: (value: unknown) => void) => {
              resolve(undefined)
            },
          }

          return { where: () => whereResult }
        },
      }
    },
    delete: () => {
      return {
        where: async () => {
          mocks.calls.push('delete-row')
          deletes.push('row')

          return { meta: { changes: options.deletedMessageRows ?? 1 } }
        },
      }
    },
    select: () => selectChain,
    query: {
      messages: {
        findFirst: vi.fn(async () => options.message),
      },
    },
  }

  return { db: db as unknown as ReturnType<typeof useDb>, updates, deletes }
}

describe('chat lifecycle', () => {
  beforeEach(() => {
    mocks.calls.length = 0

    for (const mock of Object.values(mocks)) {
      if (typeof mock === 'function' && 'mockReset' in mock) {
        mock.mockReset()
      }
    }

    mocks.logger.set.mockReset()
    mocks.findChatOriginFiles.mockResolvedValue([])
    mocks.findMessageOriginFiles.mockResolvedValue([])
    mocks.cleanupFilesOrphanedByChatDeletion.mockResolvedValue({})
    mocks.detachChatsFromMemory.mockImplementation(async () => {
      mocks.calls.push('detach')
    })
    mocks.removeChatsFromSearchIndex.mockImplementation(async () => {
      mocks.calls.push('search-index')
    })
    mocks.refreshProjectActivityAt.mockImplementation(async () => {
      mocks.calls.push('refresh')
    })
    mocks.markProjectsMemoryStale.mockImplementation(async () => {
      mocks.calls.push('stale')
    })
  })

  describe('renameChat', () => {
    it('sets the title and bumps the activity time', async () => {
      const { db, updates } = createDb()

      await renameChat(db, USER_ID, { id: 'c1', projectId: null }, 'New')

      expect(updates).toEqual([{
        values: { title: 'New', activityAt: expect.any(Date) },
      }])
      expect(mocks.refreshProjectActivityAt).not.toHaveBeenCalled()
    })

    it('refreshes the project activity of a chat in a project', async () => {
      const { db } = createDb()

      await renameChat(db, USER_ID, { id: 'c1', projectId: 'p1' }, 'New')

      expect(mocks.refreshProjectActivityAt)
        .toHaveBeenCalledWith(['p1'], USER_ID, db)
    })
  })

  describe('setChatPinnedAt', () => {
    it('writes the pinned time with the activity time', async () => {
      const { db, updates } = createDb()
      const pinnedAt = new Date()

      await setChatPinnedAt(
        db,
        USER_ID,
        { id: 'c1', projectId: 'p1' },
        pinnedAt,
      )
      await setChatPinnedAt(db, USER_ID, { id: 'c1', projectId: null }, null)

      expect(updates).toEqual([
        { values: { pinnedAt, activityAt: expect.any(Date) } },
        { values: { pinnedAt: null, activityAt: expect.any(Date) } },
      ])
      expect(mocks.refreshProjectActivityAt).toHaveBeenCalledTimes(1)
    })
  })

  describe('moveChatsToProject', () => {
    it('moves chats into a project and marks every project stale',
      async () => {
        const { db, updates } = createDb()

        await moveChatsToProject(db, USER_ID, [
          { id: 'c1', projectId: 'p-source' },
          { id: 'c2', projectId: null },
        ], { id: 'p-target' })

        expect(updates).toHaveLength(2)
        expect(updates[0]!.values).toMatchObject({
          projectId: 'p-target',
          activityAt: expect.any(Date),
        })
        expect(updates[1]!.values).toEqual({
          activityAt: updates[0]!.values.activityAt,
        })
        expect(mocks.refreshProjectActivityAt)
          .toHaveBeenCalledWith(['p-source', null], USER_ID, db)
        expect(mocks.markProjectsMemoryStale).toHaveBeenCalledWith(
          ['p-source', null, 'p-target'],
          USER_ID,
          db,
        )
      })

    it('takes chats out of a project without touching a target project',
      async () => {
        const { db, updates } = createDb()

        await moveChatsToProject(
          db,
          USER_ID,
          [{ id: 'c1', projectId: 'p-source' }],
          null,
        )

        expect(updates).toHaveLength(1)
        expect(updates[0]!.values.projectId).toBeDefined()
        expect(updates[0]!.values.projectId).not.toBe('p-target')
        expect(mocks.markProjectsMemoryStale)
          .toHaveBeenCalledWith(['p-source'], USER_ID, db)
      })

    it('updates in chunks that stay under the bound parameter limit',
      async () => {
        const { db, updates } = createDb()
        const chats = Array.from({ length: 100 }, (_value, index) => {
          return { id: `c${index}`, projectId: null }
        })

        await moveChatsToProject(db, USER_ID, chats, null)

        expect(updates).toHaveLength(2)
      })
  })

  describe('setChatMemoryExclusion', () => {
    it('answers 404 when the slug is not the user\'s chat', async () => {
      const { db } = createDb({ returnedChat: undefined })

      await expect(setChatMemoryExclusion(
        db,
        USER_ID,
        'slug',
        true,
        mocks.logger,
      )).rejects.toMatchObject({ status: 404 })
      expect(mocks.detachChatsFromMemory).not.toHaveBeenCalled()
    })

    it('writes the flag, then detaches memory and marks the project stale',
      async () => {
        const { db, updates } = createDb({
          returnedChat: { id: 'c1', projectId: 'p1' },
        })

        const chat = await setChatMemoryExclusion(
          db,
          USER_ID,
          'slug',
          true,
          mocks.logger,
        )

        expect(updates).toEqual([{ values: { memoryExcluded: true } }])
        expect(mocks.detachChatsFromMemory).toHaveBeenCalledWith({
          db,
          userId: USER_ID,
          chatIds: ['c1'],
          logger: mocks.logger,
        })
        expect(mocks.markProjectsMemoryStale)
          .toHaveBeenCalledWith(['p1'], USER_ID, db)
        expect(chat).toEqual({ id: 'c1', projectId: 'p1' })
      })

    it('only clears the flag when including the chat again', async () => {
      const { db, updates } = createDb({
        returnedChat: { id: 'c1', projectId: 'p1' },
      })

      await setChatMemoryExclusion(db, USER_ID, 'slug', false, mocks.logger)

      expect(updates).toEqual([{ values: { memoryExcluded: false } }])
      expect(mocks.detachChatsFromMemory).not.toHaveBeenCalled()
      expect(mocks.markProjectsMemoryStale).not.toHaveBeenCalled()
    })

    it('restamps the extraction times when including again forward only',
      async () => {
        const { db, updates } = createDb({
          returnedChat: { id: 'c1', projectId: 'p1' },
        })
        const before = Date.now()

        await setChatMemoryExclusion(
          db,
          USER_ID,
          'slug',
          false,
          mocks.logger,
          { forwardOnly: true },
        )

        const [{ values }] = updates

        expect(values.memoryExcluded).toBe(false)
        expect((values.memoryExtractedAt as Date).getTime())
          .toBeGreaterThanOrEqual(before)
        expect((values.projectMemorySummaryUpdatedAt as Date).getTime())
          .toBeGreaterThanOrEqual(before)
      })

    it('does not restamp when excluding forward only', async () => {
      const { db, updates } = createDb({
        returnedChat: { id: 'c1', projectId: 'p1' },
      })

      await setChatMemoryExclusion(
        db,
        USER_ID,
        'slug',
        true,
        mocks.logger,
        { forwardOnly: true },
      )

      expect(updates).toEqual([{ values: { memoryExcluded: true } }])
    })
  })

  describe('deleteChat', () => {
    it('cleans memory and the search index before deleting the chat',
      async () => {
        const { db } = createDb()
        const originFiles = [{ id: 'f1', storageKey: 'k1' }]

        mocks.findChatOriginFiles.mockResolvedValue(originFiles)

        await deleteChat(
          db,
          USER_ID,
          { id: 'c1', projectId: 'p1' },
          mocks.logger,
        )

        expect(mocks.calls).toEqual([
          'detach',
          'search-index',
          'delete-row',
          'refresh',
          'stale',
        ])
        expect(mocks.cleanupFilesOrphanedByChatDeletion)
          .toHaveBeenCalledWith(originFiles, USER_ID, mocks.logger)
      })

    it('still succeeds when the orphaned file cleanup fails', async () => {
      const { db } = createDb()

      mocks.findChatOriginFiles.mockResolvedValue([
        { id: 'f1', storageKey: 'k1' },
      ])
      mocks.cleanupFilesOrphanedByChatDeletion
        .mockRejectedValue(new Error('R2 unavailable'))

      await expect(deleteChat(
        db,
        USER_ID,
        { id: 'c1', projectId: null },
        mocks.logger,
      )).resolves.toBeUndefined()
      expect(mocks.logger.set).toHaveBeenCalledWith(expect.objectContaining({
        orphanedFileCleanup: { phase: 'cleanup', candidateCount: 1 },
      }))
    })

    it('does not delete the chat when the memory cascade fails',
      async () => {
        const { db, deletes } = createDb()

        mocks.detachChatsFromMemory.mockRejectedValue(new Error('D1 down'))

        await expect(deleteChat(
          db,
          USER_ID,
          { id: 'c1', projectId: null },
          mocks.logger,
        )).rejects.toThrow('D1 down')
        expect(deletes).toHaveLength(0)
      })
  })

  describe('deleteChatMessage', () => {
    it('answers 404 for an unknown message', async () => {
      const { db } = createDb({ message: undefined })

      await expect(deleteChatMessage(
        db,
        USER_ID,
        'c1',
        'msg',
        mocks.logger,
      )).rejects.toMatchObject({ status: 404 })
    })

    it('refuses to delete the only message of a chat', async () => {
      const { db } = createDb({
        message: { id: 'row-1' },
        deletedMessageRows: 0,
      })

      await expect(deleteChatMessage(
        db,
        USER_ID,
        'c1',
        'msg',
        mocks.logger,
      )).rejects.toMatchObject({ status: 400 })
      expect(mocks.removeMessageRowsFromSearchIndex).not.toHaveBeenCalled()
      expect(mocks.cleanupFilesOrphanedByChatDeletion)
        .not.toHaveBeenCalled()
    })

    it('deletes the message, its search rows and its orphaned files',
      async () => {
        const { db } = createDb({ message: { id: 'row-9' } })
        const originFiles = [{ id: 'f1', storageKey: 'k1' }]

        mocks.findMessageOriginFiles.mockResolvedValue(originFiles)

        await deleteChatMessage(db, USER_ID, 'c1', 'msg', mocks.logger)

        expect(mocks.findMessageOriginFiles).toHaveBeenCalledWith(9, USER_ID)
        expect(mocks.removeMessageRowsFromSearchIndex).toHaveBeenCalledWith({
          db,
          messageRowIds: [9],
          logger: mocks.logger,
        })
        expect(mocks.cleanupFilesOrphanedByChatDeletion)
          .toHaveBeenCalledWith(originFiles, USER_ID, mocks.logger)
      })

    it('skips the file lookup for an id that does not decode', async () => {
      const { db } = createDb({ message: { id: 'not-a-row' } })

      await deleteChatMessage(db, USER_ID, 'c1', 'msg', mocks.logger)

      expect(mocks.findMessageOriginFiles).not.toHaveBeenCalled()
      expect(mocks.removeMessageRowsFromSearchIndex).toHaveBeenCalledWith({
        db,
        messageRowIds: [],
        logger: mocks.logger,
      })
    })
  })
})

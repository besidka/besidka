import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    decodeKnowledgeEntityId: vi.fn(),
    renameChat: vi.fn(),
    setChatPinnedAt: vi.fn(),
    setChatMemoryExclusion: vi.fn(),
    moveChatsToProject: vi.fn(),
    deleteChat: vi.fn(),
    deleteChatMessage: vi.fn(),
    revokeChatShares: vi.fn(),
    branchChat: vi.fn(),
    isChatGenerating: vi.fn(),
    enforceMemoryRateLimit: vi.fn(),
    logger: { set: vi.fn() },
    results: [] as unknown[],
    selectedTables: [] as unknown[],
  }
})

vi.mock('~~/server/utils/knowledge/access', () => {
  return { decodeKnowledgeEntityId: mocks.decodeKnowledgeEntityId }
})

vi.mock('~~/server/utils/chats/lifecycle', () => {
  return {
    renameChat: mocks.renameChat,
    setChatPinnedAt: mocks.setChatPinnedAt,
    setChatMemoryExclusion: mocks.setChatMemoryExclusion,
    moveChatsToProject: mocks.moveChatsToProject,
    deleteChat: mocks.deleteChat,
    deleteChatMessage: mocks.deleteChatMessage,
  }
})

vi.mock('~~/server/utils/chats/share-management', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/chats/share-management')
  >()

  return { ...original, revokeChatShares: mocks.revokeChatShares }
})

vi.mock('~~/server/utils/chats/branch', () => {
  return { branchChat: mocks.branchChat }
})

vi.mock('~~/server/utils/chats/generation-in-progress', () => {
  return { isChatGenerating: mocks.isChatGenerating }
})

vi.mock('~~/server/utils/memory/rate-limit', () => {
  return { enforceMemoryRateLimit: mocks.enforceMemoryRateLimit }
})

const {
  branchMcpChat,
  deleteMcpChatMessage,
  deleteMcpChats,
  listMcpSharedChats,
  moveMcpChatsToProject,
  revokeMcpChatShares,
  updateMcpChat,
} = await import('~~/server/utils/mcp/private/chat-actions')

const USER_ID = 7
const SLUG_A = '01ARZ3NDEKTSV4RRFFQ69G5FA1'
const SLUG_B = '01ARZ3NDEKTSV4RRFFQ69G5FA2'
const SLUG_C = '01ARZ3NDEKTSV4RRFFQ69G5FA3'

function createDb() {
  const chain: Record<string, unknown> = {
    from: (table: unknown) => {
      mocks.selectedTables.push(table)

      return chain
    },
    where: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    get: async () => mocks.results.shift(),
    then: (resolve: (value: unknown) => void) => {
      resolve(mocks.results.shift())
    },
  }

  return { select: () => chain } as unknown as ReturnType<typeof useDb>
}

function ownedChat(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `id-${slug}`,
    slug,
    title: 'Roadmap',
    projectId: null,
    pinnedAt: null,
    memoryExcluded: null,
    ...overrides,
  }
}

function chatState(overrides: Record<string, unknown> = {}) {
  return {
    slug: SLUG_A,
    title: 'Roadmap',
    pinnedAt: null,
    memoryExcluded: null,
    projectId: null,
    projectName: null,
    ...overrides,
  }
}

function queue(...results: unknown[]) {
  mocks.results.splice(0, mocks.results.length, ...results)
}

describe('MCP chat actions', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      if (typeof mock === 'function' && 'mockReset' in mock) {
        mock.mockReset()
      }
    }

    mocks.logger.set.mockReset()
    mocks.results.length = 0
    mocks.selectedTables.length = 0
    mocks.decodeKnowledgeEntityId.mockReturnValue(5)
    mocks.isChatGenerating.mockResolvedValue(false)
  })

  describe('updateMcpChat', () => {
    it('refuses a call that changes nothing', async () => {
      await expect(updateMcpChat(
        createDb(),
        USER_ID,
        { slug: SLUG_A },
        mocks.logger,
      )).rejects.toMatchObject({ status: 400 })
    })

    it('answers 404 for a chat that is not the user\'s', async () => {
      queue(undefined)

      await expect(updateMcpChat(
        createDb(),
        USER_ID,
        { slug: SLUG_A, title: 'New' },
        mocks.logger,
      )).rejects.toMatchObject({ status: 404 })
      expect(mocks.renameChat).not.toHaveBeenCalled()
    })

    it('refuses a foreign or malformed project before writing anything',
      async () => {
        queue(ownedChat(SLUG_A), undefined)

        await expect(updateMcpChat(
          createDb(),
          USER_ID,
          { slug: SLUG_A, title: 'New', projectId: 'foreign' },
          mocks.logger,
        )).rejects.toMatchObject({ status: 404 })
        expect(mocks.renameChat).not.toHaveBeenCalled()
        expect(mocks.moveChatsToProject).not.toHaveBeenCalled()

        mocks.decodeKnowledgeEntityId.mockReturnValue(null)
        queue(ownedChat(SLUG_A))

        await expect(updateMcpChat(
          createDb(),
          USER_ID,
          { slug: SLUG_A, projectId: '!!' },
          mocks.logger,
        )).rejects.toMatchObject({ status: 404 })
        expect(mocks.moveChatsToProject).not.toHaveBeenCalled()
      })

    it('renames, pins, excludes from memory and moves in one call',
      async () => {
        const chat = ownedChat(SLUG_A, { projectId: 'old-project' })

        queue(
          chat,
          { id: 'new-project', name: 'Vaimo' },
          chatState({
            title: 'New',
            pinnedAt: new Date(),
            memoryExcluded: true,
            projectId: 'new-project',
            projectName: 'Vaimo',
          }),
        )

        const state = await updateMcpChat(createDb(), USER_ID, {
          slug: SLUG_A,
          title: 'New',
          pinned: true,
          memoryExcluded: true,
          projectId: 'new-project',
        }, mocks.logger)

        const current = { id: chat.id, projectId: 'old-project' }

        expect(mocks.enforceMemoryRateLimit)
          .toHaveBeenCalledWith('write', USER_ID)
        expect(mocks.renameChat)
          .toHaveBeenCalledWith(expect.anything(), USER_ID, current, 'New')
        expect(mocks.setChatPinnedAt).toHaveBeenCalledWith(
          expect.anything(),
          USER_ID,
          current,
          expect.any(Date),
        )
        expect(mocks.setChatMemoryExclusion).toHaveBeenCalledWith(
          expect.anything(),
          USER_ID,
          SLUG_A,
          true,
          mocks.logger,
          { forwardOnly: true },
        )
        expect(mocks.moveChatsToProject).toHaveBeenCalledWith(
          expect.anything(),
          USER_ID,
          [current],
          { id: 'new-project', name: 'Vaimo' },
        )
        expect(state).toEqual({
          slug: SLUG_A,
          title: 'New',
          pinned: true,
          memoryExcluded: true,
          projectId: 'new-project',
          projectName: 'Vaimo',
        })
      })

    it('does nothing for values the chat already has', async () => {
      queue(
        ownedChat(SLUG_A, {
          pinnedAt: new Date(),
          memoryExcluded: true,
          projectId: 'p1',
        }),
        { id: 'p1', name: 'Vaimo' },
        chatState({ pinnedAt: new Date(), memoryExcluded: true }),
      )

      await updateMcpChat(createDb(), USER_ID, {
        slug: SLUG_A,
        title: 'Roadmap',
        pinned: true,
        memoryExcluded: true,
        projectId: 'p1',
      }, mocks.logger)

      expect(mocks.renameChat).not.toHaveBeenCalled()
      expect(mocks.setChatPinnedAt).not.toHaveBeenCalled()
      expect(mocks.setChatMemoryExclusion).not.toHaveBeenCalled()
      expect(mocks.moveChatsToProject).not.toHaveBeenCalled()
      expect(mocks.enforceMemoryRateLimit).not.toHaveBeenCalled()
    })

    it('unpins and takes the chat out of its project with null', async () => {
      const chat = ownedChat(SLUG_A, {
        pinnedAt: new Date(),
        projectId: 'p1',
      })

      queue(chat, chatState())

      await updateMcpChat(createDb(), USER_ID, {
        slug: SLUG_A,
        pinned: false,
        projectId: null,
      }, mocks.logger)

      expect(mocks.setChatPinnedAt).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        { id: chat.id, projectId: 'p1' },
        null,
      )
      expect(mocks.moveChatsToProject).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        [{ id: chat.id, projectId: 'p1' }],
        null,
      )
    })

    it('stops before writing when the memory write limit is hit',
      async () => {
        queue(ownedChat(SLUG_A))
        mocks.enforceMemoryRateLimit.mockRejectedValue(
          Object.assign(new Error('limit'), { status: 429 }),
        )

        await expect(updateMcpChat(createDb(), USER_ID, {
          slug: SLUG_A,
          title: 'New',
          memoryExcluded: true,
        }, mocks.logger)).rejects.toMatchObject({ status: 429 })
        expect(mocks.renameChat).not.toHaveBeenCalled()
        expect(mocks.setChatMemoryExclusion).not.toHaveBeenCalled()
      })
  })

  describe('moveMcpChatsToProject', () => {
    it('moves the chats outside the target and reports the rest',
      async () => {
        const inProject = ownedChat(SLUG_A, { projectId: 'p1' })
        const elsewhere = ownedChat(SLUG_B, { projectId: null })

        queue({ id: 'p1', name: 'Vaimo' }, [inProject, elsewhere])

        const result = await moveMcpChatsToProject(createDb(), USER_ID, {
          slugs: [SLUG_A, SLUG_B, SLUG_C, SLUG_B],
          projectId: 'p1',
        })

        expect(mocks.moveChatsToProject).toHaveBeenCalledWith(
          expect.anything(),
          USER_ID,
          [elsewhere],
          { id: 'p1', name: 'Vaimo' },
        )
        expect(result).toEqual({
          moved: 1,
          alreadyThere: 1,
          notFound: [SLUG_C],
        })
      })

    it('takes chats out of projects with a null project', async () => {
      const inProject = ownedChat(SLUG_A, { projectId: 'p1' })
      const loose = ownedChat(SLUG_B)

      queue([inProject, loose])

      const result = await moveMcpChatsToProject(createDb(), USER_ID, {
        slugs: [SLUG_A, SLUG_B],
        projectId: null,
      })

      expect(mocks.moveChatsToProject).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        [inProject],
        null,
      )
      expect(result).toEqual({ moved: 1, alreadyThere: 1, notFound: [] })
    })

    it('writes nothing when every chat is already there', async () => {
      queue([ownedChat(SLUG_A)])

      const result = await moveMcpChatsToProject(createDb(), USER_ID, {
        slugs: [SLUG_A],
        projectId: null,
      })

      expect(mocks.moveChatsToProject).not.toHaveBeenCalled()
      expect(result).toEqual({ moved: 0, alreadyThere: 1, notFound: [] })
    })

    it('answers 404 for a foreign project before looking up chats',
      async () => {
        queue(undefined)

        await expect(moveMcpChatsToProject(createDb(), USER_ID, {
          slugs: [SLUG_A],
          projectId: 'foreign',
        })).rejects.toMatchObject({ status: 404 })
        expect(mocks.moveChatsToProject).not.toHaveBeenCalled()
        expect(mocks.selectedTables).toHaveLength(1)
      })
  })

  describe('deleteMcpChats', () => {
    it('deletes owned chats and reports the unknown ones', async () => {
      const first = ownedChat(SLUG_A)
      const second = ownedChat(SLUG_B)

      queue([first, second])

      const result = await deleteMcpChats(
        createDb(),
        USER_ID,
        { slugs: [SLUG_A, SLUG_C, SLUG_B] },
        mocks.logger,
      )

      expect(mocks.deleteChat).toHaveBeenCalledTimes(2)
      expect(mocks.deleteChat).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        USER_ID,
        first,
        mocks.logger,
      )
      expect(result).toEqual({
        deleted: [SLUG_A, SLUG_B],
        skipped: [{ slug: SLUG_C, reason: 'not_found' }],
      })
    })

    it('skips a chat that is generating and deletes the rest', async () => {
      const generating = ownedChat(SLUG_A)
      const idle = ownedChat(SLUG_B)

      queue([generating, idle])
      mocks.isChatGenerating.mockImplementation(async (chatId: string) => {
        return chatId === generating.id
      })

      const result = await deleteMcpChats(
        createDb(),
        USER_ID,
        { slugs: [SLUG_A, SLUG_B] },
        mocks.logger,
      )

      expect(mocks.deleteChat).toHaveBeenCalledTimes(1)
      expect(mocks.deleteChat).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        idle,
        mocks.logger,
      )
      expect(result).toEqual({
        deleted: [SLUG_B],
        skipped: [{ slug: SLUG_A, reason: 'generating' }],
      })
    })

    it('deletes sequentially', async () => {
      const order: string[] = []

      queue([ownedChat(SLUG_A), ownedChat(SLUG_B)])
      mocks.deleteChat.mockImplementation(async (
        _db: unknown,
        _userId: number,
        chat: { id: string },
      ) => {
        order.push(`start-${chat.id}`)
        await Promise.resolve()
        order.push(`end-${chat.id}`)
      })

      await deleteMcpChats(
        createDb(),
        USER_ID,
        { slugs: [SLUG_A, SLUG_B] },
        mocks.logger,
      )

      expect(order).toEqual([
        `start-id-${SLUG_A}`,
        `end-id-${SLUG_A}`,
        `start-id-${SLUG_B}`,
        `end-id-${SLUG_B}`,
      ])
    })
  })

  describe('deleteMcpChatMessage', () => {
    it('deletes a message of an owned chat', async () => {
      queue(ownedChat(SLUG_A))

      const result = await deleteMcpChatMessage(
        createDb(),
        USER_ID,
        { slug: SLUG_A, messageId: 'msg-1' },
        mocks.logger,
      )

      expect(mocks.deleteChatMessage).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        `id-${SLUG_A}`,
        'msg-1',
        mocks.logger,
      )
      expect(result).toEqual({
        slug: SLUG_A,
        messageId: 'msg-1',
        deleted: true,
      })
    })

    it('answers 404 for a chat that is not the user\'s', async () => {
      queue(undefined)

      await expect(deleteMcpChatMessage(
        createDb(),
        USER_ID,
        { slug: SLUG_A, messageId: 'msg-1' },
        mocks.logger,
      )).rejects.toMatchObject({ status: 404 })
      expect(mocks.deleteChatMessage).not.toHaveBeenCalled()
    })

    it('answers 409 while the chat is generating', async () => {
      queue(ownedChat(SLUG_A))
      mocks.isChatGenerating.mockResolvedValue(true)

      await expect(deleteMcpChatMessage(
        createDb(),
        USER_ID,
        { slug: SLUG_A, messageId: 'msg-1' },
        mocks.logger,
      )).rejects.toMatchObject({ status: 409 })
      expect(mocks.deleteChatMessage).not.toHaveBeenCalled()
    })

    it('passes the refusal to delete the only message through', async () => {
      queue(ownedChat(SLUG_A))
      mocks.deleteChatMessage.mockRejectedValue(
        Object.assign(new Error('only'), { status: 400 }),
      )

      await expect(deleteMcpChatMessage(
        createDb(),
        USER_ID,
        { slug: SLUG_A, messageId: 'msg-1' },
        mocks.logger,
      )).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('listMcpSharedChats', () => {
    it('lists live shares with the share url and a cursor on a full page',
      async () => {
        const expiresAt = new Date('2026-11-01T00:00:00.000Z')

        queue([
          {
            id: 'c1',
            slug: SLUG_A,
            title: 'Roadmap',
            activityAt: new Date('2026-10-30T10:00:00.000Z'),
            shareSlug: 'share1',
            expiresAt,
            indexable: true,
            showFiles: false,
            allowBranch: true,
          },
          {
            id: 'c2',
            slug: SLUG_B,
            title: null,
            activityAt: new Date('2026-10-29T10:00:00.000Z'),
            shareSlug: null,
            expiresAt: null,
            indexable: false,
            showFiles: true,
            allowBranch: false,
          },
        ])

        const result = await listMcpSharedChats(createDb(), USER_ID, {
          limit: 2,
          siteUrl: 'https://besidka.com/',
          includeShareUrl: true,
        })

        expect(result.chats).toEqual([
          {
            slug: SLUG_A,
            title: 'Roadmap',
            shareUrl: 'https://besidka.com/shared/share1',
            expiresAt: '2026-11-01T00:00:00.000Z',
            indexable: true,
            showFiles: false,
            allowBranch: true,
          },
          {
            slug: SLUG_B,
            title: '',
            shareUrl: null,
            expiresAt: null,
            indexable: false,
            showFiles: true,
            allowBranch: false,
          },
        ])
        expect(JSON.parse(result.nextCursor!)).toEqual({
          activityAt: '2026-10-29T10:00:00.000Z',
          id: 'c2',
        })
      })

    it('leaves the share url out unless it is asked for', async () => {
      queue([
        {
          id: 'c1',
          slug: SLUG_A,
          title: 'Roadmap',
          activityAt: new Date('2026-10-30T10:00:00.000Z'),
          shareSlug: 'share1',
          expiresAt: null,
          indexable: true,
          showFiles: false,
          allowBranch: true,
        },
      ])

      const result = await listMcpSharedChats(createDb(), USER_ID, {
        siteUrl: 'https://besidka.com',
      })

      expect(result.chats[0]).toEqual({
        slug: SLUG_A,
        title: 'Roadmap',
        expiresAt: null,
        indexable: true,
        showFiles: false,
        allowBranch: true,
      })
    })

    it('has no next cursor on a short page and rejects a bad cursor',
      async () => {
        queue([])

        await expect(listMcpSharedChats(createDb(), USER_ID, {
          siteUrl: 'https://besidka.com',
        })).resolves.toEqual({ chats: [], nextCursor: null })

        await expect(listMcpSharedChats(createDb(), USER_ID, {
          cursor: 'not json',
          siteUrl: 'https://besidka.com',
        })).rejects.toMatchObject({ status: 400 })
      })
  })

  describe('revokeMcpChatShares', () => {
    it('reports revoked chats and the ones that were not shared',
      async () => {
        const first = ownedChat(SLUG_A)
        const second = ownedChat(SLUG_B)

        queue([first, second])
        mocks.revokeChatShares.mockResolvedValue({
          deletedCount: 2,
          revokedChatIds: [first.id],
        })

        const result = await revokeMcpChatShares(createDb(), USER_ID, {
          slugs: [SLUG_A, SLUG_B, SLUG_C],
        })

        expect(mocks.revokeChatShares).toHaveBeenCalledWith(
          expect.anything(),
          USER_ID,
          [first.id, second.id],
        )
        expect(result).toEqual({
          revoked: [SLUG_A],
          notShared: [SLUG_B, SLUG_C],
        })
      })

    it('never revokes the chats of other users', async () => {
      queue([])
      mocks.revokeChatShares.mockResolvedValue({
        deletedCount: 0,
        revokedChatIds: [],
      })

      const result = await revokeMcpChatShares(createDb(), USER_ID, {
        slugs: [SLUG_A],
      })

      expect(mocks.revokeChatShares)
        .toHaveBeenCalledWith(expect.anything(), USER_ID, [])
      expect(result).toEqual({ revoked: [], notShared: [SLUG_A] })
    })
  })

  describe('branchMcpChat', () => {
    it('branches an owned chat and returns the new slug and title',
      async () => {
        queue(ownedChat(SLUG_A))
        mocks.branchChat.mockResolvedValue({
          id: 'new',
          slug: SLUG_B,
          title: 'Branch: Roadmap',
        })

        const result = await branchMcpChat(
          createDb(),
          USER_ID,
          { slug: SLUG_A, messageId: 'msg-3' },
          mocks.logger,
        )

        expect(mocks.branchChat).toHaveBeenCalledWith(
          expect.anything(),
          USER_ID,
          SLUG_A,
          'msg-3',
          mocks.logger,
        )
        expect(result).toEqual({ slug: SLUG_B, title: 'Branch: Roadmap' })
      })

    it('answers 404 for a foreign chat and 409 while generating',
      async () => {
        queue(undefined)

        await expect(branchMcpChat(
          createDb(),
          USER_ID,
          { slug: SLUG_A },
          mocks.logger,
        )).rejects.toMatchObject({ status: 404 })

        queue(ownedChat(SLUG_A))
        mocks.isChatGenerating.mockResolvedValue(true)

        await expect(branchMcpChat(
          createDb(),
          USER_ID,
          { slug: SLUG_A },
          mocks.logger,
        )).rejects.toMatchObject({ status: 409 })
        expect(mocks.branchChat).not.toHaveBeenCalled()
      })
  })
})

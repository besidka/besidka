import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { SQL } from 'drizzle-orm'

const mocks = vi.hoisted(() => {
  return {
    results: [] as unknown[],
    conditions: [] as unknown[],
    selectCount: 0,
    logger: { set: vi.fn() },
  }
})

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/knowledge/access', () => {
  return {
    decodeKnowledgeEntityId: (id: string) => {
      return id.startsWith('pub-') ? Number(id.slice(4)) : null
    },
  }
})

const { getMcpChat, listMcpChats } = await import(
  '~~/server/utils/mcp/private/chats'
)

const dialect = drizzle(new Database(':memory:')).dialect

function createDb() {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: (condition: unknown) => {
      mocks.conditions.push(condition)

      return chain
    },
    leftJoin: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    get: async () => mocks.results.shift(),
    then: (resolve: (value: unknown) => void) => {
      resolve(mocks.results.shift())
    },
  }

  return {
    select: () => {
      mocks.selectCount += 1

      return chain
    },
  } as unknown as ReturnType<typeof useDb>
}

function queue(...results: unknown[]) {
  mocks.results.splice(0, mocks.results.length, ...results)
}

function renderCondition(condition: unknown) {
  return dialect.sqlToQuery(condition as SQL)
}

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pub-1',
    slug: 'slug-1',
    title: 'Roadmap',
    projectId: null,
    projectName: null,
    pinnedAt: null,
    shared: false,
    memoryExcluded: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    activityAt: new Date('2026-10-02T00:00:00.000Z'),
    ...overrides,
  }
}

describe('listMcpChats filters and fields', () => {
  beforeEach(() => {
    mocks.results.length = 0
    mocks.conditions.length = 0
    mocks.selectCount = 0
  })

  it('returns pinned, shared, memory and project fields per chat',
    async () => {
      queue([
        listRow({
          projectId: 'pub-9',
          projectName: 'Vaimo',
          pinnedAt: new Date('2026-10-02T00:00:00.000Z'),
          shared: true,
          memoryExcluded: true,
        }),
        listRow({ id: 'pub-2', slug: 'slug-2' }),
      ])

      const result = await listMcpChats(createDb(), 1, {}, mocks.logger)

      expect(result.chats).toEqual([
        {
          slug: 'slug-1',
          title: 'Roadmap',
          projectId: 'pub-9',
          projectName: 'Vaimo',
          pinned: true,
          shared: true,
          memoryExcluded: true,
          createdAt: '2026-10-01T00:00:00.000Z',
          activityAt: '2026-10-02T00:00:00.000Z',
        },
        {
          slug: 'slug-2',
          title: 'Roadmap',
          projectId: null,
          projectName: null,
          pinned: false,
          shared: false,
          memoryExcluded: false,
          createdAt: '2026-10-01T00:00:00.000Z',
          activityAt: '2026-10-02T00:00:00.000Z',
        },
      ])
    })

  it('filters to one owned project', async () => {
    queue({ id: 'pub-5', name: 'Vaimo' }, [])

    await listMcpChats(createDb(), 1, { projectId: 'pub-5' }, mocks.logger)

    const { sql, params } = renderCondition(mocks.conditions[1])

    expect(sql).toContain('"chats"."user_id" = ?')
    expect(sql).toContain('"chats"."project_id" = ?')
    expect(params).toEqual([1, 5])
  })

  it('answers 404 for a foreign or malformed project without listing',
    async () => {
      queue(undefined)

      await expect(listMcpChats(
        createDb(),
        1,
        { projectId: 'pub-5' },
        mocks.logger,
      )).rejects.toMatchObject({ status: 404 })
      expect(mocks.selectCount).toBe(1)

      mocks.selectCount = 0

      await expect(listMcpChats(
        createDb(),
        1,
        { projectId: 'garbage' },
        mocks.logger,
      )).rejects.toMatchObject({ status: 404 })
      expect(mocks.selectCount).toBe(0)
    })

  it('filters to pinned chats', async () => {
    queue([])

    await listMcpChats(createDb(), 1, { pinnedOnly: true }, mocks.logger)

    expect(renderCondition(mocks.conditions[0]).sql)
      .toContain('"chats"."pinned_at" is not null')

    mocks.conditions.length = 0
    queue([])

    await listMcpChats(createDb(), 1, { pinnedOnly: false }, mocks.logger)

    expect(renderCondition(mocks.conditions[0]).sql)
      .not.toContain('pinned_at')
  })

  it('applies the filters to title search too', async () => {
    queue({ id: 'pub-5', name: 'Vaimo' }, [], [])

    await listMcpChats(createDb(), 1, {
      search: 'roadmap',
      searchIn: 'title',
      projectId: 'pub-5',
      pinnedOnly: true,
    }, mocks.logger)

    const { sql } = renderCondition(mocks.conditions[1])

    expect(sql).toContain('"chats"."project_id" = ?')
    expect(sql).toContain('"chats"."pinned_at" is not null')
  })
})

describe('getMcpChat extra fields', () => {
  beforeEach(() => {
    mocks.results.length = 0
    mocks.conditions.length = 0
    mocks.selectCount = 0
  })

  function chatRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'pub-1',
      slug: 'slug-1',
      title: 'Roadmap',
      projectId: 'pub-9',
      projectName: 'Vaimo',
      pinnedAt: new Date('2026-10-02T00:00:00.000Z'),
      memoryExcluded: true,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      activityAt: new Date('2026-10-02T00:00:00.000Z'),
      ...overrides,
    }
  }

  it('returns pinned, memory exclusion, project name and the share',
    async () => {
      queue(
        chatRow(),
        {
          slug: 'share1',
          expiresAt: new Date('2026-11-01T00:00:00.000Z'),
          indexable: true,
          showFiles: false,
          allowBranch: true,
        },
        [],
      )

      const chat = await getMcpChat(createDb(), 1, {
        slug: 'slug-1',
        siteUrl: 'https://besidka.com/',
        includeShareUrl: true,
      })

      expect(chat).toMatchObject({
        slug: 'slug-1',
        projectId: 'pub-9',
        projectName: 'Vaimo',
        pinned: true,
        memoryExcluded: true,
        share: {
          url: 'https://besidka.com/shared/share1',
          expiresAt: '2026-11-01T00:00:00.000Z',
          indexable: true,
          showFiles: false,
          allowBranch: true,
        },
      })
    })

  it('leaves the share url out unless it is asked for', async () => {
    queue(
      chatRow(),
      {
        slug: 'share1',
        expiresAt: null,
        indexable: false,
        showFiles: true,
        allowBranch: false,
      },
      [],
    )

    const chat = await getMcpChat(createDb(), 1, {
      slug: 'slug-1',
      siteUrl: 'https://besidka.com',
    })

    expect(chat.share).toEqual({
      expiresAt: null,
      indexable: false,
      showFiles: true,
      allowBranch: false,
    })
    expect(chat.share).not.toHaveProperty('url')
  })

  it('returns a null share and false flags for a plain chat', async () => {
    queue(
      chatRow({
        projectId: null,
        projectName: null,
        pinnedAt: null,
        memoryExcluded: null,
      }),
      undefined,
      [],
    )

    const chat = await getMcpChat(createDb(), 1, {
      slug: 'slug-1',
      siteUrl: 'https://besidka.com',
    })

    expect(chat).toMatchObject({
      projectName: null,
      pinned: false,
      memoryExcluded: false,
      share: null,
    })
  })

  it('answers 404 for a chat that is not the user\'s', async () => {
    queue(undefined)

    await expect(getMcpChat(createDb(), 1, {
      slug: 'slug-1',
      siteUrl: 'https://besidka.com',
    })).rejects.toMatchObject({ status: 404 })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { createMemoryTestDb } from '../../setup/helpers/memory-db'

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
  useLogger: () => ({
    set: vi.fn(),
  }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

const OWNER = 1
const STRANGER = 2
const ENTRY_ID = 5

type Handler = (event: any) => Promise<any>

async function loadSourcesHandler(): Promise<Handler> {
  const module = await import(
    /* @vite-ignore */
    '../../../server/api/v1/memory/entries/[id]/sources.get'
  )

  return module.default
}

describe('GET /api/v1/memory/entries/[id]/sources', () => {
  let testDb: ReturnType<typeof createMemoryTestDb>
  let sessionUserId: string | null

  function paramsEvent(id: string) {
    return {
      context: { params: { id } },
      headers: {},
      res: { headers: new Headers() },
    }
  }

  function insertChat(input: {
    id: number
    userId: number
    slug: string
    title?: string | null
  }) {
    const timestamp = Math.floor(Date.now() / 1000)

    testDb.sqlite.prepare(
      'insert into chats (id, created_at, updated_at, user_id, slug, title)'
      + ' values (?, ?, ?, ?, ?, ?)',
    ).run(
      input.id,
      timestamp,
      timestamp,
      input.userId,
      input.slug,
      input.title === undefined ? `Title ${input.slug}` : input.title,
    )
  }

  function insertEntryWithSources(
    sourceChatIds: string[],
    userId: number = OWNER,
  ) {
    testDb.insertEntry({
      id: ENTRY_ID,
      userId,
      slug: 'mine',
      sourceChatIds,
    })
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    testDb = createMemoryTestDb()
    sessionUserId = String(OWNER)

    testDb.sqlite.exec(`
      CREATE TABLE chats (
        id integer PRIMARY KEY,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        slug text NOT NULL,
        user_id integer NOT NULL,
        title text DEFAULT ''
      );
    `)

    vi.stubGlobal('defineEventHandler', (handler: any) => handler)
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useUserSession', async () => {
      return sessionUserId === null ? null : { user: { id: sessionUserId } }
    })
    vi.stubGlobal('useDb', () => testDb.db)
  })

  afterEach(() => {
    testDb.close()
  })

  it('returns 401 without a session', async () => {
    const handler = await loadSourcesHandler()

    sessionUserId = null

    await expect(handler(paramsEvent(encodePublicId(ENTRY_ID))))
      .rejects.toMatchObject({ status: 401 })
  })

  it('returns slug and title for the source chats', async () => {
    const handler = await loadSourcesHandler()

    insertChat({ id: 10, userId: OWNER, slug: 'chat-ten', title: 'Ten' })
    insertEntryWithSources([encodePublicId(10)])

    const response = await handler(paramsEvent(encodePublicId(ENTRY_ID)))

    expect(response).toEqual({
      chats: [{ id: encodePublicId(10), slug: 'chat-ten', title: 'Ten' }],
    })
  })

  it('marks the response as uncacheable', async () => {
    const handler = await loadSourcesHandler()
    const event = paramsEvent(encodePublicId(ENTRY_ID))

    insertEntryWithSources([])

    await handler(event)

    expect(event.res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns 404 for another user entry and unknown ids', async () => {
    const handler = await loadSourcesHandler()

    insertChat({ id: 10, userId: STRANGER, slug: 'secret-chat' })
    insertEntryWithSources([encodePublicId(10)], STRANGER)

    await expect(handler(paramsEvent(encodePublicId(ENTRY_ID))))
      .rejects.toMatchObject({ status: 404, message: 'Memory entry not found' })
    await expect(handler(paramsEvent(encodePublicId(404))))
      .rejects.toMatchObject({ status: 404 })
    await expect(handler(paramsEvent('not-a-real-id')))
      .rejects.toMatchObject({ status: 404 })
  })

  it('does not leak a chat owned by another user', async () => {
    const handler = await loadSourcesHandler()

    insertChat({ id: 10, userId: OWNER, slug: 'own-chat', title: 'Own' })
    insertChat({ id: 11, userId: STRANGER, slug: 'foreign-chat' })
    insertEntryWithSources([encodePublicId(11), encodePublicId(10)])

    const response = await handler(paramsEvent(encodePublicId(ENTRY_ID)))

    expect(response.chats).toEqual([
      { id: encodePublicId(10), slug: 'own-chat', title: 'Own' },
    ])
    expect(JSON.stringify(response)).not.toContain('foreign-chat')
  })

  it('omits chats that no longer exist', async () => {
    const handler = await loadSourcesHandler()

    insertChat({ id: 10, userId: OWNER, slug: 'alive' })
    insertEntryWithSources([
      encodePublicId(99),
      encodePublicId(10),
      'garbage-id',
    ])

    const response = await handler(paramsEvent(encodePublicId(ENTRY_ID)))

    expect(response.chats.map((chat: { slug: string }) => chat.slug))
      .toEqual(['alive'])
  })

  it('preserves the order of sourceChatIds', async () => {
    const handler = await loadSourcesHandler()

    insertChat({ id: 10, userId: OWNER, slug: 'first-inserted' })
    insertChat({ id: 11, userId: OWNER, slug: 'second-inserted' })
    insertChat({ id: 12, userId: OWNER, slug: 'third-inserted' })
    insertEntryWithSources([
      encodePublicId(12),
      encodePublicId(10),
      encodePublicId(11),
    ])

    const response = await handler(paramsEvent(encodePublicId(ENTRY_ID)))

    expect(response.chats.map((chat: { slug: string }) => chat.slug))
      .toEqual(['third-inserted', 'first-inserted', 'second-inserted'])
  })

  it('returns an empty title when the chat has none', async () => {
    const handler = await loadSourcesHandler()

    insertChat({ id: 10, userId: OWNER, slug: 'untitled', title: null })
    insertEntryWithSources([encodePublicId(10)])

    const response = await handler(paramsEvent(encodePublicId(ENTRY_ID)))

    expect(response.chats).toEqual([
      { id: encodePublicId(10), slug: 'untitled', title: '' },
    ])
  })

  it('returns an empty list for an entry without provenance', async () => {
    const handler = await loadSourcesHandler()

    insertEntryWithSources([])

    expect(await handler(paramsEvent(encodePublicId(ENTRY_ID))))
      .toEqual({ chats: [] })
  })

  it('looks up at most maxSourceChatIds chats', async () => {
    const handler = await loadSourcesHandler()
    const total = MEMORY_LIMITS.maxSourceChatIds + 5
    const chatIds: string[] = []

    for (let index = 1; index <= total; index++) {
      insertChat({ id: 100 + index, userId: OWNER, slug: `chat-${index}` })
      chatIds.push(encodePublicId(100 + index))
    }

    insertEntryWithSources(chatIds)

    const response = await handler(paramsEvent(encodePublicId(ENTRY_ID)))

    expect(response.chats).toHaveLength(MEMORY_LIMITS.maxSourceChatIds)
    expect(response.chats[0].slug).toBe('chat-1')
  })
})

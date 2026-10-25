import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  durationToExpiresAt: vi.fn(),
  syncChatShareFiles: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ set: vi.fn() }),
  createError: (input: {
    status?: number
    message?: string
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/chats/share', () => ({
  durationToExpiresAt: mocks.durationToExpiresAt,
  syncChatShareFiles: mocks.syncChatShareFiles,
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { customType } = await import('drizzle-orm/sqlite-core')

  return {
    encodePublicId: (id: number) => `pub-${id}`,
    decodePublicId: (publicId: string) => Number(publicId.slice(4)),
    publicId: customType<{
      data: string
      driverData: number
      notNull: true
      default: true
    }>({
      dataType() {
        return 'integer'
      },
      fromDriver(value) {
        return `pub-${value}`
      },
      toDriver(value) {
        return Number(value.slice(4))
      },
    }),
  }
})

const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FB0'
const CHAT_ROW_ID = 1
const SHARE_ROW_ID = 1
const ORIGINAL_SHARE_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FC0'
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

type SqliteDatabase = InstanceType<typeof Database>

interface ShareRow {
  id: number
  slug: string
  revoked: number
  indexable: number
  expires_at: number | null
}

function createSqlite(): SqliteDatabase {
  const sqlite = new Database(':memory:')

  sqlite.exec(`
    CREATE TABLE chats (
      id integer PRIMARY KEY AUTOINCREMENT,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      slug text NOT NULL,
      user_id integer NOT NULL,
      title text,
      shared integer,
      branched_from_share_slug text,
      pinned_at integer,
      project_id integer,
      project_memory_summary text,
      project_memory_summary_updated_at integer,
      activity_at integer NOT NULL
    );
    CREATE UNIQUE INDEX uq_chat_slug ON chats (id, slug);

    CREATE TABLE chat_shares (
      id integer PRIMARY KEY AUTOINCREMENT,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      slug text,
      chat_id integer NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      revoked integer NOT NULL DEFAULT false,
      expires_at integer,
      indexable integer NOT NULL DEFAULT true,
      show_files integer NOT NULL DEFAULT true,
      show_metadata integer NOT NULL DEFAULT true,
      show_author_avatar integer NOT NULL DEFAULT true,
      allow_branch integer NOT NULL DEFAULT true
    );
    CREATE UNIQUE INDEX uq_chat_share_slug ON chat_shares (slug);
    CREATE UNIQUE INDEX uq_chat_share_chat_id ON chat_shares (chat_id);
  `)

  sqlite.prepare(
    `insert into chats
      (id, created_at, updated_at, slug, user_id, activity_at)
      values (?, 0, 0, ?, 1, 0)`,
  ).run(CHAT_ROW_ID, CHAT_SLUG)

  return sqlite
}

function insertShare(
  sqlite: SqliteDatabase,
  expiresAtSeconds: number | null,
  revoked = false,
): void {
  sqlite.prepare(
    `insert into chat_shares
      (id, created_at, updated_at, slug, chat_id, revoked, expires_at)
      values (?, 0, 0, ?, ?, ?, ?)`,
  ).run(
    SHARE_ROW_ID,
    ORIGINAL_SHARE_SLUG,
    CHAT_ROW_ID,
    revoked ? 1 : 0,
    expiresAtSeconds,
  )
}

function readShare(sqlite: SqliteDatabase): ShareRow {
  return sqlite.prepare(
    'select id, slug, revoked, indexable, expires_at from chat_shares',
  ).get() as ShareRow
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    duration: 'week',
    indexable: false,
    showFiles: true,
    showMetadata: true,
    showAuthorAvatar: true,
    allowBranch: true,
    ...overrides,
  }
}

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/share/index.post'
  )

  return module.default
}

describe('chat share re-share slug lifecycle', () => {
  let sqlite: SqliteDatabase

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    const { relations } = await import('~~/server/db/relations')

    sqlite = createSqlite()

    const db = drizzle({ client: sqlite, relations })

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => unknown,
    ) => {
      return parser(event.body)
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('useUnauthorizedError', vi.fn(() => {
      throw new Error('Unauthorized')
    }))
    vi.stubGlobal('useDb', () => db)

    mocks.syncChatShareFiles.mockResolvedValue(undefined)
  })

  afterEach(() => {
    sqlite.close()
    vi.unstubAllGlobals()
  })

  it('issues a fresh slug for the same share row when re-sharing an '
    + 'expired share', async () => {
    const expiredAtSeconds = Math.floor(Date.now() / 1000) - 3600

    insertShare(sqlite, expiredAtSeconds)
    mocks.durationToExpiresAt.mockReturnValue(
      new Date(Date.now() + 7 * 24 * 3600 * 1000),
    )

    const handler = await getHandler()
    const response = await handler({
      params: { slug: CHAT_SLUG },
      body: createBody(),
    } as never)
    const share = readShare(sqlite)

    expect(share.slug).not.toBe(ORIGINAL_SHARE_SLUG)
    expect(share.slug).toMatch(ULID_PATTERN)
    expect(share.id).toBe(SHARE_ROW_ID)
    expect(share.revoked).toBe(0)
    expect(share.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(response.slug).toBe(share.slug)
    expect(response.url.endsWith(`/shared/${share.slug}`)).toBe(true)
    expect(mocks.syncChatShareFiles).toHaveBeenCalledWith(
      `pub-${SHARE_ROW_ID}`,
      `pub-${CHAT_ROW_ID}`,
      1,
      true,
    )
  })

  it('keeps the slug when re-sharing an active share with new settings',
    async () => {
      const activeUntilSeconds = Math.floor(Date.now() / 1000) + 3600

      insertShare(sqlite, activeUntilSeconds)
      mocks.durationToExpiresAt.mockReturnValue(
        new Date(Date.now() + 30 * 24 * 3600 * 1000),
      )

      const handler = await getHandler()
      const response = await handler({
        params: { slug: CHAT_SLUG },
        body: createBody({ duration: 'month', indexable: false }),
      } as never)
      const share = readShare(sqlite)

      expect(share.slug).toBe(ORIGINAL_SHARE_SLUG)
      expect(share.indexable).toBe(0)
      expect(share.expires_at).toBeGreaterThan(activeUntilSeconds)
      expect(response.slug).toBe(ORIGINAL_SHARE_SLUG)
    })

  it('keeps the slug when re-sharing a never-expiring share', async () => {
    insertShare(sqlite, null)
    mocks.durationToExpiresAt.mockReturnValue(null)

    const handler = await getHandler()
    const response = await handler({
      params: { slug: CHAT_SLUG },
      body: createBody({ duration: 'never' }),
    } as never)

    expect(readShare(sqlite).slug).toBe(ORIGINAL_SHARE_SLUG)
    expect(response.slug).toBe(ORIGINAL_SHARE_SLUG)
  })

  it('creates a share with a generated slug when none exists', async () => {
    mocks.durationToExpiresAt.mockReturnValue(null)

    const handler = await getHandler()
    const response = await handler({
      params: { slug: CHAT_SLUG },
      body: createBody({ duration: 'never' }),
    } as never)

    expect(response.slug).toMatch(ULID_PATTERN)
    expect(readShare(sqlite).slug).toBe(response.slug)
  })
})

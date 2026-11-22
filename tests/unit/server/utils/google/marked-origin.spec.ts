import { describe, expect, it, vi } from 'vitest'
import {
  chatHoldsGoogleData,
  chatMarkedOriginExtras,
} from '~~/server/utils/tool-approval/google'
import { createKnowledgeTestDb } from '~~/tests/setup/helpers/knowledge-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const NOW = Math.floor(Date.now() / 1000)

type Store = ReturnType<typeof createKnowledgeTestDb>

function seed(): Store {
  const store = createKnowledgeTestDb()

  store.sqlite.exec(`
    CREATE TABLE chats (
      id integer PRIMARY KEY,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      slug text NOT NULL,
      user_id integer NOT NULL,
      google_data_at integer
    );
  `)

  for (const id of [1, 2, 3, 4]) {
    store.sqlite.prepare(
      'insert into chats (id, created_at, updated_at, slug, user_id)'
      + ' values (?, ?, ?, ?, ?)',
    ).run(id, NOW, NOW, `slug-${id}`, 7)
  }

  return store
}

function insertArtifact(
  store: Store,
  originChatId: number,
  googleDerivedAt: number | null,
) {
  store.sqlite.prepare(
    'insert into artifacts (created_at, updated_at, user_id, origin_chat_id,'
    + ' kind, title, current_version, total_bytes, created_via,'
    + ' google_derived_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(NOW, NOW, 7, originChatId, 'html', 'A', 1, 10, 'chat', googleDerivedAt)
}

function insertDocument(
  store: Store,
  originChatId: number,
  googleDerivedAt: number | null,
) {
  store.sqlite.prepare(
    'insert into documents (created_at, updated_at, user_id, origin_chat_id,'
    + ' format, status, render_attempts, created_via, google_derived_at)'
    + ' values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(NOW, NOW, 7, originChatId, 'pdf', 'ready', 0, 'chat', googleDerivedAt)
}

async function readMarkedOrigin(store: Store, id: number) {
  const chat = await store.db.query.chats.findFirst({
    where: { id: `pub-${id}` },
    columns: { id: true, googleDataAt: true },
    extras: chatMarkedOriginExtras(),
  })

  return Number(chat?.holdsMarkedOrigin)
}

describe('chatMarkedOriginExtras', () => {
  it('reads false for a chat whose artifacts and documents are unmarked',
    async () => {
      const store = seed()

      insertArtifact(store, 1, null)
      insertDocument(store, 1, null)

      expect(await readMarkedOrigin(store, 1)).toBe(0)
    })

  it('reads true for a marked artifact that names the chat as origin',
    async () => {
      const store = seed()

      insertArtifact(store, 2, NOW)

      expect(await readMarkedOrigin(store, 2)).toBe(1)
      expect(await readMarkedOrigin(store, 3)).toBe(0)
    })

  it('reads true for a marked document that names the chat as origin',
    async () => {
      const store = seed()

      insertDocument(store, 4, NOW)

      expect(await readMarkedOrigin(store, 4)).toBe(1)
    })

  it('adds no query: the extra is part of the chat query', () => {
    const query = seed().db.query.chats.findFirst({
      where: { id: 'pub-1' },
      columns: { id: true },
      extras: chatMarkedOriginExtras(),
    }).toSQL()

    expect(query.sql).toContain('exists')
    expect(query.sql).toContain('"artifacts"')
    expect(query.sql).toContain('"documents"')
  })
})

describe('chatHoldsGoogleData with a marked origin', () => {
  it('holds Google data for a marked origin without a flag or a part', () => {
    expect(chatHoldsGoogleData({ holdsMarkedOrigin: 1, messages: [] }))
      .toBe(true)
    expect(chatHoldsGoogleData({ holdsMarkedOrigin: 0, messages: [] }))
      .toBe(false)
    expect(chatHoldsGoogleData({ messages: [] })).toBe(false)
  })
})

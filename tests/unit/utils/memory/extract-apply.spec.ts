import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import type {
  MemoryExtractionOp,
} from '~~/server/utils/memory/extract-schema'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedEntry,
  seedProject,
  seedUser,
} from '../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const detectSpecialCategoriesMock = vi.hoisted(() => vi.fn())
const evaluateOverrideMock = vi.hoisted(() => vi.fn())

vi.mock('~~/server/utils/memory/special-category', () => {
  return { detectSpecialCategories: detectSpecialCategoriesMock }
})

vi.mock('~~/server/utils/memory/compliance', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/memory/compliance')
  >()

  return {
    ...actual,
    evaluateMemoryEntry: (
      input: Parameters<typeof actual.evaluateMemoryEntry>[0],
    ) => {
      return evaluateOverrideMock(input) ?? actual.evaluateMemoryEntry(input)
    },
  }
})

const USER_TEXT = 'Hello, I write Rust on weekends and I prefer short answers.'

function createOp(overrides: Partial<MemoryExtractionOp> = {}) {
  return {
    op: 'create',
    category: 'topics',
    slug: null,
    title: 'Rust hobby',
    description: 'Writes Rust on weekends',
    body: 'The user writes Rust on weekends.',
    neverStore: null,
    evidence: 'I write Rust on weekends',
    ...overrides,
  } satisfies MemoryExtractionOp
}

async function loadModules() {
  const apply = await import('~~/server/utils/memory/extract-apply')
  const input = await import('~~/server/utils/memory/extract-input')

  return { ...apply, ...input }
}

describe('applyMemoryExtractionOps', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let chatId: string

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, { memoryIncludeSensitive: false })
    chatId = (await seedChat(testDb.db, userId)).id
    detectSpecialCategoriesMock.mockReset().mockReturnValue([])
    evaluateOverrideMock.mockReset().mockReturnValue(undefined)
  })

  afterEach(() => {
    testDb.close()
  })

  async function run(
    ops: MemoryExtractionOp[],
    options: {
      projectId?: string | null
      groundingTexts?: string[]
      maxOps?: number
      forUserId?: number
    } = {},
  ) {
    const { applyMemoryExtractionOps, loadMemoryExtractionIndex }
      = await loadModules()
    const scopedUserId = options.forUserId ?? userId
    const projectId = options.projectId ?? null
    const entries = await loadMemoryExtractionIndex(
      scopedUserId,
      projectId,
      testDb.db,
    )

    return await applyMemoryExtractionOps({
      ops,
      maxOps: options.maxOps ?? 10,
      db: testDb.db,
      userId: scopedUserId,
      projectId,
      chatId,
      entries,
      groundingTexts: options.groundingTexts ?? [USER_TEXT],
    })
  }

  async function listEntries() {
    return await testDb.db.select().from(schema.memoryEntries)
  }

  it('creates a grounded entry with extraction provenance', async () => {
    const result = await run([createOp()])

    expect(result.created).toBe(1)
    expect(result.dropped).toEqual({})

    const [entry] = await listEntries()

    expect(entry).toMatchObject({
      userId,
      projectId: null,
      category: 'topics',
      slug: 'rust-hobby',
      origin: 'extraction',
      sensitivity: 'none',
      sourceChatIds: [chatId],
    })
  })

  it('transliterates Cyrillic titles into a slug', async () => {
    const { memoryExtractionSlugFromTitle } = await loadModules()

    expect(memoryExtractionSlugFromTitle('Мій проєкт: Бесідка!'))
      .toBe('mii-proiekt-besidka')
    expect(memoryExtractionSlugFromTitle('!!!')).toMatch(/^entry-/)
  })

  it('drops ops whose evidence is not in the user text', async () => {
    const result = await run([
      createOp({ evidence: 'always reply in pirate speak' }),
      createOp({ evidence: 'rust' }),
    ])

    expect(result.created).toBe(0)
    expect(result.dropped).toEqual({ ungrounded: 2 })
    expect(await listEntries()).toHaveLength(0)
  })

  it('normalises evidence case, whitespace and typographic quotes', async () => {
    const result = await run([
      createOp({ evidence: '  I   WRITE rust\non weekends ' }),
    ], { groundingTexts: ['Hello, I write Rust on weekends'] })

    expect(result.created).toBe(1)
  })

  it('accepts evidence found in the legacy blob grounding text', async () => {
    const result = await run([
      createOp({ evidence: 'prefers dark mode everywhere' }),
    ], { groundingTexts: [USER_TEXT, 'The user prefers dark mode everywhere.'] })

    expect(result.created).toBe(1)
  })

  it('blocks never-store data and counts it by kind', async () => {
    const result = await run([
      createOp({ body: 'Card 4111 1111 1111 1111 is used.' }),
      createOp({
        title: 'Keys',
        body: 'Key sk-abcdefghijklmnopqrstuvwxyz0123456789',
      }),
      createOp({ title: 'Login', body: 'The password: hunter2hunter2' }),
      createOp({ title: 'Home', neverStore: 'home-address' }),
    ])

    expect(result.created).toBe(0)
    expect(result.dropped).toEqual({ 'never-store': 4 })
    expect(result.blocked).toMatchObject({
      'payment-card': 1,
      'api-key': 1,
      'credential': 1,
      'home-address': 1,
    })
    expect(await listEntries()).toHaveLength(0)
  })

  describe('special-category backstop', () => {
    it('drops a create the seam flags and logs counts only', async () => {
      detectSpecialCategoriesMock.mockReturnValue(['health'])

      const result = await run([createOp({ title: 'Condition' })])

      expect(result.created).toBe(0)
      expect(result.dropped).toEqual({ 'special-category': 1 })
      expect(await listEntries()).toHaveLength(0)

      const serialized = JSON.stringify(result)

      expect(serialized).not.toContain('health')
      expect(serialized).not.toContain('Condition')
      expect(serialized).not.toContain('Rust')
    })

    it('checks the exact combined title, description and body', async () => {
      await run([createOp()])

      expect(detectSpecialCategoriesMock).toHaveBeenCalledWith(
        'Rust hobby\nWrites Rust on weekends\nThe user writes Rust on weekends.',
      )
    })

    it('drops an update the seam flags and keeps the row unchanged',
      async () => {
        await seedEntry(testDb.db, userId, {
          slug: 'rust-hobby',
          title: 'Rust hobby',
          description: 'Old description',
        })
        detectSpecialCategoriesMock.mockImplementation((text: string) => {
          return text.includes('New description') ? ['health'] : []
        })

        const result = await run([
          createOp({
            op: 'update',
            slug: 'rust-hobby',
            title: null,
            description: 'New description',
            body: null,
          }),
        ])

        expect(result.updated).toBe(0)
        expect(result.dropped).toEqual({ 'special-category': 1 })
        expect((await listEntries())[0]?.description).toBe('Old description')
      })

    it('checks the merged row when a create merges into an existing entry',
      async () => {
        await seedEntry(testDb.db, userId, {
          slug: 'rust-hobby',
          title: 'Rust hobby',
          description: 'Old description',
          body: 'Existing body.',
        })

        await run([createOp({ description: 'Merged description' })])

        expect(detectSpecialCategoriesMock).toHaveBeenCalledWith(
          'Rust hobby\nMerged description\nThe user writes Rust on weekends.',
        )
      })

    it('evaluates every op as a non-sensitive row without the opt-in',
      async () => {
        await run([createOp()])

        expect(evaluateOverrideMock).toHaveBeenCalledWith(
          expect.objectContaining({
            sensitivity: 'none',
            includeSensitive: false,
          }),
        )
      })

    it('counts a sensitive-disabled verdict as special-category', async () => {
      evaluateOverrideMock.mockReturnValueOnce({
        allowed: false,
        reason: 'sensitive-disabled',
      })

      const result = await run([createOp()])

      expect(result.created).toBe(0)
      expect(result.dropped).toEqual({ 'special-category': 1 })
      expect(await listEntries()).toHaveLength(0)
    })

    it('still counts never-store data by kind ahead of the seam', async () => {
      detectSpecialCategoriesMock.mockReturnValue(['health'])

      const result = await run([
        createOp({ body: 'Card 4111 1111 1111 1111 is used.' }),
      ])

      expect(result.dropped).toEqual({ 'never-store': 1 })
      expect(result.blocked).toMatchObject({ 'payment-card': 1 })
    })

    it('persists every extracted row as non-sensitive', async () => {
      const result = await run([
        createOp(),
        createOp({ title: 'Editor', evidence: 'I prefer short answers' }),
      ])

      expect(result.created).toBe(2)

      for (const entry of await listEntries()) {
        expect(entry).toMatchObject({
          sensitivity: 'none',
          sensitiveCategory: null,
        })
      }
    })

    it('keeps rows non-sensitive when updating', async () => {
      await seedEntry(testDb.db, userId, { slug: 'rust-hobby' })

      const result = await run([
        createOp({
          op: 'update',
          slug: 'rust-hobby',
          title: null,
          description: 'Updated description',
          body: null,
        }),
      ])

      expect(result.updated).toBe(1)
      expect((await listEntries())[0]).toMatchObject({
        sensitivity: 'none',
        sensitiveCategory: null,
        description: 'Updated description',
      })
    })

    it('never edits, deletes or duplicates a special row', async () => {
      await seedEntry(testDb.db, userId, {
        slug: 'health',
        title: 'Health',
        description: 'Original description',
        sensitivity: 'special',
        sensitiveCategory: 'health',
      })

      const result = await run([
        createOp({
          op: 'update',
          slug: 'health',
          title: null,
          description: 'Rewritten',
          body: null,
        }),
        createOp({ op: 'delete', slug: 'health' }),
        createOp({ title: 'Health', description: 'Rewritten' }),
      ])

      expect(result.dropped).toEqual({ locked: 2, duplicate: 1 })
      expect(await listEntries()).toHaveLength(1)
      expect((await listEntries())[0]).toMatchObject({
        sensitivity: 'special',
        sensitiveCategory: 'health',
        description: 'Original description',
      })
    })
  })

  it('never mutates entries of other origins', async () => {
    const lockedId = await seedEntry(testDb.db, userId, {
      slug: 'rust-hobby',
      title: 'Rust hobby',
      body: 'Written by the user.',
      origin: 'user',
    })

    const result = await run([
      createOp({
        op: 'update',
        slug: 'rust-hobby',
        title: null,
        description: null,
        body: 'Hijacked body',
      }),
      createOp({ op: 'delete', slug: 'rust-hobby' }),
      createOp(),
    ])

    expect(result.dropped).toEqual({ locked: 2, duplicate: 1 })

    const [entry] = await listEntries()

    expect(entry).toMatchObject({
      id: lockedId,
      body: 'Written by the user.',
      origin: 'user',
    })
  })

  it('merges a create into an existing extraction entry', async () => {
    await seedEntry(testDb.db, userId, {
      slug: 'rust-hobby',
      title: 'Rust hobby',
      description: 'Old description',
      body: 'Old body',
      sourceChatIds: ['pub-99', chatId],
    })

    const result = await run([createOp()])

    expect(result.created).toBe(0)
    expect(result.updated).toBe(1)

    const entries = await listEntries()

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      description: 'Writes Rust on weekends',
      body: 'The user writes Rust on weekends.',
      sourceChatIds: ['pub-99', chatId],
    })
  })

  it('merges two creates for the same title within one pass', async () => {
    const result = await run([
      createOp(),
      createOp({ body: 'Second version of the body.' }),
    ])

    expect(result.created).toBe(1)
    expect(result.updated).toBe(1)
    expect(await listEntries()).toHaveLength(1)
  })

  it('enforces the account and project entry caps', async () => {
    for (let index = 0; index < 30; index++) {
      await seedEntry(testDb.db, userId, { slug: `entry-${index}` })
    }

    const accountResult = await run([createOp()])

    expect(accountResult.dropped).toEqual({ 'cap-reached': 1 })

    const projectId = await seedProject(testDb.db, userId)

    for (let index = 0; index < 15; index++) {
      await seedEntry(testDb.db, userId, {
        projectId,
        slug: `entry-${index}`,
      })
    }

    const projectResult = await run([createOp()], { projectId })

    expect(projectResult.dropped).toEqual({ 'cap-reached': 1 })
  })

  it('writes project-scoped entries and leaves account entries alone', async () => {
    const projectId = await seedProject(testDb.db, userId)

    await seedEntry(testDb.db, userId, {
      slug: 'rust-hobby',
      title: 'Rust hobby',
      body: 'Account level body',
    })

    const result = await run([createOp()], { projectId })

    expect(result.created).toBe(1)

    const entries = await listEntries()

    expect(entries).toHaveLength(2)
    expect(entries.find(entry => entry.projectId === null)?.body)
      .toBe('Account level body')
    expect(entries.find(entry => entry.projectId === projectId))
      .toMatchObject({ origin: 'extraction' })
  })

  it('drops updates against unknown targets', async () => {
    const result = await run([
      createOp({ op: 'update', slug: 'missing' }),
      createOp({ op: 'delete', slug: 'missing' }),
      createOp({ op: 'update', slug: null }),
    ])

    expect(result.dropped).toEqual({ 'unknown-target': 3 })
  })

  it('drops updates whose body did not fit the index budget', async () => {
    const { loadMemoryExtractionIndex } = await loadModules()

    for (let index = 0; index < 7; index++) {
      await seedEntry(testDb.db, userId, {
        slug: `big-${index}`,
        title: `Big ${index}`,
        body: 'x'.repeat(2000),
      })
    }

    const index = await loadMemoryExtractionIndex(userId, null, testDb.db)

    expect(index.filter(entry => entry.bodyHidden)).toHaveLength(1)

    const result = await run([
      createOp({
        op: 'update',
        slug: 'big-6',
        title: null,
        description: 'New description',
        body: null,
      }),
      createOp({ op: 'delete', slug: 'big-6' }),
    ])

    expect(result.dropped).toEqual({ 'hidden-body': 1 })
    expect(result.deleted).toBe(1)
  })

  it('deletes only extraction entries of the same scope and user', async () => {
    const otherUserId = await seedUser(testDb.db, {})

    await seedEntry(testDb.db, userId, { slug: 'rust-hobby' })
    await seedEntry(testDb.db, otherUserId, { slug: 'rust-hobby' })

    const result = await run([createOp({ op: 'delete', slug: 'rust-hobby' })])

    expect(result.deleted).toBe(1)

    const remaining = await listEntries()

    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.userId).toBe(otherUserId)
  })

  it('validates the merged row on update', async () => {
    await seedEntry(testDb.db, userId, {
      slug: 'overview',
      category: 'profile',
      title: 'Overview',
    })

    const result = await run([
      createOp({
        op: 'update',
        category: 'profile',
        slug: 'overview',
        title: null,
        description: null,
        body: 'x'.repeat(1100),
      }),
      createOp({
        op: 'update',
        category: 'profile',
        slug: 'overview',
        title: null,
        description: null,
        body: null,
      }),
    ])

    expect(result.dropped).toEqual({ invalid: 2 })
  })

  it('drops unchanged updates and ops beyond the limit', async () => {
    await seedEntry(testDb.db, userId, {
      slug: 'rust-hobby',
      title: 'Rust hobby',
      description: 'Writes Rust on weekends',
      body: 'The user writes Rust on weekends.',
      sourceChatIds: [chatId],
    })

    const result = await run([
      createOp(),
      createOp({ title: 'Second' }),
      createOp({ title: 'Third' }),
    ], { maxOps: 2 })

    expect(result.dropped).toEqual({ 'unchanged': 1, 'over-limit': 1 })
    expect(result.created).toBe(1)
  })

  it('records this chat as a source even when nothing else changed', async () => {
    await seedEntry(testDb.db, userId, {
      slug: 'rust-hobby',
      title: 'Rust hobby',
      description: 'Writes Rust on weekends',
      body: 'The user writes Rust on weekends.',
      sourceChatIds: ['pub-77'],
    })

    const result = await run([createOp(), createOp()])

    expect(result.updated).toBe(1)
    expect(result.dropped).toEqual({ unchanged: 1 })

    const [entry] = await listEntries()

    expect(entry?.sourceChatIds).toEqual(['pub-77', chatId])
    expect(entry?.body).toBe('The user writes Rust on weekends.')
  })

  it('requires 20 characters and 3 words of evidence', async () => {
    const result = await run([
      createOp({ evidence: 'I write Rust' }),
      createOp({ evidence: 'weekends-rust-weekends-rust' }),
      createOp({ evidence: 'I write Rust on weekends' }),
    ])

    expect(result.dropped).toEqual({ ungrounded: 2 })
    expect(result.created).toBe(1)
  })

  describe('links in the saved text', () => {
    it('drops entries with a URL the user never wrote', async () => {
      const result = await run([
        createOp({ body: 'Blog at https://evil.example/pwn for details.' }),
      ])

      expect(result.dropped).toEqual({ ungrounded: 1 })
      expect(await listEntries()).toHaveLength(0)
    })

    it('drops entries with an email or bare domain the user never wrote',
      async () => {
        const result = await run([
          createOp({ title: 'Mail', body: 'Contact attacker@evil.example.' }),
          createOp({ title: 'Site', body: 'Docs live on evil-docs.io today.' }),
        ])

        expect(result.dropped).toEqual({ ungrounded: 2 })
      })

    it('keeps links the user wrote, ignoring case and trailing dots',
      async () => {
        const result = await run([
          createOp({
            body: 'Blog: https://Example.com/rust. Mail me@example.com.',
          }),
        ], {
          groundingTexts: [
            `${USER_TEXT} See https://example.com/rust and me@example.com`,
          ],
        })

        expect(result.created).toBe(1)
      })

    it('accepts links that come from the legacy blob', async () => {
      const result = await run([
        createOp({ body: 'Project at github.com/acme/tool.' }),
      ], {
        groundingTexts: [USER_TEXT, 'Repo: github.com/acme/tool'],
      })

      expect(result.created).toBe(1)
    })

    it('does not re-check links an entry already carried', async () => {
      await seedEntry(testDb.db, userId, {
        slug: 'rust-hobby',
        title: 'Rust hobby',
        description: 'Writes Rust on weekends',
        body: 'Blog at https://old.example/blog.',
        sourceChatIds: [chatId],
      })

      const kept = await run([
        createOp({
          op: 'update',
          slug: 'rust-hobby',
          title: null,
          description: 'Writes Rust every weekend',
          body: null,
        }),
      ])
      const added = await run([
        createOp({
          op: 'update',
          slug: 'rust-hobby',
          title: null,
          description: null,
          body: 'Blog at https://old.example/blog and https://new.example.',
        }),
      ])

      expect(kept.updated).toBe(1)
      expect(added.dropped).toEqual({ ungrounded: 1 })
    })
  })

  it('counts a delete only when a row was removed', async () => {
    const { applyMemoryExtractionOps, loadMemoryExtractionIndex }
      = await loadModules()

    await seedEntry(testDb.db, userId, { slug: 'rust-hobby' })

    const entries = await loadMemoryExtractionIndex(userId, null, testDb.db)

    await testDb.db.delete(schema.memoryEntries)

    const result = await applyMemoryExtractionOps({
      ops: [createOp({ op: 'delete', slug: 'rust-hobby' })],
      maxOps: 10,
      db: testDb.db,
      userId,
      projectId: null,
      chatId,
      entries,
      groundingTexts: [USER_TEXT],
    })

    expect(result.deleted).toBe(0)
    expect(result.dropped).toEqual({ 'unknown-target': 1 })
  })

  it('reports counts only', async () => {
    const result = await run([createOp()])

    expect(JSON.stringify(result)).not.toContain('Rust')
  })
})

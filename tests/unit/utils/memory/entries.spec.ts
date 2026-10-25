import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryEntryInput } from '#shared/types/memory.d'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import {
  assertOwnedProject,
  buildMemoryExport,
  createMemoryEntry,
  deleteMemoryEntry,
  findMemoryEntryBySlug,
  getMemoryEntry,
  groupMemoryEntries,
  listMemoryEntries,
  resetMemoryEntries,
  updateMemoryEntry,
} from '~~/server/utils/memory/entries'
import { createMemoryTestDb } from '../../../setup/helpers/memory-db'

const CARD_NUMBER = '4111 1111 1111 1111'
const OWNER = 1
const STRANGER = 2

describe('memory entries service', () => {
  let testDb: ReturnType<typeof createMemoryTestDb>
  let loggerSet: ReturnType<typeof vi.fn>

  function context(userId: number = OWNER) {
    return {
      db: testDb.db,
      userId,
      logger: { set: loggerSet },
    }
  }

  function entryInput(
    overrides: Partial<MemoryEntryInput> = {},
  ): MemoryEntryInput {
    return {
      category: 'topics',
      title: 'Cooking',
      description: 'Likes to cook pasta',
      body: 'Cooks pasta twice a week.',
      ...overrides,
    }
  }

  async function create(
    overrides: Partial<MemoryEntryInput> = {},
    userId: number = OWNER,
  ) {
    return await createMemoryEntry(context(userId), {
      input: entryInput(overrides),
      origin: 'user',
      complianceOrigin: 'memory-api',
    })
  }

  async function update(
    id: string,
    patch: Parameters<typeof updateMemoryEntry>[1]['patch'],
    userId: number = OWNER,
  ) {
    return await updateMemoryEntry(context(userId), {
      id,
      patch,
      complianceOrigin: 'memory-api',
    })
  }

  function seedMany(input: {
    userId: number
    count: number
    projectId?: number
  }): void {
    for (let index = 0; index < input.count; index++) {
      testDb.insertEntry({
        userId: input.userId,
        projectId: input.projectId,
        slug: `seed-${input.projectId ?? 'a'}-${index}`,
      })
    }
  }

  function readStoredRow(id: number) {
    return testDb.sqlite
      .prepare('select * from memory_entries where id = ?')
      .get(id) as Record<string, unknown> | undefined
  }

  beforeEach(() => {
    testDb = createMemoryTestDb()
    loggerSet = vi.fn()
  })

  afterEach(() => {
    testDb.close()
  })

  describe('createMemoryEntry', () => {
    it('stores an account entry with forced origin and no sources', async () => {
      const entry = await createMemoryEntry(context(), {
        input: entryInput({ origin: 'import' }),
        origin: 'user',
        complianceOrigin: 'memory-api',
      })

      expect(entry).toMatchObject({
        projectId: null,
        category: 'topics',
        slug: 'cooking',
        title: 'Cooking',
        description: 'Likes to cook pasta',
        origin: 'user',
        sensitivity: 'none',
        sensitiveCategory: null,
        sourceChatIds: [],
        sourceMessageId: null,
        lastUsedAt: null,
      })
      expect(entry.id).toMatch(/^[A-Za-z0-9]+$/)
      expect(new Date(entry.createdAt).toISOString()).toBe(entry.createdAt)
      expect(testDb.countEntries(OWNER)).toBe(1)
    })

    it('lets the caller origin win over the client origin', async () => {
      const entry = await createMemoryEntry(context(), {
        input: entryInput({ origin: 'user' }),
        origin: 'tool',
        sourceChatIds: ['chat-a'],
        sourceMessageId: 'message-a',
        complianceOrigin: 'memory-tool',
      })

      expect(entry.origin).toBe('tool')
      expect(entry.sourceChatIds).toEqual(['chat-a'])
      expect(entry.sourceMessageId).toBe('message-a')
    })

    it('keeps the newest source chat ids within the cap', async () => {
      const sourceChatIds = Array.from({ length: 30 }, (_value, index) => {
        return `chat-${index}`
      })

      const entry = await createMemoryEntry(context(), {
        input: entryInput(),
        origin: 'tool',
        sourceChatIds,
        complianceOrigin: 'memory-tool',
      })

      expect(entry.sourceChatIds).toHaveLength(MEMORY_LIMITS.maxSourceChatIds)
      expect(entry.sourceChatIds.at(-1)).toBe('chat-29')
      expect(entry.sourceChatIds[0]).toBe('chat-10')
    })

    it('trims persisted strings', async () => {
      const entry = await create({
        title: '  Padded title  ',
        description: '  Padded description  ',
      })

      expect(entry.title).toBe('Padded title')
      expect(entry.description).toBe('Padded description')
      expect(entry.slug).toBe('padded-title')
    })

    it('rejects an invalid body with a 400', async () => {
      await expect(create({ title: '   ' })).rejects.toMatchObject({
        status: 400,
      })
      await expect(create({ body: '' })).rejects.toMatchObject({
        status: 400,
      })
      expect(testDb.countEntries()).toBe(0)
    })

    it('rejects a profile body over the always-injected limit', async () => {
      await expect(create({
        category: 'profile',
        body: 'x'.repeat(MEMORY_LIMITS.maxAlwaysInjectedBodyBytes + 1),
      })).rejects.toMatchObject({ status: 400 })
      expect(testDb.countEntries()).toBe(0)
    })

    it('rejects a sensitive category without sensitivity special', async () => {
      await expect(create({
        sensitivity: 'none',
        sensitiveCategory: 'health',
      })).rejects.toMatchObject({ status: 400 })
    })

    describe('slugs', () => {
      it('derives the slug from the title', async () => {
        const entry = await create({ title: 'Favorite Food!' })

        expect(entry.slug).toBe('favorite-food')
      })

      it('transliterates a Cyrillic title into the slug', async () => {
        const entry = await create({ title: 'Улюблена їжа' })

        expect(entry.slug).toBe('uliublena-izha')
      })

      it('appends -2, -3 on derived slug collisions', async () => {
        const first = await create({ title: 'Cooking' })
        const second = await create({ title: 'Cooking' })
        const third = await create({ title: 'cooking!' })

        expect([first.slug, second.slug, third.slug]).toEqual([
          'cooking',
          'cooking-2',
          'cooking-3',
        ])
      })

      it('fills the first free suffix after a gap', async () => {
        testDb.insertEntry({ userId: OWNER, slug: 'cooking' })
        testDb.insertEntry({ userId: OWNER, slug: 'cooking-2' })
        testDb.insertEntry({ userId: OWNER, slug: 'cooking-4' })

        const entry = await create({ title: 'Cooking' })

        expect(entry.slug).toBe('cooking-3')
      })

      it('does not collide across categories', async () => {
        const topic = await create({ title: 'Music' })
        const area = await create({ title: 'Music', category: 'areas' })

        expect(topic.slug).toBe('music')
        expect(area.slug).toBe('music')
      })

      it('does not collide across users', async () => {
        await create({ title: 'Music' }, STRANGER)

        const entry = await create({ title: 'Music' })

        expect(entry.slug).toBe('music')
      })

      it('returns 409 for a colliding explicit slug', async () => {
        await create({ slug: 'my-slug' })

        await expect(create({ slug: 'my-slug', title: 'Other' }))
          .rejects.toMatchObject({
            status: 409,
            message: 'An entry with this name already exists',
          })
        expect(testDb.countEntries(OWNER)).toBe(1)
      })

      it('uses an explicit slug without suffixing', async () => {
        const entry = await create({ slug: 'custom', title: 'Anything' })

        expect(entry.slug).toBe('custom')
      })

      it('scopes slug uniqueness to a project', async () => {
        testDb.insertProject({ id: 7, userId: OWNER })

        const account = await create({ title: 'Roadmap' })
        const project = await create({
          title: 'Roadmap',
          projectId: encodePublicId(7),
        })

        expect(account.slug).toBe('roadmap')
        expect(project.slug).toBe('roadmap')
        expect(project.projectId).toBe(encodePublicId(7))
      })

      it('keeps a long derived slug within the cap when suffixing', async () => {
        const title = 'a'.repeat(MEMORY_LIMITS.maxTitleChars)

        await create({ title })

        const second = await create({ title })

        expect(second.slug.length).toBeLessThanOrEqual(
          MEMORY_LIMITS.maxSlugChars,
        )
        expect(second.slug.endsWith('-2')).toBe(true)
      })
    })

    describe('singleton categories', () => {
      it('forces the category name as the slug', async () => {
        const profile = await create({
          category: 'profile',
          title: 'About me',
          slug: 'ignored',
        })
        const preferences = await create({
          category: 'preferences',
          title: 'How I like answers',
        })

        expect(profile.slug).toBe('profile')
        expect(preferences.slug).toBe('preferences')
      })

      it('returns 409 for a second profile entry', async () => {
        await create({ category: 'profile', title: 'First' })

        await expect(create({ category: 'profile', title: 'Second' }))
          .rejects.toMatchObject({
            status: 409,
            message: 'The profile entry already exists, edit it instead',
          })
        expect(testDb.countEntries(OWNER)).toBe(1)
      })

      it('returns 409 for a second preferences entry', async () => {
        await create({ category: 'preferences', title: 'First' })

        await expect(create({ category: 'preferences', title: 'Second' }))
          .rejects.toMatchObject({
            status: 409,
            message: 'The preferences entry already exists, edit it instead',
          })
      })

      it('reports the existing singleton instead of the cap at the cap', async () => {
        seedMany({
          userId: OWNER,
          count: MEMORY_LIMITS.maxAccountEntries - 1,
        })
        testDb.insertEntry({
          userId: OWNER,
          category: 'profile',
          slug: 'profile',
        })

        await expect(create({ category: 'profile', title: 'Second' }))
          .rejects.toMatchObject({
            status: 409,
            message: 'The profile entry already exists, edit it instead',
          })
        expect(testDb.countEntries(OWNER))
          .toBe(MEMORY_LIMITS.maxAccountEntries)
      })

      it('reports the cap for a first singleton when no entry exists', async () => {
        seedMany({ userId: OWNER, count: MEMORY_LIMITS.maxAccountEntries })

        await expect(create({ category: 'preferences', title: 'First' }))
          .rejects.toMatchObject({
            status: 409,
            message: 'Memory limit reached',
          })
      })

      it('allows one profile per scope and per user', async () => {
        testDb.insertProject({ id: 7, userId: OWNER })

        await create({ category: 'profile', title: 'Account' })
        await create({ category: 'profile', title: 'Other user' }, STRANGER)
        const project = await create({
          category: 'profile',
          title: 'Project',
          projectId: encodePublicId(7),
        })

        expect(project.slug).toBe('profile')
        expect(testDb.countEntries()).toBe(3)
      })
    })

    describe('caps', () => {
      it('rejects the account entry over the cap with a 409', async () => {
        seedMany({ userId: OWNER, count: MEMORY_LIMITS.maxAccountEntries })

        await expect(create()).rejects.toMatchObject({
          status: 409,
          message: 'Memory limit reached',
        })
        expect(testDb.countEntries(OWNER))
          .toBe(MEMORY_LIMITS.maxAccountEntries)
      })

      it('accepts the entry that exactly reaches the account cap', async () => {
        seedMany({ userId: OWNER, count: MEMORY_LIMITS.maxAccountEntries - 1 })

        await create()

        expect(testDb.countEntries(OWNER))
          .toBe(MEMORY_LIMITS.maxAccountEntries)
      })

      it('rejects the project entry over the project cap', async () => {
        testDb.insertProject({ id: 7, userId: OWNER })
        seedMany({
          userId: OWNER,
          projectId: 7,
          count: MEMORY_LIMITS.maxProjectEntries,
        })

        await expect(create({ projectId: encodePublicId(7) }))
          .rejects.toMatchObject({
            status: 409,
            message: 'Memory limit reached',
          })
      })

      it('counts account and project scopes separately', async () => {
        testDb.insertProject({ id: 7, userId: OWNER })
        seedMany({
          userId: OWNER,
          projectId: 7,
          count: MEMORY_LIMITS.maxProjectEntries,
        })
        seedMany({ userId: OWNER, count: MEMORY_LIMITS.maxAccountEntries - 1 })

        await create()

        expect(testDb.countEntries(OWNER)).toBe(
          MEMORY_LIMITS.maxProjectEntries + MEMORY_LIMITS.maxAccountEntries,
        )
      })

      it('does not count another user entries', async () => {
        seedMany({ userId: STRANGER, count: MEMORY_LIMITS.maxAccountEntries })

        const entry = await create()

        expect(entry.slug).toBe('cooking')
      })
    })

    describe('project ownership', () => {
      it('creates in an owned project', async () => {
        testDb.insertProject({ id: 7, userId: OWNER })

        const entry = await create({ projectId: encodePublicId(7) })

        expect(entry.projectId).toBe(encodePublicId(7))
      })

      it('returns 404 for a project owned by someone else', async () => {
        testDb.insertProject({ id: 8, userId: STRANGER })

        await expect(create({ projectId: encodePublicId(8) }))
          .rejects.toMatchObject({ status: 404, message: 'Project not found' })
        expect(testDb.countEntries()).toBe(0)
      })

      it('returns 404 for an unknown or malformed project id', async () => {
        await expect(create({ projectId: encodePublicId(999) }))
          .rejects.toMatchObject({ status: 404 })
        await expect(create({ projectId: 'not-a-real-id' }))
          .rejects.toMatchObject({ status: 404 })
        expect(testDb.countEntries()).toBe(0)
      })

      it('treats a null project id as account scope', async () => {
        const entry = await create({ projectId: null })

        expect(entry.projectId).toBeNull()
      })

      it('assertOwnedProject rejects a foreign project', async () => {
        testDb.insertProject({ id: 8, userId: STRANGER })

        await expect(
          assertOwnedProject(testDb.db, OWNER, encodePublicId(8)),
        ).rejects.toMatchObject({ status: 404 })
        await expect(
          assertOwnedProject(testDb.db, STRANGER, encodePublicId(8)),
        ).resolves.toBeUndefined()
      })
    })

    describe('compliance', () => {
      it('blocks never-store data with a 422 and no content in the error', async () => {
        const promise = create({ body: `My card is ${CARD_NUMBER}` })

        await expect(promise).rejects.toMatchObject({
          status: 422,
          message: 'This memory contains data that cannot be stored',
        })

        const exception = await promise.catch((caught: unknown) => {
          return caught as { why?: string }
        })

        expect(exception.why).toContain('payment-card')
        expect(exception.why).not.toContain('4111')
        expect(testDb.countEntries()).toBe(0)
        expect(loggerSet).toHaveBeenCalledWith({
          attributes: {
            memoryCompliance: {
              origin: 'memory-api',
              blocked: { 'payment-card': 1 },
              blockedTotal: 1,
            },
          },
        })
      })

      it('checks the title and description too', async () => {
        await expect(create({ title: `Card ${CARD_NUMBER}` }))
          .rejects.toMatchObject({ status: 422 })
        await expect(create({ description: `Card ${CARD_NUMBER}` }))
          .rejects.toMatchObject({ status: 422 })
      })

      it('records the compliance origin it was given', async () => {
        await expect(createMemoryEntry(context(), {
          input: entryInput({ body: CARD_NUMBER }),
          origin: 'tool',
          complianceOrigin: 'memory-tool',
        })).rejects.toMatchObject({ status: 422 })

        expect(loggerSet).toHaveBeenCalledWith({
          attributes: {
            memoryCompliance: expect.objectContaining({
              origin: 'memory-tool',
            }),
          },
        })
      })

      it('works without a logger', async () => {
        await expect(createMemoryEntry({ db: testDb.db, userId: OWNER }, {
          input: entryInput({ body: CARD_NUMBER }),
          origin: 'user',
          complianceOrigin: 'memory-api',
        })).rejects.toMatchObject({ status: 422 })
      })

      it('rejects sensitive entries without a settings row', async () => {
        await expect(create({
          sensitivity: 'special',
          sensitiveCategory: 'health',
        })).rejects.toMatchObject({
          status: 409,
          message: 'Sensitive memory is turned off',
        })
        expect(testDb.countEntries()).toBe(0)
      })

      it('rejects sensitive entries when the legacy column is 0', async () => {
        testDb.insertUserSettings({
          userId: OWNER,
          memoryIncludeSensitive: false,
        })

        await expect(create({ sensitivity: 'special' }))
          .rejects.toMatchObject({ status: 409 })
      })

      it('still rejects sensitive entries when the legacy column is 1',
        async () => {
          testDb.insertUserSettings({
            userId: OWNER,
            memoryIncludeSensitive: true,
          })

          await expect(create({
            sensitivity: 'special',
            sensitiveCategory: 'health',
          })).rejects.toMatchObject({
            status: 409,
            message: 'Sensitive memory is turned off',
          })
          expect(testDb.countEntries()).toBe(0)
        })

      it('ignores another user legacy column', async () => {
        testDb.insertUserSettings({
          userId: STRANGER,
          memoryIncludeSensitive: true,
        })

        await expect(create({ sensitivity: 'special' }))
          .rejects.toMatchObject({ status: 409 })
      })

      it('blocks never-store data first when the legacy column is 1',
        async () => {
          testDb.insertUserSettings({
            userId: OWNER,
            memoryIncludeSensitive: true,
          })

          await expect(create({
            sensitivity: 'special',
            body: CARD_NUMBER,
          })).rejects.toMatchObject({ status: 422 })
        })
    })

    it('lets exactly one of two concurrent creates take the last slot', async () => {
      seedMany({ userId: OWNER, count: MEMORY_LIMITS.maxAccountEntries - 1 })

      const results = await Promise.allSettled([
        create({ title: 'Race one' }),
        create({ title: 'Race two' }),
      ])
      const fulfilled = results.filter(result => result.status === 'fulfilled')
      const rejected = results.filter(result => result.status === 'rejected')

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect((rejected[0] as PromiseRejectedResult).reason)
        .toMatchObject({ status: 409 })
      expect(testDb.countEntries(OWNER)).toBe(MEMORY_LIMITS.maxAccountEntries)
    })

    it('retries with the next suffix when concurrent creates collide', async () => {
      const results = await Promise.all([
        create({ title: 'Cooking' }),
        create({ title: 'Cooking' }),
        create({ title: 'Cooking' }),
      ])

      expect(results.map(entry => entry.slug).sort()).toEqual([
        'cooking',
        'cooking-2',
        'cooking-3',
      ])
    })

    it('never answers a unique violation with a 500', async () => {
      await create({ slug: 'same' })

      const exception = await create({ slug: 'same', title: 'Different' })
        .catch((caught: unknown) => {
          return caught as { status?: number }
        })

      expect(exception.status).toBe(409)
    })
  })

  describe('getMemoryEntry and findMemoryEntryBySlug', () => {
    it('returns an owned entry', async () => {
      const created = await create()

      expect(await getMemoryEntry({
        db: testDb.db,
        userId: OWNER,
        id: created.id,
      })).toEqual(created)
    })

    it('hides entries owned by another user', async () => {
      const created = await create()

      expect(await getMemoryEntry({
        db: testDb.db,
        userId: STRANGER,
        id: created.id,
      })).toBeNull()
    })

    it('returns null for unknown and malformed ids', async () => {
      expect(await getMemoryEntry({
        db: testDb.db,
        userId: OWNER,
        id: encodePublicId(404),
      })).toBeNull()
      expect(await getMemoryEntry({
        db: testDb.db,
        userId: OWNER,
        id: 'garbage',
      })).toBeNull()
      expect(await getMemoryEntry({
        db: testDb.db,
        userId: OWNER,
        id: 'not-a-real-id',
      })).toBeNull()
    })

    it('finds an entry by scope, category and slug', async () => {
      testDb.insertProject({ id: 7, userId: OWNER })

      const account = await create({ title: 'Roadmap' })
      const project = await create({
        title: 'Roadmap',
        projectId: encodePublicId(7),
      })

      expect(await findMemoryEntryBySlug({
        db: testDb.db,
        userId: OWNER,
        projectId: null,
        category: 'topics',
        slug: 'roadmap',
      })).toEqual(account)
      expect(await findMemoryEntryBySlug({
        db: testDb.db,
        userId: OWNER,
        projectId: encodePublicId(7),
        category: 'topics',
        slug: 'roadmap',
      })).toEqual(project)
      expect(await findMemoryEntryBySlug({
        db: testDb.db,
        userId: STRANGER,
        projectId: null,
        category: 'topics',
        slug: 'roadmap',
      })).toBeNull()
    })
  })

  describe('listMemoryEntries', () => {
    it('orders by category then title and keeps scopes apart', async () => {
      testDb.insertProject({ id: 7, userId: OWNER })

      await create({ title: 'Zeta', category: 'topics' })
      await create({ title: 'Alpha', category: 'topics' })
      await create({ title: 'Me', category: 'profile' })
      await create({ title: 'People', category: 'people' })
      await create({ title: 'Project one', projectId: encodePublicId(7) })
      await create({ title: 'Stranger', category: 'profile' }, STRANGER)

      const account = await listMemoryEntries({
        db: testDb.db,
        userId: OWNER,
        scope: { kind: 'account' },
      })
      const project = await listMemoryEntries({
        db: testDb.db,
        userId: OWNER,
        scope: { kind: 'project', projectId: encodePublicId(7) },
      })
      const all = await listMemoryEntries({
        db: testDb.db,
        userId: OWNER,
        scope: { kind: 'all' },
      })

      expect(account.map(entry => entry.title)).toEqual([
        'Me',
        'Alpha',
        'Zeta',
        'People',
      ])
      expect(project.map(entry => entry.title)).toEqual(['Project one'])
      expect(all).toHaveLength(5)
      expect(all.some(entry => entry.title === 'Stranger')).toBe(false)
    })

    it('rejects a foreign project scope with a 404', async () => {
      testDb.insertProject({ id: 8, userId: STRANGER })
      testDb.insertEntry({ userId: STRANGER, projectId: 8, slug: 'secret' })

      await expect(listMemoryEntries({
        db: testDb.db,
        userId: OWNER,
        scope: { kind: 'project', projectId: encodePublicId(8) },
      })).rejects.toMatchObject({ status: 404 })
    })

    it('groups entries under all five categories in order', async () => {
      await create({ title: 'Cooking' })

      const groups = groupMemoryEntries(await listMemoryEntries({
        db: testDb.db,
        userId: OWNER,
        scope: { kind: 'account' },
      }))

      expect(groups.map(group => group.category)).toEqual([
        'profile',
        'preferences',
        'areas',
        'topics',
        'people',
      ])
      expect(groups.map(group => group.entries.length))
        .toEqual([0, 0, 0, 1, 0])
    })
  })

  describe('updateMemoryEntry', () => {
    it('applies the patch, keeps the slug and returns the previous row', async () => {
      testDb.insertEntry({
        id: 5,
        userId: OWNER,
        slug: 'cooking',
        title: 'Cooking',
        updatedAt: 1_000_000,
      })

      const { entry, previous } = await update(encodePublicId(5), {
        title: 'Baking',
        body: 'Bakes bread.',
      })

      expect(entry).toMatchObject({
        id: encodePublicId(5),
        slug: 'cooking',
        title: 'Baking',
        body: 'Bakes bread.',
      })
      expect(previous).toMatchObject({
        title: 'Cooking',
        body: 'Body of cooking',
      })
      expect(new Date(entry.updatedAt).getTime())
        .toBeGreaterThan(new Date(previous.updatedAt).getTime())
    })

    it('trims patched strings', async () => {
      const created = await create()
      const { entry } = await update(created.id, { title: '  Padded  ' })

      expect(entry.title).toBe('Padded')
    })

    it('replaces origin, sources and message id only when given', async () => {
      const created = await create()

      const untouched = await update(created.id, { title: 'Renamed' })

      expect(untouched.entry).toMatchObject({
        origin: 'user',
        sourceChatIds: [],
        sourceMessageId: null,
      })

      const { entry } = await updateMemoryEntry(context(), {
        id: created.id,
        patch: { description: 'Updated by the model' },
        origin: 'tool',
        sourceChatIds: ['chat-1', 'chat-2'],
        sourceMessageId: 'message-1',
        complianceOrigin: 'memory-tool',
      })

      expect(entry).toMatchObject({
        origin: 'tool',
        sourceChatIds: ['chat-1', 'chat-2'],
        sourceMessageId: 'message-1',
      })
    })

    it('re-marks an extraction entry as user-owned when a user edit passes the origin', async () => {
      testDb.insertEntry({
        id: 5,
        userId: OWNER,
        slug: 'cooking',
        origin: 'extraction',
        sourceChatIds: ['chat-1'],
      })

      const { entry, previous } = await updateMemoryEntry(context(), {
        id: encodePublicId(5),
        patch: { title: 'Baking' },
        origin: 'user',
        complianceOrigin: 'memory-api',
      })

      expect(previous.origin).toBe('extraction')
      expect(entry).toMatchObject({
        origin: 'user',
        sourceChatIds: ['chat-1'],
      })
      expect(readStoredRow(5)).toMatchObject({ origin: 'user' })
    })

    it('keeps the stored origin when no origin is passed', async () => {
      testDb.insertEntry({
        id: 5,
        userId: OWNER,
        slug: 'cooking',
        origin: 'extraction',
      })

      const { entry } = await update(encodePublicId(5), { title: 'Baking' })

      expect(entry.origin).toBe('extraction')
    })

    it('returns 404 for another user entry and leaves it untouched', async () => {
      testDb.insertEntry({ id: 5, userId: STRANGER, slug: 'secret' })

      await expect(update(encodePublicId(5), { title: 'Hijacked' }))
        .rejects.toMatchObject({ status: 404 })

      expect(readStoredRow(5)).toMatchObject({ title: 'secret' })
    })

    it('returns 404 for unknown and malformed ids', async () => {
      await expect(update(encodePublicId(404), { title: 'Nope' }))
        .rejects.toMatchObject({ status: 404 })
      await expect(update('garbage', { title: 'Nope' }))
        .rejects.toMatchObject({ status: 404 })
      await expect(update('not-a-real-id', { title: 'Nope' }))
        .rejects.toMatchObject({ status: 404 })
    })

    it('rejects an empty patch with a 400', async () => {
      const created = await create()

      await expect(update(created.id, {}))
        .rejects.toMatchObject({ status: 400 })
    })

    it('re-validates the merged row when the category moves to profile', async () => {
      const created = await create({
        body: 'x'.repeat(MEMORY_LIMITS.maxAlwaysInjectedBodyBytes + 100),
      })

      await expect(update(created.id, { category: 'profile' }))
        .rejects.toMatchObject({ status: 400 })
      await expect(getMemoryEntry({
        db: testDb.db,
        userId: OWNER,
        id: created.id,
      })).resolves.toMatchObject({ category: 'topics' })
    })

    it('re-validates a stale sensitive category on any patch', async () => {
      testDb.insertEntry({
        id: 5,
        userId: OWNER,
        slug: 'stale',
        sensitivity: 'none',
        sensitiveCategory: 'health',
      })

      await expect(update(encodePublicId(5), { title: 'Fresh' }))
        .rejects.toMatchObject({ status: 400 })
    })

    it('clears the sensitive category when sensitivity becomes none', async () => {
      testDb.insertEntry({
        id: 5,
        userId: OWNER,
        slug: 'legacy-special',
        sensitivity: 'special',
        sensitiveCategory: 'health',
      })

      const { entry } = await update(encodePublicId(5), {
        sensitivity: 'none',
      })

      expect(entry).toMatchObject({
        sensitivity: 'none',
        sensitiveCategory: null,
      })
    })

    it('rejects an explicit sensitive category with sensitivity none', async () => {
      testDb.insertEntry({
        id: 5,
        userId: OWNER,
        slug: 'legacy-special',
        sensitivity: 'special',
        sensitiveCategory: 'health',
      })

      await expect(update(encodePublicId(5), {
        sensitivity: 'none',
        sensitiveCategory: 'drugs',
      })).rejects.toMatchObject({ status: 400 })
    })

    it('blocks never-store data on patch and keeps the row', async () => {
      const created = await create()

      await expect(update(created.id, { body: `Card ${CARD_NUMBER}` }))
        .rejects.toMatchObject({ status: 422 })

      expect(readStoredRow(1)).toMatchObject({
        body: 'Cooks pasta twice a week.',
      })
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: {
          memoryCompliance: expect.objectContaining({
            origin: 'memory-api',
            blockedTotal: 1,
          }),
        },
      })
    })

    it('checks the merged strings, not only the patched ones', async () => {
      testDb.insertEntry({
        id: 5,
        userId: OWNER,
        slug: 'carded',
        body: `Card ${CARD_NUMBER}`,
      })

      await expect(update(encodePublicId(5), { title: 'Renamed' }))
        .rejects.toMatchObject({ status: 422 })
    })

    it('rejects making an entry sensitive without a settings row', async () => {
      const created = await create()

      await expect(update(created.id, { sensitivity: 'special' }))
        .rejects.toMatchObject({
          status: 409,
          message: 'Sensitive memory is turned off',
        })
    })

    it('still rejects making an entry sensitive when the legacy column is 1',
      async () => {
        testDb.insertUserSettings({
          userId: OWNER,
          memoryIncludeSensitive: true,
        })

        const created = await create()

        await expect(update(created.id, {
          sensitivity: 'special',
          sensitiveCategory: 'religion-or-belief',
        })).rejects.toMatchObject({
          status: 409,
          message: 'Sensitive memory is turned off',
        })
        expect(readStoredRow(1)).toMatchObject({ sensitivity: 'none' })
      })

    it('makes the slug the category name when moving into profile', async () => {
      const created = await create({ title: 'About me' })
      const { entry } = await update(created.id, { category: 'profile' })

      expect(entry).toMatchObject({ category: 'profile', slug: 'profile' })
    })

    it('returns 409 when moving into an occupied singleton', async () => {
      await create({ category: 'profile', title: 'Existing' })

      const topic = await create({ title: 'About me' })

      await expect(update(topic.id, { category: 'profile' }))
        .rejects.toMatchObject({
          status: 409,
          message: 'The profile entry already exists, edit it instead',
        })
    })

    it('returns 409, not 500, when the slug exists in the target category', async () => {
      testDb.insertEntry({ id: 5, userId: OWNER, slug: 'music' })
      testDb.insertEntry({
        id: 6,
        userId: OWNER,
        slug: 'music',
        category: 'areas',
      })

      await expect(update(encodePublicId(5), { category: 'areas' }))
        .rejects.toMatchObject({
          status: 409,
          message: 'An entry with this name already exists',
        })
    })

    it('never moves a project entry out of its project', async () => {
      testDb.insertProject({ id: 7, userId: OWNER })

      const created = await create({ projectId: encodePublicId(7) })
      const { entry } = await update(created.id, { title: 'Renamed' })

      expect(entry.projectId).toBe(encodePublicId(7))
    })
  })

  describe('deleteMemoryEntry', () => {
    it('deletes an owned entry and returns its snapshot', async () => {
      const created = await create()

      const deleted = await deleteMemoryEntry({
        db: testDb.db,
        userId: OWNER,
        id: created.id,
      })

      expect(deleted).toEqual(created)
      expect(testDb.countEntries()).toBe(0)
    })

    it('returns null and keeps another user entry', async () => {
      const created = await create({}, STRANGER)

      expect(await deleteMemoryEntry({
        db: testDb.db,
        userId: OWNER,
        id: created.id,
      })).toBeNull()
      expect(testDb.countEntries(STRANGER)).toBe(1)
    })

    it('returns null for a missing or malformed id', async () => {
      expect(await deleteMemoryEntry({
        db: testDb.db,
        userId: OWNER,
        id: encodePublicId(404),
      })).toBeNull()
      expect(await deleteMemoryEntry({
        db: testDb.db,
        userId: OWNER,
        id: 'garbage',
      })).toBeNull()
    })
  })

  describe('resetMemoryEntries', () => {
    beforeEach(() => {
      testDb.insertProject({ id: 7, userId: OWNER })
      testDb.insertProject({ id: 8, userId: OWNER })
      testDb.insertProject({ id: 9, userId: STRANGER })
      testDb.insertEntry({ userId: OWNER, slug: 'account-one' })
      testDb.insertEntry({ userId: OWNER, slug: 'account-two' })
      testDb.insertEntry({ userId: OWNER, projectId: 7, slug: 'project-7' })
      testDb.insertEntry({ userId: OWNER, projectId: 8, slug: 'project-8' })
      testDb.insertEntry({ userId: STRANGER, slug: 'stranger-account' })
      testDb.insertEntry({ userId: STRANGER, projectId: 9, slug: 'stranger-p' })
    })

    it('removes only account entries for the account scope', async () => {
      const deleted = await resetMemoryEntries({
        db: testDb.db,
        userId: OWNER,
        scope: { kind: 'account' },
      })

      expect(deleted).toBe(2)
      expect(testDb.countEntries(OWNER)).toBe(2)
      expect(testDb.countEntries(STRANGER)).toBe(2)
    })

    it('removes only one project for the project scope', async () => {
      const deleted = await resetMemoryEntries({
        db: testDb.db,
        userId: OWNER,
        scope: { kind: 'project', projectId: encodePublicId(7) },
      })

      expect(deleted).toBe(1)
      expect(testDb.countEntries(OWNER)).toBe(3)
    })

    it('removes every entry of the user for the all scope', async () => {
      const deleted = await resetMemoryEntries({
        db: testDb.db,
        userId: OWNER,
        scope: { kind: 'all' },
      })

      expect(deleted).toBe(4)
      expect(testDb.countEntries(OWNER)).toBe(0)
      expect(testDb.countEntries(STRANGER)).toBe(2)
    })

    it('rejects a foreign project and deletes nothing', async () => {
      await expect(resetMemoryEntries({
        db: testDb.db,
        userId: OWNER,
        scope: { kind: 'project', projectId: encodePublicId(9) },
      })).rejects.toMatchObject({ status: 404 })

      expect(testDb.countEntries()).toBe(6)
    })

    it('returns 0 when there is nothing to delete', async () => {
      expect(await resetMemoryEntries({
        db: testDb.db,
        userId: 77,
        scope: { kind: 'all' },
      })).toBe(0)
    })
  })

  describe('buildMemoryExport', () => {
    it('returns defaults, owned projects and all entries', async () => {
      testDb.insertProject({ id: 7, userId: OWNER, name: 'Has entries' })
      testDb.insertProject({
        id: 8,
        userId: OWNER,
        name: 'Legacy only',
        memory: 'Old blob',
        useAccountMemory: false,
      })
      testDb.insertProject({ id: 9, userId: OWNER, name: 'Nothing' })
      testDb.insertProject({
        id: 10,
        userId: OWNER,
        name: 'Blank legacy',
        memory: '   ',
      })

      await create({ title: 'Account entry' })
      await create({ title: 'Project entry', projectId: encodePublicId(7) })

      const exported = await buildMemoryExport({
        db: testDb.db,
        userId: OWNER,
      })

      expect(exported.version).toBe(1)
      expect(new Date(exported.exportedAt).toISOString())
        .toBe(exported.exportedAt)
      expect(exported.settings).toEqual({
        memoryEnabled: true,
        memoryExtractionEnabled: false,
        chatSearchEnabled: true,
        memoryIncludeSensitive: false,
        aboutMe: null,
        profileMemoryModel: null,
        profileMemoryGateway: null,
        projectMemoryModel: null,
        projectMemoryGateway: null,
      })
      expect(exported.projects).toEqual([
        {
          id: encodePublicId(7),
          name: 'Has entries',
          useAccountMemory: true,
          legacyMemory: null,
        },
        {
          id: encodePublicId(8),
          name: 'Legacy only',
          useAccountMemory: false,
          legacyMemory: 'Old blob',
        },
      ])
      expect(exported.entries.map(entry => entry.title).sort())
        .toEqual(['Account entry', 'Project entry'])
    })

    it('reflects stored settings and exports a constant false sensitive flag',
      async () => {
        testDb.insertUserSettings({
          userId: OWNER,
          memoryEnabled: true,
          chatSearchEnabled: false,
          memoryIncludeSensitive: true,
          aboutMe: '  I am a tester  ',
        })

        const exported = await buildMemoryExport({
          db: testDb.db,
          userId: OWNER,
        })

        expect(exported.settings).toMatchObject({
          memoryEnabled: true,
          chatSearchEnabled: false,
          memoryIncludeSensitive: false,
          aboutMe: 'I am a tester',
        })
      })

    it('never includes another user data', async () => {
      testDb.insertProject({ id: 8, userId: STRANGER, memory: 'Secret blob' })
      testDb.insertUserSettings({
        userId: STRANGER,
        memoryEnabled: true,
        aboutMe: 'Stranger about me',
      })
      testDb.insertEntry({ userId: STRANGER, slug: 'secret' })
      testDb.insertEntry({ userId: STRANGER, projectId: 8, slug: 'secret-p' })
      await create({ title: 'Mine' })

      const exported = await buildMemoryExport({
        db: testDb.db,
        userId: OWNER,
      })
      const serialized = JSON.stringify(exported)

      expect(exported.entries).toHaveLength(1)
      expect(exported.projects).toEqual([])
      expect(exported.settings.memoryEnabled).toBe(true)
      expect(serialized).not.toContain('Secret blob')
      expect(serialized).not.toContain('Stranger about me')
      expect(serialized).not.toContain('secret')
    })

    it('has no user id fields', async () => {
      await create()

      const exported = await buildMemoryExport({
        db: testDb.db,
        userId: OWNER,
      })

      expect(Object.keys(exported).sort()).toEqual([
        'entries',
        'exportedAt',
        'projects',
        'settings',
        'version',
      ])
      expect(Object.keys(exported.entries[0]!)).not.toContain('userId')
    })
  })
})

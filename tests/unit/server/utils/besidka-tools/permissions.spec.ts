import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const {
  createBesidkaPermissionCache,
  listBesidkaToolPermissions,
  pickBesidkaPermissionMode,
  resolveBesidkaPermissionModes,
  resolveBesidkaPermissionMode,
  setBesidkaToolPermissions,
  toBesidkaRegistryName,
} = await import('~~/server/utils/besidka-tools/permissions')
const { listChatExposedBesidkaTools } = await import(
  '~~/server/utils/besidka-tools/registry'
)

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, message: string }
  }

  throw new Error('Expected a rejection')
}

describe('Besidka tool permissions', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
  })

  it('lists every exposed tool as "ask" until a mode is stored', async () => {
    const entries = await listBesidkaToolPermissions(userId, testDb.db)

    expect(entries).toHaveLength(listChatExposedBesidkaTools().length)
    expect(new Set(entries.map(entry => entry.mode))).toEqual(
      new Set(['ask']),
    )
    expect(entries.map(entry => entry.tier)).toEqual(
      [...entries.map(entry => entry.tier)].sort((first, second) => {
        const order = ['read', 'write', 'ask-every-time']

        return order.indexOf(first) - order.indexOf(second)
      }),
    )
    expect(entries.map(entry => entry.name)).not.toContain('set_feature_access')
    expect(entries.map(entry => entry.name)).not.toContain('add_memory')
  })

  it('stores one tool and reads it back, only for that user', async () => {
    const otherUserId = await seedUser(testDb.db, null)

    await setBesidkaToolPermissions(
      userId,
      { tool: 'list_files' },
      'allow',
      testDb.db,
    )
    await setBesidkaToolPermissions(
      userId,
      { tool: 'list_files' },
      'blocked',
      testDb.db,
    )

    const own = await listBesidkaToolPermissions(userId, testDb.db)
    const other = await listBesidkaToolPermissions(otherUserId, testDb.db)

    expect(own.find(entry => entry.name === 'list_files')?.mode)
      .toBe('blocked')
    expect(other.find(entry => entry.name === 'list_files')?.mode)
      .toBe('ask')

    const rows = await testDb.db.select()
      .from(schema.besidkaToolPermissions)

    expect(rows).toHaveLength(1)
  })

  it('sets a whole group and leaves the other groups alone', async () => {
    const changed = await setBesidkaToolPermissions(
      userId,
      { tier: 'read' },
      'allow',
      testDb.db,
    )
    const entries = await listBesidkaToolPermissions(userId, testDb.db)

    expect(changed).toBe(listChatExposedBesidkaTools('read').length)
    expect(entries.filter(entry => entry.tier === 'read')
      .every(entry => entry.mode === 'allow')).toBe(true)
    expect(entries.filter(entry => entry.tier !== 'read')
      .every(entry => entry.mode === 'ask')).toBe(true)
  })

  it('never stores "allow" for the ask-every-time tier', async () => {
    const [askEveryTime] = listChatExposedBesidkaTools('ask-every-time')

    expect((await failureOf(setBesidkaToolPermissions(
      userId,
      { tool: askEveryTime!.name },
      'allow',
      testDb.db,
    ))).status).toBe(400)
    expect((await failureOf(setBesidkaToolPermissions(
      userId,
      { tier: 'ask-every-time' },
      'allow',
      testDb.db,
    ))).status).toBe(400)

    await setBesidkaToolPermissions(
      userId,
      { tier: 'ask-every-time' },
      'blocked',
      testDb.db,
    )

    expect((await listBesidkaToolPermissions(userId, testDb.db))
      .filter(entry => entry.tier === 'ask-every-time')
      .every(entry => entry.mode === 'blocked')).toBe(true)
  })

  it('refuses an unknown tool, an excluded tool and a prefixed name', async () => {
    for (const tool of [
      'nope',
      'set_feature_access',
      'add_memory',
      'besidka__list_files',
    ]) {
      expect((await failureOf(setBesidkaToolPermissions(
        userId,
        { tool },
        'ask',
        testDb.db,
      ))).status).toBe(400)
    }
  })

  it('reads a stored "allow" on an ask-every-time tool as "ask"', async () => {
    const [askEveryTime] = listChatExposedBesidkaTools('ask-every-time')

    await testDb.db.insert(schema.besidkaToolPermissions).values({
      userId,
      toolName: askEveryTime!.name,
      mode: 'allow',
    })

    expect(await resolveBesidkaPermissionMode(
      userId,
      askEveryTime!.name,
      { db: testDb.db },
    )).toBe('ask')
    expect((await listBesidkaToolPermissions(userId, testDb.db))
      .find(entry => entry.name === askEveryTime!.name)?.mode).toBe('ask')
  })

  describe('resolveBesidkaPermissionMode', () => {
    it('defaults to "ask", reads the stored mode and accepts the chat name',
      async () => {
        expect(await resolveBesidkaPermissionMode(
          userId,
          'list_files',
          { db: testDb.db },
        )).toBe('ask')

        await setBesidkaToolPermissions(
          userId,
          { tool: 'list_files' },
          'allow',
          testDb.db,
        )

        expect(await resolveBesidkaPermissionMode(
          userId,
          'list_files',
          { db: testDb.db },
        )).toBe('allow')
        expect(await resolveBesidkaPermissionMode(
          userId,
          'besidka__list_files',
          { db: testDb.db },
        )).toBe('allow')
      })

    it('reads a stored mode it does not know as "blocked"', async () => {
      await testDb.db.insert(schema.besidkaToolPermissions).values({
        userId,
        toolName: 'list_files',
        mode: 'sometimes' as never,
      })

      expect(await resolveBesidkaPermissionMode(
        userId,
        'list_files',
        { db: testDb.db },
      )).toBe('blocked')
      expect(await resolveBesidkaPermissionModes(
        userId,
        ['besidka__list_files', 'get_project'],
        testDb.db,
      )).toEqual(new Map([
        ['besidka__list_files', 'blocked'],
        ['get_project', 'ask'],
      ]))
    })

    it('reads an unknown or excluded tool as "blocked"', async () => {
      for (const tool of ['nope', 'set_feature_access', 'add_memory']) {
        expect(await resolveBesidkaPermissionMode(
          userId,
          tool,
          { db: testDb.db },
        )).toBe('blocked')
      }
    })

    it('loads once per cache and per user', async () => {
      const cache = createBesidkaPermissionCache()
      const select = vi.spyOn(testDb.db, 'select')

      await resolveBesidkaPermissionMode(userId, 'list_files', {
        cache,
        db: testDb.db,
      })
      await resolveBesidkaPermissionMode(userId, 'get_project', {
        cache,
        db: testDb.db,
      })

      expect(select).toHaveBeenCalledTimes(1)

      const otherUserId = await seedUser(testDb.db, null)

      await resolveBesidkaPermissionMode(otherUserId, 'list_files', {
        cache,
        db: testDb.db,
      })

      expect(select).toHaveBeenCalledTimes(2)
    })
  })

  it('resolves the modes of named tools from one read', async () => {
    await setBesidkaToolPermissions(
      userId,
      { tool: 'create_file' },
      'blocked',
      testDb.db,
    )

    const select = vi.spyOn(testDb.db, 'select')
    const modes = await resolveBesidkaPermissionModes(
      userId,
      ['besidka__create_file', 'besidka__list_files', 'besidka__nope'],
      testDb.db,
    )

    expect(select).toHaveBeenCalledTimes(1)
    expect(Object.fromEntries(modes)).toEqual({
      besidka__create_file: 'blocked',
      besidka__list_files: 'ask',
      besidka__nope: 'blocked',
    })
  })

  it('picks a mode from loaded modes with no I/O', () => {
    const modes = new Map([['list_files', 'allow' as const]])

    expect(pickBesidkaPermissionMode('besidka__list_files', modes))
      .toBe('allow')
    expect(pickBesidkaPermissionMode('get_project', modes)).toBe('ask')
    expect(pickBesidkaPermissionMode('nope', modes)).toBe('blocked')
    expect(toBesidkaRegistryName('besidka__list_files')).toBe('list_files')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_CALENDAR_CREATE_EVENT_TOOL_NAME,
} from '#shared/utils/google-calendar-tools'
import {
  GOOGLE_GMAIL_SEARCH_TOOL_NAME,
} from '#shared/utils/google-gmail-tools'
import { getGoogleServiceTools } from '#shared/utils/google-tool-catalog'
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
  clearGoogleAlwaysAllow,
  clearGoogleAlwaysAllowOrThrow,
  loadGoogleToolPermissionModes,
  partitionGoogleToolsForMode,
  pickGoogleToolPermissionMode,
  resolveGoogleTargetTools,
  setGoogleToolPermissions,
} = await import('~~/server/utils/google/tool-permissions')
const {
  loadBesidkaToolPermissionModes,
  pickBesidkaPermissionMode,
} = await import('~~/server/utils/besidka-tools/permissions')

async function failureOf(promise: Promise<unknown> | (() => unknown)) {
  try {
    await (typeof promise === 'function' ? promise() : promise)
  } catch (exception) {
    return exception as { status: number, message: string }
  }

  throw new Error('Expected a rejection')
}

describe('Google tool permissions', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
  })

  async function insertRow(toolName: string, mode: string, owner = userId) {
    await testDb.db.insert(schema.besidkaToolPermissions).values({
      userId: owner,
      toolName,
      mode: mode as 'blocked',
    })
  }

  it('has no entry, so every tool means "ask", until a row exists',
    async () => {
      const modes = await loadGoogleToolPermissionModes(userId, testDb.db)

      expect(modes.size).toBe(0)
      expect(pickGoogleToolPermissionMode(
        GOOGLE_GMAIL_SEARCH_TOOL_NAME,
        modes,
      )).toBe('ask')
    })

  it('keeps only google__ rows and reads each stored mode', async () => {
    await insertRow(GOOGLE_GMAIL_SEARCH_TOOL_NAME, 'blocked')
    await insertRow(GOOGLE_CALENDAR_CREATE_EVENT_TOOL_NAME, 'ask')
    await insertRow('list_files', 'blocked')

    const modes = await loadGoogleToolPermissionModes(userId, testDb.db)

    expect([...modes.entries()].sort()).toEqual([
      [GOOGLE_CALENDAR_CREATE_EVENT_TOOL_NAME, 'ask'],
      [GOOGLE_GMAIL_SEARCH_TOOL_NAME, 'blocked'],
    ])
  })

  it('reads a stored "allow" as "allow" for an allowable tool', async () => {
    await insertRow(GOOGLE_GMAIL_SEARCH_TOOL_NAME, 'allow')
    await insertRow(GOOGLE_CALENDAR_CREATE_EVENT_TOOL_NAME, 'allow')

    const modes = await loadGoogleToolPermissionModes(userId, testDb.db)

    expect(pickGoogleToolPermissionMode(
      GOOGLE_GMAIL_SEARCH_TOOL_NAME,
      modes,
    )).toBe('allow')
    expect(pickGoogleToolPermissionMode(
      GOOGLE_CALENDAR_CREATE_EVENT_TOOL_NAME,
      modes,
    )).toBe('allow')
  })

  it('reads a stored "allow" as "ask" for a tool of Besidka\'s client',
    async () => {
      await insertRow('google__drive_read_file', 'allow')
      await insertRow('google__drive_save_file', 'allow')
      await insertRow('google__drive_list_picked', 'allow')

      const modes = await loadGoogleToolPermissionModes(userId, testDb.db)

      expect([...modes.entries()].sort()).toEqual([
        ['google__drive_list_picked', 'ask'],
        ['google__drive_read_file', 'ask'],
        ['google__drive_save_file', 'ask'],
      ])
    })

  it('reads a stored "allow" as "ask" for a name outside the catalog',
    async () => {
      await insertRow('google__list_files', 'allow')

      const modes = await loadGoogleToolPermissionModes(userId, testDb.db)

      expect(modes.get('google__list_files')).toBe('ask')
    })

  it('reads an unknown stored mode as "blocked"', async () => {
    await insertRow(GOOGLE_GMAIL_SEARCH_TOOL_NAME, 'whatever')

    const modes = await loadGoogleToolPermissionModes(userId, testDb.db)

    expect(modes.get(GOOGLE_GMAIL_SEARCH_TOOL_NAME)).toBe('blocked')
  })

  it('never reads another user\'s rows', async () => {
    const otherUserId = await seedUser(testDb.db, null)

    await insertRow(GOOGLE_GMAIL_SEARCH_TOOL_NAME, 'blocked', otherUserId)

    expect((await loadGoogleToolPermissionModes(userId, testDb.db)).size)
      .toBe(0)
  })

  it('never lets a google__ row change a Besidka mode', async () => {
    await insertRow(GOOGLE_GMAIL_SEARCH_TOOL_NAME, 'blocked')
    await insertRow('google__list_files', 'blocked')
    await insertRow('list_files', 'allow')

    const besidkaModes = await loadBesidkaToolPermissionModes(
      userId,
      testDb.db,
    )

    expect(pickBesidkaPermissionMode('list_files', besidkaModes))
      .toBe('allow')
    expect(pickBesidkaPermissionMode('get_project', besidkaModes))
      .toBe('ask')
    expect(pickBesidkaPermissionMode(
      GOOGLE_GMAIL_SEARCH_TOOL_NAME,
      besidkaModes,
    )).toBe('blocked')
  })

  describe('setGoogleToolPermissions', () => {
    it('stores "blocked" for each tool of a service and nothing else',
      async () => {
        const tools = resolveGoogleTargetTools({ service: 'gmail' })
        const changed = await setGoogleToolPermissions(
          userId,
          tools,
          'blocked',
          testDb.db,
        )
        const modes = await loadGoogleToolPermissionModes(userId, testDb.db)

        expect(changed).toBe(getGoogleServiceTools('gmail').length)
        expect([...modes.keys()].sort()).toEqual(
          getGoogleServiceTools('gmail').map(tool => tool.name).sort(),
        )
        expect([...modes.values()].every(mode => mode === 'blocked'))
          .toBe(true)
      })

    it('stores "allow" for an allowable tool and reads it back', async () => {
      const changed = await setGoogleToolPermissions(
        userId,
        resolveGoogleTargetTools({ tool: GOOGLE_GMAIL_SEARCH_TOOL_NAME }),
        'allow',
        testDb.db,
      )
      const modes = await loadGoogleToolPermissionModes(userId, testDb.db)

      expect(changed).toBe(1)
      expect(modes.get(GOOGLE_GMAIL_SEARCH_TOOL_NAME)).toBe('allow')
    })

    it('stores "allow" only for the allowable tools of a group', async () => {
      const tools = resolveGoogleTargetTools({ service: 'drive' })
      const changed = await setGoogleToolPermissions(
        userId,
        tools,
        'allow',
        testDb.db,
      )
      const rows = await testDb.db.select()
        .from(schema.besidkaToolPermissions)

      expect(changed).toBe(7)
      expect(rows.map(row => row.toolName).sort()).toEqual([
        'google__drive_create_file',
        'google__drive_create_folder',
        'google__drive_list_folder',
        'google__drive_move',
        'google__drive_read_found_file',
        'google__drive_rename',
        'google__drive_search',
      ])
      expect(rows.every(row => row.mode === 'allow')).toBe(true)
    })

    it('never stores "allow" for a tool of Besidka\'s client', async () => {
      const changed = await setGoogleToolPermissions(
        userId,
        resolveGoogleTargetTools({ tool: 'google__drive_read_file' }),
        'allow',
        testDb.db,
      )

      expect(changed).toBe(0)
      expect(await testDb.db.select().from(schema.besidkaToolPermissions))
        .toHaveLength(0)
    })

    it('splits a request into the tools that take "allow" and the rest', () => {
      const tools = resolveGoogleTargetTools({ service: 'drive' })
      const allowed = partitionGoogleToolsForMode(tools, 'allow')
      const blocked = partitionGoogleToolsForMode(tools, 'blocked')

      expect(allowed.applied).toHaveLength(7)
      expect(allowed.unchanged.map(tool => tool.name).sort()).toEqual([
        'google__drive_list_picked',
        'google__drive_read_file',
        'google__drive_save_file',
      ])
      expect(blocked.applied).toHaveLength(tools.length)
      expect(blocked.unchanged).toHaveLength(0)
    })

    it('deletes the row on "ask", because the default needs no storage',
      async () => {
        await insertRow(GOOGLE_GMAIL_SEARCH_TOOL_NAME, 'blocked')
        await insertRow(GOOGLE_CALENDAR_CREATE_EVENT_TOOL_NAME, 'blocked')

        await setGoogleToolPermissions(
          userId,
          resolveGoogleTargetTools({ tool: GOOGLE_GMAIL_SEARCH_TOOL_NAME }),
          'ask',
          testDb.db,
        )

        const rows = await testDb.db.select()
          .from(schema.besidkaToolPermissions)

        expect(rows.map(row => row.toolName))
          .toEqual([GOOGLE_CALENDAR_CREATE_EVENT_TOOL_NAME])
      })

    it('writes no row for "ask" on a tool that has none', async () => {
      await setGoogleToolPermissions(
        userId,
        resolveGoogleTargetTools({ tool: GOOGLE_GMAIL_SEARCH_TOOL_NAME }),
        'ask',
        testDb.db,
      )

      expect(await testDb.db.select().from(schema.besidkaToolPermissions))
        .toHaveLength(0)
    })

    it('replaces a stored mode instead of adding a second row', async () => {
      const tools = resolveGoogleTargetTools({
        tool: GOOGLE_GMAIL_SEARCH_TOOL_NAME,
      })

      await setGoogleToolPermissions(userId, tools, 'blocked', testDb.db)
      await setGoogleToolPermissions(userId, tools, 'blocked', testDb.db)

      expect(await testDb.db.select().from(schema.besidkaToolPermissions))
        .toHaveLength(1)
    })

    it('leaves another user\'s rows alone', async () => {
      const otherUserId = await seedUser(testDb.db, null)

      await insertRow(GOOGLE_GMAIL_SEARCH_TOOL_NAME, 'blocked', otherUserId)
      await setGoogleToolPermissions(
        userId,
        resolveGoogleTargetTools({ tool: GOOGLE_GMAIL_SEARCH_TOOL_NAME }),
        'ask',
        testDb.db,
      )

      expect((await loadGoogleToolPermissionModes(otherUserId, testDb.db))
        .get(GOOGLE_GMAIL_SEARCH_TOOL_NAME)).toBe('blocked')
    })
  })

  describe('clearGoogleAlwaysAllow', () => {
    it('deletes only the Google allow rows of this user', async () => {
      const otherUserId = await seedUser(testDb.db, null)

      await insertRow(GOOGLE_GMAIL_SEARCH_TOOL_NAME, 'allow')
      await insertRow(GOOGLE_CALENDAR_CREATE_EVENT_TOOL_NAME, 'blocked')
      await insertRow('list_files', 'allow')
      await insertRow(GOOGLE_GMAIL_SEARCH_TOOL_NAME, 'allow', otherUserId)

      const logger = { set: vi.fn() }
      const cleared = await clearGoogleAlwaysAllow(userId, logger, testDb.db)
      const rows = await testDb.db.select()
        .from(schema.besidkaToolPermissions)

      expect(cleared).toBe(1)
      expect(rows.map(row => `${row.userId}:${row.toolName}:${row.mode}`)
        .sort()).toEqual([
        `${userId}:${GOOGLE_CALENDAR_CREATE_EVENT_TOOL_NAME}:blocked`,
        `${userId}:list_files:allow`,
        `${otherUserId}:${GOOGLE_GMAIL_SEARCH_TOOL_NAME}:allow`,
      ].sort())
      expect(logger.set).not.toHaveBeenCalled()
    })

    it('logs a failure and reports none cleared instead of throwing',
      async () => {
        const logger = { set: vi.fn() }
        const failingDb = {
          delete: () => {
            throw new Error('D1 down')
          },
        }

        expect(await clearGoogleAlwaysAllow(
          userId,
          logger,
          failingDb as never,
        )).toBe(0)
        expect(logger.set).toHaveBeenCalledWith({
          attributes: {
            google: { alwaysAllowCleared: 'failed', error: 'D1 down' },
          },
        })
      })
  })

  describe('clearGoogleAlwaysAllowOrThrow', () => {
    it('deletes the Google allow rows of this user like the other variant',
      async () => {
        await insertRow(GOOGLE_GMAIL_SEARCH_TOOL_NAME, 'allow')
        await insertRow('list_files', 'allow')

        const logger = { set: vi.fn() }

        expect(await clearGoogleAlwaysAllowOrThrow(
          userId,
          logger,
          testDb.db,
        )).toBe(1)
        expect(logger.set).not.toHaveBeenCalled()
      })

    it('logs the error name only and rethrows a failure', async () => {
      const logger = { set: vi.fn() }
      const failingDb = {
        delete: () => {
          throw new Error('D1 down')
        },
      }

      await expect(clearGoogleAlwaysAllowOrThrow(
        userId,
        logger,
        failingDb as never,
      )).rejects.toThrow('D1 down')
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          google: { alwaysAllowCleared: 'failed', errorName: 'Error' },
        },
      })
    })
  })

  describe('resolveGoogleTargetTools', () => {
    it('answers 400 for a name outside the catalog', async () => {
      for (const tool of ['nope', 'list_files', 'google__nope', '']) {
        expect((await failureOf(() => {
          return resolveGoogleTargetTools({ tool })
        })).status).toBe(400)
      }
    })

    it('returns every catalog tool of a service', () => {
      expect(resolveGoogleTargetTools({ service: 'drive' }))
        .toEqual(getGoogleServiceTools('drive'))
    })

    it('returns only the read or write tools of a service for a kind', () => {
      const reads = resolveGoogleTargetTools({
        service: 'drive',
        kind: 'read',
      })
      const writes = resolveGoogleTargetTools({
        service: 'drive',
        kind: 'write',
      })

      expect(reads.length).toBeGreaterThan(0)
      expect(writes.length).toBeGreaterThan(0)
      expect(reads.every(tool => tool.kind === 'read')).toBe(true)
      expect(writes.every(tool => tool.kind === 'write')).toBe(true)
      expect(reads.length + writes.length)
        .toBe(getGoogleServiceTools('drive').length)
    })
  })
})

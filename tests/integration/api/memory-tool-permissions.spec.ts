import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { createSkillsRouteEvent } from '../../setup/helpers/skills-route'
import type { SkillsRouteEvent } from '../../setup/helpers/skills-route'
import { createFakeConnectorKv } from '../../setup/helpers/connectors-oauth'
import {
  loadMemoryToolPermissionModes,
} from '~~/server/utils/memory/tools/permissions'
import { loadBesidkaToolPermissionModes } from '~~/server/utils/besidka-tools/permissions'

const ORIGIN = 'https://besidka.com'

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(['tool-approvals']),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

vi.mock('nuxt/server', async () => {
  const { connectorsNuxtServerMockFactory } = await import(
    '../../setup/helpers/connectors-oauth'
  )

  return await connectorsNuxtServerMockFactory()
})

vi.mock('~~/server/utils/features/guards', () => ({
  requireFeature: async (_event: unknown, flag: string) => {
    if (!mocks.flags.has(flag)) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }

    return { active: true }
  },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: vi.fn() }),
}))

vi.mock('~~/server/utils/request-public-origin', () => ({
  resolveRequestPublicOrigin: () => 'https://besidka.com',
}))

type Handler = (event: SkillsRouteEvent) => Promise<any>

async function handler(path: string): Promise<Handler> {
  return (await import(path)).default as Handler
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number }
  }

  throw new Error('Expected a rejection')
}

const getPath = '~~/server/api/v1/memory/tool-permissions/index.get'
const putPath = '~~/server/api/v1/memory/tool-permissions/index.put'
const besidkaGetPath = '~~/server/api/v1/besidka-tools/permissions/index.get'
const besidkaPutPath = '~~/server/api/v1/besidka-tools/permissions/index.put'

describe('memory tool permission routes', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let sessionUserId: number

  function call(path: string, partial: Partial<SkillsRouteEvent> = {}) {
    return handler(path).then((run) => {
      return run(createSkillsRouteEvent({
        ...partial,
        headers: {
          'origin': ORIGIN,
          'sec-fetch-site': 'same-origin',
          ...partial.headers,
        },
      }))
    })
  }

  function put(body: unknown, partial: Partial<SkillsRouteEvent> = {}) {
    return call(putPath, { body, ...partial })
  }

  function modeOf(result: { tools: Array<{ name: string, mode: string }> }) {
    return Object.fromEntries(
      result.tools.map(tool => [tool.name, tool.mode]),
    )
  }

  beforeEach(async () => {
    mocks.flags = new Set(['tool-approvals'])
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    sessionUserId = userId

    const kv = createFakeConnectorKv()

    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useUserSession', async () => {
      return { user: { id: String(sessionUserId) } }
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('GET', () => {
    it('lists exactly the two write tools, default "ask"', async () => {
      const result = await call(getPath)

      expect(result.tools).toEqual([
        { name: 'memory_write', title: 'Save to memory', mode: 'ask' },
        { name: 'memory_forget', title: 'Forget from memory', mode: 'ask' },
      ])
    })

    it('is hidden behind the tool-approvals flag, not besidka-tools, and '
      + 'needs a session', async () => {
      mocks.flags = new Set(['besidka-tools'])

      expect((await failureOf(call(getPath))).status).toBe(404)

      mocks.flags.add('tool-approvals')
      vi.stubGlobal('useUserSession', async () => null)

      expect((await failureOf(call(getPath))).status).toBe(401)
    })
  })

  describe('PUT', () => {
    it('sets one tool and answers with the stored list', async () => {
      const result = await put({ tool: 'memory_write', mode: 'allow' })

      expect(modeOf(result)).toEqual({
        memory_write: 'allow',
        memory_forget: 'ask',
      })
      expect(modeOf(await call(getPath))).toEqual({
        memory_write: 'allow',
        memory_forget: 'ask',
      })
      expect(await loadMemoryToolPermissionModes(userId, testDb.db)).toEqual({
        memory_write: 'allow',
        memory_forget: 'ask',
      })
    })

    it('answers 400 for Always allow on memory_forget, which cannot be '
      + 'undone, and stores nothing', async () => {
      expect((await failureOf(put({ tool: 'memory_forget', mode: 'allow' })))
        .status).toBe(400)
      expect(modeOf(await call(getPath)).memory_forget).toBe('ask')
      expect(testDb.sqlite
        .prepare('select count(*) as total from besidka_tool_permissions')
        .get()).toEqual({ total: 0 })
    })

    it('keeps Blocked and Needs approval on memory_forget', async () => {
      expect(modeOf(await put({ tool: 'memory_forget', mode: 'blocked' }))
        .memory_forget).toBe('blocked')
      expect(modeOf(await put({ tool: 'memory_forget', mode: 'ask' }))
        .memory_forget).toBe('ask')
    })

    it('upserts, so a second write changes the same row', async () => {
      await put({ tool: 'memory_forget', mode: 'blocked' })
      await put({ tool: 'memory_forget', mode: 'ask' })

      expect(modeOf(await call(getPath)).memory_forget).toBe('ask')
      expect(testDb.sqlite
        .prepare('select count(*) as total from besidka_tool_permissions '
          + 'where tool_name = ?')
        .get('memory_forget')).toEqual({ total: 1 })
    })

    it('answers 400 for another tool, an unknown mode, extra keys and a bad '
      + 'body', async () => {
      for (const body of [
        { tool: 'memory_list', mode: 'allow' },
        { tool: 'memory_read', mode: 'allow' },
        { tool: 'besidka__memory_write', mode: 'allow' },
        { tool: 'list_files', mode: 'allow' },
        { tool: 'memory_write', mode: 'maybe' },
        { tool: 'memory_write', mode: 'allow', tier: 'read' },
        { tool: 'memory_write' },
        { mode: 'allow' },
        null,
      ]) {
        expect((await failureOf(put(body))).status).toBe(400)
      }

      expect(modeOf(await call(getPath))).toEqual({
        memory_write: 'ask',
        memory_forget: 'ask',
      })
    })

    it('isolates users from each other', async () => {
      const otherUserId = await seedUser(testDb.db, null)

      await put({ tool: 'memory_write', mode: 'allow' })

      sessionUserId = otherUserId

      expect(modeOf(await call(getPath)).memory_write).toBe('ask')

      await put({ tool: 'memory_write', mode: 'blocked' })

      sessionUserId = userId

      expect(modeOf(await call(getPath)).memory_write).toBe('allow')
    })

    it('is hidden behind the flag, needs a session and the same origin',
      async () => {
        const body = { tool: 'memory_write', mode: 'ask' }

        mocks.flags.clear()

        expect((await failureOf(put(body))).status).toBe(404)

        mocks.flags.add('tool-approvals')

        expect((await failureOf(put(
          body,
          { headers: { 'sec-fetch-site': 'cross-site' } },
        ))).status).toBe(403)
        expect((await failureOf(put(
          body,
          { headers: { origin: 'https://evil.example.com' } },
        ))).status).toBe(403)

        vi.stubGlobal('useUserSession', async () => null)

        expect((await failureOf(put(body))).status).toBe(401)
      })

    it('limits writes to 60 a minute and fails closed without KV', async () => {
      const body = { tool: 'memory_write', mode: 'ask' }

      for (let attempt = 0; attempt < 60; attempt += 1) {
        await put(body)
      }

      expect((await failureOf(put(body))).status).toBe(429)

      vi.stubGlobal('useKV', () => {
        throw new Error('KV down')
      })
      sessionUserId = await seedUser(testDb.db, null)

      expect((await failureOf(put(body))).status).toBe(429)
    })
  })

  describe('stored mode reading', () => {
    function insertRaw(toolName: string, mode: string) {
      testDb.sqlite
        .prepare('insert into besidka_tool_permissions '
          + '(user_id, tool_name, mode, created_at, updated_at) '
          + 'values (?, ?, ?, 0, 0)')
        .run(userId, toolName, mode)
    }

    it('reads a stored value it does not know as Blocked', async () => {
      insertRaw('memory_write', 'whenever')

      expect(await loadMemoryToolPermissionModes(userId, testDb.db)).toEqual({
        memory_write: 'blocked',
        memory_forget: 'ask',
      })
    })

    it('reads a stored Always allow on memory_forget as Needs approval',
      async () => {
        insertRaw('memory_forget', 'allow')
        insertRaw('memory_write', 'allow')

        expect(await loadMemoryToolPermissionModes(userId, testDb.db))
          .toEqual({ memory_write: 'allow', memory_forget: 'ask' })
        expect(modeOf(await call(getPath)).memory_forget).toBe('ask')
      })

    it('ignores rows of other tools', async () => {
      insertRaw('list_files', 'allow')
      insertRaw('memory_read', 'allow')

      expect(await loadMemoryToolPermissionModes(userId, testDb.db)).toEqual({
        memory_write: 'ask',
        memory_forget: 'ask',
      })
    })
  })

  describe('the Besidka tool routes', () => {
    it('never list the memory tools and still refuse to set them', async () => {
      await put({ tool: 'memory_write', mode: 'allow' })

      mocks.flags.add('besidka-tools')

      const listed = await call(besidkaGetPath)

      expect(modeOf(listed)).not.toHaveProperty('memory_write')
      expect(modeOf(listed)).not.toHaveProperty('memory_forget')

      for (const tool of ['memory_write', 'memory_forget']) {
        expect((await failureOf(call(besidkaPutPath, {
          body: { tool, mode: 'allow' },
        }))).status).toBe(400)
      }
    })

    it('read their stored rows as unknown tools, never as a mode', async () => {
      await put({ tool: 'memory_write', mode: 'allow' })

      const modes = await loadBesidkaToolPermissionModes(userId, testDb.db)
      const { pickBesidkaPermissionMode } = await import(
        '~~/server/utils/besidka-tools/permissions'
      )

      expect(pickBesidkaPermissionMode('memory_write', modes)).toBe('blocked')
      expect(pickBesidkaPermissionMode('besidka__memory_write', modes))
        .toBe('blocked')
    })
  })
})

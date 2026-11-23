import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_DRIVE_LIST_TOOL_NAME,
  GOOGLE_DRIVE_SEARCH_TOOL_NAME,
} from '#shared/utils/google-drive-tools'
import { GOOGLE_GMAIL_SEARCH_TOOL_NAME } from '#shared/utils/google-gmail-tools'
import * as schema from '~~/server/db/schema'
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

const ORIGIN = 'https://besidka.com'

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(['google.drive']),
  isAdmin: false,
  logged: [] as unknown[],
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

vi.mock('~~/server/utils/features/context', () => ({
  evaluateFeatureForEvent: async (_event: unknown, flag: string) => {
    const isOn = mocks.flags.has(flag)

    return { value: isOn, active: isOn }
  },
}))

vi.mock('~~/server/utils/google/byo-access', () => ({
  checkGoogleByoAccess: async (input: { requiredFlags?: string[] }) => {
    if (!mocks.isAdmin) {
      return 'not-admin'
    }

    const flags = ['google.byo', ...input.requiredFlags ?? []]

    return flags.every(flag => mocks.flags.has(flag))
      ? 'allowed'
      : 'flag-off'
  },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({
    set: (values: unknown) => {
      mocks.logged.push(values)
    },
  }),
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

const getPath = '~~/server/api/v1/google/tool-permissions/index.get'
const putPath = '~~/server/api/v1/google/tool-permissions/index.put'

describe('Google tool permission routes', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let sessionUserId: number
  let kv: ReturnType<typeof createFakeConnectorKv>

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

  async function rows() {
    return await testDb.db.select().from(schema.besidkaToolPermissions)
  }

  beforeEach(async () => {
    mocks.flags = new Set(['google.drive'])
    mocks.isAdmin = false
    mocks.logged = []
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    sessionUserId = userId

    kv = createFakeConnectorKv()

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
    it('lists the Besidka-client Drive tools as "ask" for a Drive user',
      async () => {
        const result = await call(getPath)

        expect(modeOf(result)).toEqual({
          [GOOGLE_DRIVE_LIST_TOOL_NAME]: 'ask',
          google__drive_read_file: 'ask',
          google__drive_save_file: 'ask',
        })
        expect(result.tools[0]).toEqual({
          name: GOOGLE_DRIVE_LIST_TOOL_NAME,
          service: 'drive',
          mode: 'ask',
          alwaysAllowable: false,
        })
      })

    it('says for each own-client tool that it can be always allowed',
      async () => {
        mocks.isAdmin = true
        mocks.flags = new Set([
          'google.drive',
          'google.byo',
          'google.gmail',
          'google.calendar',
        ])

        const result = await call(getPath)
        const flags = Object.fromEntries(result.tools.map((tool: {
          name: string
          alwaysAllowable: boolean
        }) => [tool.name, tool.alwaysAllowable]))

        expect(flags[GOOGLE_GMAIL_SEARCH_TOOL_NAME]).toBe(true)
        expect(flags.google__calendar_create_event).toBe(true)
        expect(flags.google__drive_rename).toBe(true)
        expect(flags[GOOGLE_DRIVE_LIST_TOOL_NAME]).toBe(false)
        expect(flags.google__drive_save_file).toBe(false)
      })

    it('adds the own-client tools for an admin with their flags',
      async () => {
        mocks.isAdmin = true
        mocks.flags = new Set([
          'google.drive',
          'google.byo',
          'google.gmail',
          'google.calendar',
        ])

        const result = await call(getPath)

        expect(result.tools).toHaveLength(16)
        expect(modeOf(result)[GOOGLE_GMAIL_SEARCH_TOOL_NAME]).toBe('ask')
      })

    it('leaves out a service whose flag is off', async () => {
      mocks.isAdmin = true
      mocks.flags = new Set(['google.byo', 'google.gmail'])

      const result = await call(getPath)
      const names = result.tools.map((tool: { name: string }) => {
        return tool.name
      })

      expect(names).toContain(GOOGLE_GMAIL_SEARCH_TOOL_NAME)
      expect(names).toContain(GOOGLE_DRIVE_SEARCH_TOOL_NAME)
      expect(names.some((name: string) => name.includes('calendar')))
        .toBe(false)
      expect(names).not.toContain(GOOGLE_DRIVE_LIST_TOOL_NAME)
    })

    it('reads a stored "allow" on a tool of Besidka\'s client as "ask"',
      async () => {
        await testDb.db.insert(schema.besidkaToolPermissions).values({
          userId,
          toolName: GOOGLE_DRIVE_LIST_TOOL_NAME,
          mode: 'allow',
        })

        expect(modeOf(await call(getPath))[GOOGLE_DRIVE_LIST_TOOL_NAME])
          .toBe('ask')
      })

    it('reads a stored "allow" on an own-client tool as "allow"',
      async () => {
        mocks.isAdmin = true
        mocks.flags = new Set(['google.drive', 'google.byo', 'google.gmail'])
        await testDb.db.insert(schema.besidkaToolPermissions).values({
          userId,
          toolName: GOOGLE_GMAIL_SEARCH_TOOL_NAME,
          mode: 'allow',
        })

        expect(modeOf(await call(getPath))[GOOGLE_GMAIL_SEARCH_TOOL_NAME])
          .toBe('allow')
      })

    it('reads an unknown stored mode as "blocked"', async () => {
      await testDb.db.insert(schema.besidkaToolPermissions).values({
        userId,
        toolName: GOOGLE_DRIVE_LIST_TOOL_NAME,
        mode: 'whatever' as 'blocked',
      })

      expect(modeOf(await call(getPath))[GOOGLE_DRIVE_LIST_TOOL_NAME])
        .toBe('blocked')
    })

    it('answers 404 without any reachable tool and 401 without a session',
      async () => {
        mocks.flags.clear()

        expect((await failureOf(call(getPath))).status).toBe(404)

        mocks.flags.add('google.drive')
        vi.stubGlobal('useUserSession', async () => null)

        expect((await failureOf(call(getPath))).status).toBe(401)
      })

    it('answers 404 to a non-admin when only own-client flags are on',
      async () => {
        mocks.flags = new Set(['google.byo', 'google.gmail'])

        expect((await failureOf(call(getPath))).status).toBe(404)
      })

    it('refuses a cross-site read', async () => {
      expect((await failureOf(call(getPath, {
        headers: { 'sec-fetch-site': 'cross-site' },
      }))).status).toBe(403)
    })
  })

  describe('PUT', () => {
    it('blocks one tool and answers with the stored list', async () => {
      const result = await put({
        tool: GOOGLE_DRIVE_LIST_TOOL_NAME,
        mode: 'blocked',
      })

      expect(modeOf(result)[GOOGLE_DRIVE_LIST_TOOL_NAME]).toBe('blocked')
      expect(modeOf(result).google__drive_read_file).toBe('ask')
      expect(await rows()).toHaveLength(1)
      expect(modeOf(await call(getPath))[GOOGLE_DRIVE_LIST_TOOL_NAME])
        .toBe('blocked')
    })

    it('deletes the row when a tool is set back to "ask"', async () => {
      await put({ tool: GOOGLE_DRIVE_LIST_TOOL_NAME, mode: 'blocked' })

      const result = await put({
        tool: GOOGLE_DRIVE_LIST_TOOL_NAME,
        mode: 'ask',
      })

      expect(modeOf(result)[GOOGLE_DRIVE_LIST_TOOL_NAME]).toBe('ask')
      expect(await rows()).toHaveLength(0)
    })

    it('stores nothing for "ask" on a tool with no row', async () => {
      await put({ tool: GOOGLE_DRIVE_LIST_TOOL_NAME, mode: 'ask' })

      expect(await rows()).toHaveLength(0)
    })

    it('blocks every reachable tool of a service', async () => {
      const result = await put({ service: 'drive', mode: 'blocked' })

      expect(Object.values(modeOf(result))).toEqual([
        'blocked',
        'blocked',
        'blocked',
      ])
      expect((await rows()).map(row => row.toolName).sort()).toEqual([
        'google__drive_list_picked',
        'google__drive_read_file',
        'google__drive_save_file',
      ])
    })

    it('sets only the tools of one kind of a service in one request',
      async () => {
        const result = await put({
          service: 'drive',
          kind: 'read',
          mode: 'blocked',
        })

        expect(modeOf(result)).toEqual({
          google__drive_list_picked: 'blocked',
          google__drive_read_file: 'blocked',
          google__drive_save_file: 'ask',
        })
        expect((await rows()).map(row => row.toolName).sort()).toEqual([
          'google__drive_list_picked',
          'google__drive_read_file',
        ])
        expect(mocks.logged).toContainEqual({
          attributes: {
            google: {
              toolPermission: {
                action: 'set',
                scope: 'kind',
                target: 'drive:read',
                mode: 'blocked',
                changed: 2,
                unchanged: 0,
              },
            },
          },
        })
      })

    it('answers 404 for a kind whose service the user cannot reach and '
      + '400 for an unknown kind or a kind with a tool', async () => {
      expect((await failureOf(put({
        service: 'gmail',
        kind: 'read',
        mode: 'blocked',
      }))).status).toBe(404)

      for (const body of [
        { service: 'drive', kind: 'admin', mode: 'blocked' },
        {
          tool: GOOGLE_DRIVE_LIST_TOOL_NAME,
          service: 'drive',
          kind: 'read',
          mode: 'blocked',
        },
        { kind: 'read', mode: 'blocked' },
      ]) {
        expect((await failureOf(put(body))).status).toBe(400)
      }

      expect(await rows()).toHaveLength(0)
    })

    it('sets the own-client Drive tools of an admin with the service',
      async () => {
        mocks.isAdmin = true
        mocks.flags = new Set(['google.drive', 'google.byo'])

        await put({ service: 'drive', mode: 'blocked' })

        expect(await rows()).toHaveLength(10)
      })

    it('answers 400 for an unknown mode and a missing mode', async () => {
      for (const body of [
        { tool: GOOGLE_DRIVE_LIST_TOOL_NAME, mode: 'maybe' },
        { tool: GOOGLE_DRIVE_LIST_TOOL_NAME },
        { mode: 'ask' },
        null,
      ]) {
        expect((await failureOf(put(body))).status).toBe(400)
      }

      expect(await rows()).toHaveLength(0)
    })

    describe('Always allow', () => {
      const ownClientFlags = [
        'google.drive',
        'google.byo',
        'google.gmail',
        'google.calendar',
      ]

      beforeEach(() => {
        mocks.isAdmin = true
        mocks.flags = new Set(ownClientFlags)
      })

      it('stores "allow" for one own-client tool and reads it back',
        async () => {
          const result = await put({
            tool: GOOGLE_GMAIL_SEARCH_TOOL_NAME,
            mode: 'allow',
          })

          expect(modeOf(result)[GOOGLE_GMAIL_SEARCH_TOOL_NAME]).toBe('allow')
          expect(result.unchanged).toEqual([])
          expect((await rows()).map(row => [row.toolName, row.mode])).toEqual([
            [GOOGLE_GMAIL_SEARCH_TOOL_NAME, 'allow'],
          ])
          expect(modeOf(await call(getPath))[GOOGLE_GMAIL_SEARCH_TOOL_NAME])
            .toBe('allow')
        })

      it('answers 400 for "allow" on a tool of Besidka\'s client and stores '
        + 'nothing', async () => {
        for (const tool of [
          GOOGLE_DRIVE_LIST_TOOL_NAME,
          'google__drive_read_file',
          'google__drive_save_file',
        ]) {
          expect((await failureOf(put({ tool, mode: 'allow' }))).status)
            .toBe(400)
        }

        expect(await rows()).toHaveLength(0)
      })

      it('does not count the 400 for a non-allowable tool against the rate '
        + 'limit', async () => {
        await failureOf(put({
          tool: GOOGLE_DRIVE_LIST_TOOL_NAME,
          mode: 'allow',
        }))

        expect(kv.put).not.toHaveBeenCalled()
      })

      it('applies "allow" to the own-client members of a service group and '
        + 'leaves the rest unchanged, and says which', async () => {
        await put({ tool: GOOGLE_DRIVE_LIST_TOOL_NAME, mode: 'blocked' })

        const result = await put({ service: 'drive', mode: 'allow' })

        expect(modeOf(result)).toMatchObject({
          [GOOGLE_DRIVE_LIST_TOOL_NAME]: 'blocked',
          google__drive_read_file: 'ask',
          google__drive_save_file: 'ask',
          google__drive_search: 'allow',
          google__drive_read_found_file: 'allow',
          google__drive_list_folder: 'allow',
          google__drive_create_folder: 'allow',
          google__drive_create_file: 'allow',
          google__drive_rename: 'allow',
          google__drive_move: 'allow',
        })
        expect(result.unchanged.sort()).toEqual([
          GOOGLE_DRIVE_LIST_TOOL_NAME,
          'google__drive_read_file',
          'google__drive_save_file',
        ])
        expect((await rows()).map(row => row.mode).sort()).toEqual([
          'allow',
          'allow',
          'allow',
          'allow',
          'allow',
          'allow',
          'allow',
          'blocked',
        ])
      })

      it('applies "allow" to the read or write tools of a service only',
        async () => {
          const result = await put({
            service: 'gmail',
            kind: 'write',
            mode: 'allow',
          })

          expect(modeOf(result)).toMatchObject({
            google__gmail_search: 'ask',
            google__gmail_read_thread: 'ask',
            google__gmail_create_draft: 'allow',
          })
          expect(result.unchanged).toEqual([])
        })

      it('answers 400 for a group with no tool that can be always allowed',
        async () => {
          mocks.flags = new Set(['google.drive'])
          mocks.isAdmin = false

          for (const body of [
            { service: 'drive', mode: 'allow' },
            { service: 'drive', kind: 'read', mode: 'allow' },
            { service: 'drive', kind: 'write', mode: 'allow' },
          ]) {
            expect((await failureOf(put(body))).status).toBe(400)
          }

          expect(await rows()).toHaveLength(0)
        })

      it('lets "ask" and "blocked" apply to every tool of a group, and '
        + 'reports none unchanged', async () => {
        await put({ service: 'drive', mode: 'allow' })

        const asked = await put({ service: 'drive', mode: 'ask' })

        expect(asked.unchanged).toEqual([])
        expect(await rows()).toHaveLength(0)

        const blocked = await put({ service: 'drive', mode: 'blocked' })

        expect(blocked.unchanged).toEqual([])
        expect(await rows()).toHaveLength(10)
      })

      it('turns "allow" back to "ask" by deleting the row', async () => {
        await put({ tool: 'google__calendar_create_event', mode: 'allow' })
        await put({ tool: 'google__calendar_create_event', mode: 'ask' })

        expect(await rows()).toHaveLength(0)
      })

      it('answers 404 to a non-admin even with the flags on', async () => {
        mocks.isAdmin = false

        expect((await failureOf(put({
          tool: GOOGLE_GMAIL_SEARCH_TOOL_NAME,
          mode: 'allow',
        }))).status).toBe(404)
        expect(await rows()).toHaveLength(0)
      })

      it('answers 404 for a service whose flag is off', async () => {
        mocks.flags = new Set(['google.drive', 'google.byo'])

        expect((await failureOf(put({
          tool: 'google__calendar_create_event',
          mode: 'allow',
        }))).status).toBe(404)
      })

      it('keeps the strict body: an extra field is a 400', async () => {
        expect((await failureOf(put({
          tool: GOOGLE_GMAIL_SEARCH_TOOL_NAME,
          mode: 'allow',
          confirm: true,
        }))).status).toBe(400)
        expect(await rows()).toHaveLength(0)
      })

      it('limits "allow" writes to 60 a minute for one target', async () => {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          await put({ tool: GOOGLE_GMAIL_SEARCH_TOOL_NAME, mode: 'allow' })
        }

        expect((await failureOf(put({
          tool: GOOGLE_GMAIL_SEARCH_TOOL_NAME,
          mode: 'allow',
        }))).status).toBe(429)
      })

      it('logs the mode, the counts and no tool content', async () => {
        await put({ service: 'drive', mode: 'allow' })

        expect(mocks.logged).toContainEqual({
          attributes: {
            google: {
              toolPermission: {
                action: 'set',
                scope: 'service',
                target: 'drive',
                mode: 'allow',
                changed: 7,
                unchanged: 3,
              },
            },
          },
        })
      })
    })

    it('answers 400 for an unknown tool or service, a Besidka tool name and '
      + 'a body with both fields', async () => {
      for (const body of [
        { tool: 'nope', mode: 'ask' },
        { tool: 'google__nope', mode: 'ask' },
        { tool: 'list_files', mode: 'blocked' },
        { tool: 'besidka__list_files', mode: 'blocked' },
        { tool: GOOGLE_DRIVE_LIST_TOOL_NAME, service: 'drive', mode: 'ask' },
        { service: 'sheets', mode: 'ask' },
        { tool: 'x'.repeat(65), mode: 'ask' },
      ]) {
        expect((await failureOf(put(body))).status).toBe(400)
      }

      expect(await rows()).toHaveLength(0)
    })

    it('answers 413 to a body over 1 KiB', async () => {
      const failure = await failureOf(put(
        { tool: GOOGLE_DRIVE_LIST_TOOL_NAME, mode: 'ask' },
        { headers: { 'content-length': '2100' } },
      ))

      expect(failure.status).toBe(413)
      expect(await rows()).toHaveLength(0)
    })

    it('answers 404 for a tool the user cannot reach', async () => {
      expect((await failureOf(put({
        tool: GOOGLE_GMAIL_SEARCH_TOOL_NAME,
        mode: 'blocked',
      }))).status).toBe(404)
      expect((await failureOf(put({
        service: 'gmail',
        mode: 'blocked',
      }))).status).toBe(404)

      mocks.isAdmin = true
      mocks.flags = new Set(['google.drive', 'google.byo'])

      expect((await failureOf(put({
        tool: GOOGLE_GMAIL_SEARCH_TOOL_NAME,
        mode: 'blocked',
      }))).status).toBe(404)
      expect(await rows()).toHaveLength(0)
    })

    it('answers 404 when the feature is off for the user', async () => {
      mocks.flags.clear()

      expect((await failureOf(put({
        tool: GOOGLE_DRIVE_LIST_TOOL_NAME,
        mode: 'blocked',
      }))).status).toBe(404)
    })

    it('answers 404 to a non-admin for an own-client tool even with flags on',
      async () => {
        mocks.flags = new Set(['google.drive', 'google.byo', 'google.gmail'])

        expect((await failureOf(put({
          tool: GOOGLE_GMAIL_SEARCH_TOOL_NAME,
          mode: 'blocked',
        }))).status).toBe(404)
      })

    it('needs a session and the same origin', async () => {
      const body = { tool: GOOGLE_DRIVE_LIST_TOOL_NAME, mode: 'blocked' }

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
      expect(await rows()).toHaveLength(0)
    })

    it('runs the same-origin guard before the session check', async () => {
      vi.stubGlobal('useUserSession', async () => null)

      expect((await failureOf(put(
        { tool: GOOGLE_DRIVE_LIST_TOOL_NAME, mode: 'blocked' },
        { headers: { 'sec-fetch-site': 'cross-site' } },
      ))).status).toBe(403)
    })

    it('isolates users from each other', async () => {
      const otherUserId = await seedUser(testDb.db, null)

      await put({ tool: GOOGLE_DRIVE_LIST_TOOL_NAME, mode: 'blocked' })

      sessionUserId = otherUserId

      expect(modeOf(await call(getPath))[GOOGLE_DRIVE_LIST_TOOL_NAME])
        .toBe('ask')

      await put({ tool: GOOGLE_DRIVE_LIST_TOOL_NAME, mode: 'ask' })

      sessionUserId = userId

      expect(modeOf(await call(getPath))[GOOGLE_DRIVE_LIST_TOOL_NAME])
        .toBe('blocked')
    })

    it('logs the action, target and mode only', async () => {
      await put({ tool: GOOGLE_DRIVE_LIST_TOOL_NAME, mode: 'blocked' })

      const logged = JSON.stringify(mocks.logged)

      expect(logged).toContain(GOOGLE_DRIVE_LIST_TOOL_NAME)
      expect(logged).toContain('"mode":"blocked"')
      expect(logged).not.toContain('@')
    })

    it('limits writes to 60 a minute', async () => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await put({ tool: GOOGLE_DRIVE_LIST_TOOL_NAME, mode: 'ask' })
      }

      expect((await failureOf(put({
        tool: GOOGLE_DRIVE_LIST_TOOL_NAME,
        mode: 'ask',
      }))).status).toBe(429)
    })

    it('counts each target on its own KV key, so two quick changes of '
      + 'different targets never share one', async () => {
      await put({ tool: GOOGLE_DRIVE_LIST_TOOL_NAME, mode: 'blocked' })
      await put({ service: 'drive', mode: 'ask' })
      await put({ service: 'drive', kind: 'read', mode: 'blocked' })
      await put({ tool: GOOGLE_DRIVE_LIST_TOOL_NAME, mode: 'ask' })

      const keys = kv.put.mock.calls.map(([key]) => key)

      expect(keys).toEqual([
        `google-tool-permission-rate-limit:${userId}:tool:`
        + GOOGLE_DRIVE_LIST_TOOL_NAME,
        `google-tool-permission-rate-limit:${userId}:service:drive`,
        `google-tool-permission-rate-limit:${userId}:kind:drive:read`,
        `google-tool-permission-rate-limit:${userId}:tool:`
        + GOOGLE_DRIVE_LIST_TOOL_NAME,
      ])
    })

    it('limits one target at 60 a minute without limiting another',
      async () => {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          await put({ tool: GOOGLE_DRIVE_LIST_TOOL_NAME, mode: 'ask' })
        }

        await put({ service: 'drive', mode: 'ask' })

        expect((await failureOf(put({
          tool: GOOGLE_DRIVE_LIST_TOOL_NAME,
          mode: 'blocked',
        }))).status).toBe(429)
      })

    it('does not count a name outside the catalog', async () => {
      expect((await failureOf(put({ tool: 'x'.repeat(40), mode: 'ask' })))
        .status).toBe(400)
      expect(kv.put).not.toHaveBeenCalled()
    })

    it('fails closed with a 429 when KV cannot count', async () => {
      vi.stubGlobal('useKV', () => {
        throw new Error('KV down')
      })

      expect((await failureOf(put({
        tool: GOOGLE_DRIVE_LIST_TOOL_NAME,
        mode: 'blocked',
      }))).status).toBe(429)
      expect(await rows()).toHaveLength(0)
    })
  })
})

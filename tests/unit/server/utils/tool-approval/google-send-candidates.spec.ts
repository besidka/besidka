import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import { GOOGLE_TOOL_CATALOG } from '#shared/utils/google-tool-catalog'
import type { GoogleService } from '#shared/utils/google-tool-catalog'
import * as schema from '~~/server/db/schema'
import { buildGoogleApprovalEntry } from '~~/server/utils/tool-approval/send'
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

const mocks = vi.hoisted(() => ({
  connections: {} as Record<string, unknown>,
  byoVerdict: 'allowed' as string,
  chatSettings: {
    grantHashes: {} as Record<string, string>,
    servicesOff: [] as string[],
  },
  chatSettingsReads: 0,
}))

vi.mock('~~/server/utils/google/store', async (importOriginal) => {
  return {
    ...await importOriginal<typeof import('~~/server/utils/google/store')>(),
    readGoogleConnection: async (
      _db: unknown,
      _userId: number,
      clientMode: string,
    ) => mocks.connections[clientMode] ?? null,
  }
})

vi.mock('~~/server/utils/google/byo-access', () => ({
  checkGoogleByoAccess: async () => mocks.byoVerdict,
}))

vi.mock('~~/server/utils/tool-approval/google', async (importOriginal) => {
  return {
    ...await importOriginal<
      typeof import('~~/server/utils/tool-approval/google')
    >(),
    readGoogleChatSettings: async () => {
      mocks.chatSettingsReads += 1

      return mocks.chatSettings
    },
  }
})

function fakeBuilt(
  predicate: (tool: typeof GOOGLE_TOOL_CATALOG[number]) => boolean,
) {
  const catalogTools = GOOGLE_TOOL_CATALOG.filter(predicate)

  return {
    tools: Object.fromEntries(catalogTools.map((tool) => {
      return [tool.name, { execute: vi.fn() }]
    })),
    entries: new Map(catalogTools.map((tool) => {
      return [tool.name, buildGoogleApprovalEntry({
        toolName: tool.name,
        kind: tool.kind,
        definitionHash: 'h'.repeat(64),
        summary: tool.title,
        toolApprovalsActive: true,
      })]
    })),
  }
}

vi.mock('~~/server/utils/google/drive-tools', () => ({
  buildGoogleDriveTools: async () => {
    return fakeBuilt(tool => tool.client === 'besidka')
  },
}))

vi.mock('~~/server/utils/google/byo-tools', () => ({
  buildGoogleByoTools: async () => {
    return fakeBuilt((tool) => {
      return tool.client === 'byo' && tool.service !== 'calendar'
    })
  },
}))

vi.mock('~~/server/utils/google/calendar-tools', () => ({
  buildGoogleCalendarTools: async () => {
    return fakeBuilt(tool => tool.service === 'calendar')
  },
}))

const {
  buildGoogleSendToolCandidates,
  dropBlockedGoogleTools,
  withGoogleServicesOffBlocked,
} = await import('~~/server/utils/tool-approval/google-send-candidates')
const { getGoogleSendTools, planGoogleSendTools } = await import(
  '~~/server/utils/tool-approval/google-send-tools'
)
const {
  loadGoogleToolPermissionModes,
  resolveGoogleTargetTools,
  setGoogleToolPermissions,
} = await import('~~/server/utils/google/tool-permissions')

const ALL_BYO_SCOPES = Object.values(GOOGLE_SCOPES)

function logger() {
  return { set: vi.fn(), warn: vi.fn() }
}

describe('Google send candidates and Blocked tools', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  async function block(toolNames: readonly string[]) {
    for (const toolName of toolNames) {
      await setGoogleToolPermissions(
        userId,
        resolveGoogleTargetTools({ tool: toolName }),
        'blocked',
        testDb.db,
      )
    }
  }

  function candidates(overrides: Partial<
    Parameters<typeof buildGoogleSendToolCandidates>[0]
  > = {}) {
    return buildGoogleSendToolCandidates({
      userId,
      chatPublicId: 'chat-1',
      driveActive: true,
      byoActive: true,
      gmailActive: true,
      calendarActive: true,
      logger: logger(),
      ...overrides,
    })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    mocks.byoVerdict = 'allowed'
    mocks.chatSettings = { grantHashes: {}, servicesOff: [] }
    mocks.chatSettingsReads = 0
    mocks.connections = {
      besidka: {
        status: 'active',
        grantedScopes: [GOOGLE_SCOPES.driveFile],
        googleEmail: null,
      },
      byo: {
        status: 'active',
        grantedScopes: ALL_BYO_SCOPES,
        googleEmail: null,
      },
    }
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => ({}))
    vi.stubGlobal('useEvent', () => ({ context: {} }))
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('offers every tool and keeps no Blocked entry when nothing is blocked',
    async () => {
      const google = await candidates()

      expect(Object.keys(google.tools).sort()).toEqual(
        GOOGLE_TOOL_CATALOG.map(tool => tool.name).sort(),
      )
      expect([...google.entries.values()].some((entry) => {
        return entry.permissionMode === 'blocked'
      })).toBe(false)
      expect(google.permissionModes?.size).toBe(0)
    })

  it('does not offer a Blocked Gmail search and keeps the other Gmail tools',
    async () => {
      await block(['google__gmail_search'])

      const google = await candidates()

      expect(Object.keys(google.tools)).not.toContain('google__gmail_search')
      expect(Object.keys(google.tools)).toContain('google__gmail_read_thread')
      expect(Object.keys(google.tools)).toContain('google__gmail_create_draft')
    })

  it('keeps an entry-only Blocked record for each dropped tool', async () => {
    await block(['google__gmail_search', 'google__calendar_create_event'])

    const google = await candidates()
    const search = google.entries.get('google__gmail_search')
    const createEvent = google.entries.get('google__calendar_create_event')

    expect(search).toMatchObject({
      permissionMode: 'blocked',
      descriptor: {
        family: 'google',
        access: 'read',
        toolName: 'google__gmail_search',
        destructiveHint: false,
      },
    })
    expect(createEvent).toMatchObject({
      permissionMode: 'blocked',
      descriptor: { family: 'google', access: 'write', destructiveHint: true },
    })
    expect(Object.keys(google.tools)).not.toContain(
      'google__calendar_create_event',
    )
    expect(google.permissionModes?.get('google__gmail_search'))
      .toBe('blocked')
  })

  it('reads a stored "allow" as Blocked', async () => {
    await testDb.db.insert(schema.besidkaToolPermissions).values({
      userId,
      toolName: 'google__gmail_search',
      mode: 'allow',
    })

    const google = await candidates()

    expect(Object.keys(google.tools)).not.toContain('google__gmail_search')
  })

  it('leaves the service filter alone: a service whose flag is off stays '
    + 'out, Blocked or not', async () => {
    await block(['google__calendar_list_events'])

    const google = await candidates({ calendarActive: false })

    expect(Object.keys(google.tools).some((name) => {
      return name.includes('calendar')
    })).toBe(false)
    expect(google.entries.has('google__calendar_list_events')).toBe(false)
  })

  it('does not widen what the connection grants: no connection, no tool, '
    + 'no Blocked entry', async () => {
    mocks.connections = {}
    await block(['google__gmail_search'])

    const google = await candidates()

    expect(google.tools).toEqual({})
    expect(google.entries.size).toBe(0)
  })

  it('never reads another user\'s Blocks', async () => {
    const otherUserId = await seedUser(testDb.db, null)

    await setGoogleToolPermissions(
      otherUserId,
      resolveGoogleTargetTools({ tool: 'google__gmail_search' }),
      'blocked',
      testDb.db,
    )

    expect(Object.keys((await candidates()).tools))
      .toContain('google__gmail_search')
  })

  it('fails closed when the permission rows cannot be read', async () => {
    const failing = {
      select: () => {
        throw new Error('D1 down')
      },
    }

    vi.stubGlobal('useDb', () => ({ ...testDb.db, select: failing.select }))

    const sendLogger = logger()
    const google = await candidates({ logger: sendLogger })

    expect(google.tools).toEqual({})
    expect(google.entries.size).toBeGreaterThan(0)
    expect([...google.entries.values()].every((entry) => {
      return entry.permissionMode === 'blocked'
    })).toBe(true)
  })

  describe('through getGoogleSendTools', () => {
    function plan(google: Awaited<ReturnType<typeof candidates>>) {
      return { candidates: google, gatewaySafeguards: false }
    }

    it('registers no tool but keeps the Blocked entries when every tool is '
      + 'Blocked, with no withheld reason', async () => {
      await block(
        GOOGLE_TOOL_CATALOG
          .filter(tool => tool.client === 'byo' && tool.service !== 'calendar')
          .map(tool => tool.name),
      )

      const google = await candidates({
        driveActive: false,
        calendarActive: false,
      })
      const mayReceiveGoogleData = vi.fn(async () => false)
      const decision = await getGoogleSendTools({
        plan: plan(google),
        mayReceiveGoogleData,
        providerToolsStayCallable: true,
        holdsGoogleData: false,
        logger: logger(),
      })

      expect(Object.keys(decision.tools).filter((name) => {
        return name.includes('gmail')
      })).toEqual([])
      expect(decision.withheldReason).toBeNull()
      expect(mayReceiveGoogleData).not.toHaveBeenCalled()
      expect(decision.entries.get('google__gmail_search')?.permissionMode)
        .toBe('blocked')
    })

    it('still withholds the remaining tools for the same reasons as before',
      async () => {
        await block(['google__gmail_search'])

        const decision = await getGoogleSendTools({
          plan: plan(await candidates()),
          mayReceiveGoogleData: async () => false,
          logger: logger(),
        })

        expect(decision.tools).toEqual({})
        expect(decision.withheldReason)
          .toBe('model_may_not_receive_google_data')
      })

    it('keeps the unremovable-provider-tool reason while one tool is left',
      async () => {
        await block(['google__gmail_search'])

        const decision = await getGoogleSendTools({
          plan: plan(await candidates()),
          mayReceiveGoogleData: async () => true,
          providerToolsStayCallable: true,
          holdsGoogleData: false,
          logger: logger(),
        })

        expect(decision.withheldReason).toBe('provider_tool_not_removable')
      })
  })

  describe('dropBlockedGoogleTools', () => {
    it('only removes tools and never adds one', async () => {
      const built = fakeBuilt(tool => tool.service === 'gmail')
      const modes = new Map<string, 'blocked' | 'ask'>([
        ['google__gmail_search', 'blocked'],
        ['google__drive_search', 'blocked'],
      ])
      const result = dropBlockedGoogleTools(built, modes)

      expect(Object.keys(result.tools).sort()).toEqual([
        'google__gmail_create_draft',
        'google__gmail_read_thread',
      ])
      expect(result.entries.has('google__drive_search')).toBe(false)
      expect(result.entries.size).toBe(3)
    })

    it('keeps the stored modes of every service', async () => {
      await block(['google__gmail_search'])

      const modes = await loadGoogleToolPermissionModes(userId, testDb.db)

      for (const service of ['drive', 'gmail', 'calendar'] as GoogleService[]) {
        expect(dropBlockedGoogleTools(
          fakeBuilt(tool => tool.service === service),
          modes,
        ).permissionModes).toBe(modes)
      }
    })
  })

  describe('a service switched off in the chat', () => {
    function namesOf(service: GoogleService) {
      return GOOGLE_TOOL_CATALOG
        .filter(tool => tool.service === service)
        .map(tool => tool.name)
    }

    it.each(['drive', 'gmail', 'calendar'] as GoogleService[])(
      'offers no %s tool and keeps the other services',
      async (service) => {
        mocks.chatSettings = { grantHashes: {}, servicesOff: [service] }

        const google = await candidates()
        const offered = Object.keys(google.tools)

        for (const toolName of namesOf(service)) {
          expect(offered).not.toContain(toolName)
        }

        for (const tool of GOOGLE_TOOL_CATALOG) {
          if (tool.service !== service) {
            expect(offered).toContain(tool.name)
          }
        }
      },
    )

    it('keeps an entry-only Blocked record for every dropped tool and '
      + 'lists it as blocked for the replay', async () => {
      mocks.chatSettings = { grantHashes: {}, servicesOff: ['gmail'] }

      const google = await candidates()

      for (const toolName of namesOf('gmail')) {
        expect(google.entries.get(toolName)).toMatchObject({
          permissionMode: 'blocked',
          descriptor: { family: 'google', toolName },
        })
        expect(google.permissionModes?.get(toolName)).toBe('blocked')
      }

      expect(google.entries.get('google__gmail_create_draft')?.descriptor)
        .toMatchObject({ access: 'write', destructiveHint: true })
      expect(google.permissionModes?.has('google__drive_search')).toBe(false)
    })

    it('keeps the stored Blocks of the services that stay on', async () => {
      mocks.chatSettings = { grantHashes: {}, servicesOff: ['gmail'] }
      await block(['google__calendar_create_event'])

      const google = await candidates()

      expect(google.permissionModes?.get('google__calendar_create_event'))
        .toBe('blocked')
      expect(Object.keys(google.tools)).toContain(
        'google__calendar_list_events',
      )
      expect(Object.keys(google.tools)).not.toContain(
        'google__calendar_create_event',
      )
    })

    it('offers nothing and answers no withheld reason when every service '
      + 'is off', async () => {
      mocks.chatSettings = {
        grantHashes: {},
        servicesOff: ['drive', 'gmail', 'calendar'],
      }

      const google = await candidates()
      const mayReceiveGoogleData = vi.fn(async () => false)
      const decision = await getGoogleSendTools({
        plan: { candidates: google, gatewaySafeguards: false },
        mayReceiveGoogleData,
        providerToolsStayCallable: true,
        holdsGoogleData: false,
        logger: logger(),
      })

      expect(google.tools).toEqual({})
      expect(google.entries.size).toBe(GOOGLE_TOOL_CATALOG.length)
      expect(decision.tools).toEqual({})
      expect(decision.withheldReason).toBeNull()
      expect(mayReceiveGoogleData).not.toHaveBeenCalled()
    })

    it('keeps the gateway safeguards of a flagged chat when every service '
      + 'is off: the switch removes tools only', async () => {
      const planOf = () => planGoogleSendTools({
        toolApprovalsActive: true,
        googleDriveActive: true,
        googleByoActive: true,
        googleGmailActive: true,
        googleCalendarActive: true,
        userId,
        chatPublicId: 'chat-1',
        gatewayId: 'vercel',
        holdsGoogleData: true,
        logger: logger(),
      })
      const withAllOn = await planOf()

      mocks.chatSettings = {
        grantHashes: {},
        servicesOff: ['drive', 'gmail', 'calendar'],
      }

      const withAllOff = await planOf()

      expect(withAllOn.gatewaySafeguards).toBe(true)
      expect(withAllOff.gatewaySafeguards).toBe(true)
      expect(Object.keys(withAllOn.candidates.tools).length)
        .toBeGreaterThan(0)
      expect(withAllOff.candidates.tools).toEqual({})
    })

    it('still asks the data guard for the remaining tools when only some '
      + 'services are off', async () => {
      mocks.chatSettings = { grantHashes: {}, servicesOff: ['gmail'] }

      const decision = await getGoogleSendTools({
        plan: { candidates: await candidates(), gatewaySafeguards: true },
        mayReceiveGoogleData: async () => false,
        holdsGoogleData: true,
        logger: logger(),
      })

      expect(decision.withheldReason)
        .toBe('model_may_not_receive_google_data')
    })

    it('reads the chat row once for the grants and the switches', async () => {
      mocks.chatSettings = { grantHashes: {}, servicesOff: ['calendar'] }

      await candidates()

      expect(mocks.chatSettingsReads).toBe(1)
    })

    it('lets an explicit servicesOff win over the stored ones', async () => {
      mocks.chatSettings = { grantHashes: {}, servicesOff: ['gmail'] }

      const google = await candidates({ servicesOff: ['calendar'] })
      const offered = Object.keys(google.tools)

      expect(offered).toContain('google__gmail_search')
      expect(offered).not.toContain('google__calendar_list_events')
    })

    it('does not widen what the connection grants: no connection, no '
      + 'Blocked entry', async () => {
      mocks.connections = {}
      mocks.chatSettings = { grantHashes: {}, servicesOff: ['gmail'] }

      const google = await candidates()

      expect(google.tools).toEqual({})
      expect(google.entries.size).toBe(0)
    })

    it('blocks a tool name the catalog does not know', async () => {
      const merged = withGoogleServicesOffBlocked(
        new Map(),
        [],
        ['google__gmail_search', 'google__made_up'],
      )

      expect(merged.get('google__made_up')).toBe('blocked')
      expect(merged.has('google__gmail_search')).toBe(false)
    })
  })
})

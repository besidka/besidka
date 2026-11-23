import * as schema from '~~/server/db/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  addBesidkaChatGrant,
  applyRequestedGoogleServicesOff,
  readBesidkaChatSettings,
  setBesidkaChatEnabled,
  setGoogleServiceEnabled,
  setGoogleServicesOff,
} = await import('~~/server/utils/besidka-tools/chat-settings')
const { applyRememberGrants } = await import(
  '~~/server/utils/tool-approval/continuation'
)
const {
  resolveBesidkaPermissionMode,
  setBesidkaToolPermissions,
} = await import('~~/server/utils/besidka-tools/permissions')
const { listChatToolApprovalGrants, resetChatToolApprovalGrants }
  = await import(
    '~~/server/utils/tool-approval/grants'
  )
const { hashBesidkaChatTool } = await import(
  '~~/server/utils/besidka-tools/chat-adapter'
)
const { getBesidkaTool } = await import(
  '~~/server/utils/besidka-tools/registry'
)

const CHAT = 'skl11'
const OTHER_CHAT = 'skl12'
const HASH = 'a'.repeat(64)

function besidkaEntry(toolName: string) {
  return {
    descriptor: {
      family: 'besidka' as const,
      access: 'read' as const,
      toolName,
      definitionHash: HASH,
      destructiveHint: false,
    },
    summary: toolName,
    taint: 'besidka' as const,
    readSource: 'besidka',

    connector: null,
  }
}

function decision(
  toolName: string,
  remember: 'once' | 'chat' | 'always',
  record: Record<string, unknown> = {},
) {
  return {
    approvalId: `approval-${toolName}`,
    toolCallId: `call-${toolName}`,
    toolName,
    approved: true,
    reason: undefined,
    remember,
    denialReason: null,
    record: record as never,
  }
}

describe('Besidka chat settings', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
  })

  it('is on with no grants for a chat without a row', async () => {
    expect(await readBesidkaChatSettings(testDb.db, userId, CHAT)).toEqual({
      enabled: true,
      alwaysAllowTools: {},
      googleServicesOff: [],
    })
  })

  it('switches one chat off and keeps its grants', async () => {
    await addBesidkaChatGrant(testDb.db, userId, CHAT, {
      toolName: 'besidka__list_files',
      definitionHash: HASH,
    })
    await setBesidkaChatEnabled(testDb.db, userId, CHAT, false)

    expect(await readBesidkaChatSettings(testDb.db, userId, CHAT)).toEqual({
      enabled: false,
      alwaysAllowTools: { besidka__list_files: HASH },
      googleServicesOff: [],
    })
    expect(await readBesidkaChatSettings(testDb.db, userId, OTHER_CHAT))
      .toMatchObject({ enabled: true })
  })

  it('stores "in this chat" and "always" answers for Besidka tools',
    async () => {
      const logger = { set: vi.fn() }

      await applyRememberGrants({
        db: testDb.db,
        userId,
        chatPublicId: CHAT,
        decisions: [
          decision('besidka__list_files', 'chat'),
          decision('besidka__get_project', 'always'),
          decision('besidka__list_projects', 'once'),
        ],
        entries: new Map([
          ['besidka__list_files', besidkaEntry('besidka__list_files')],
          ['besidka__get_project', besidkaEntry('besidka__get_project')],
          ['besidka__list_projects', besidkaEntry('besidka__list_projects')],
        ]),
        logger,
      })

      expect(await readBesidkaChatSettings(testDb.db, userId, CHAT))
        .toEqual({
          enabled: true,
          alwaysAllowTools: { besidka__list_files: HASH },
          googleServicesOff: [],
        })
      expect(await resolveBesidkaPermissionMode(userId, 'get_project', {
        db: testDb.db,
      })).toBe('allow')
      expect(await resolveBesidkaPermissionMode(userId, 'list_projects', {
        db: testDb.db,
      })).toBe('ask')
      expect(logger.set).not.toHaveBeenCalled()
    })

  it('stores the skill scripts consent for the chat on "in this chat"',
    async () => {
      const entry = {
        ...besidkaEntry('run_skill_scripts'),
        descriptor: {
          family: 'native' as const,
          access: 'write' as const,
          toolName: 'run_skill_scripts',
          definitionHash: HASH,
          destructiveHint: false,
          consentGate: true,
        },
        taint: null,
        readSource: null,
      }

      await applyRememberGrants({
        db: testDb.db,
        userId,
        chatPublicId: CHAT,
        decisions: [
          decision('run_skill_scripts', 'chat', { definitionHash: HASH }),
        ],
        entries: new Map([['run_skill_scripts', entry]]),
        logger: { set: vi.fn() },
      })

      expect(await readBesidkaChatSettings(testDb.db, userId, CHAT))
        .toEqual({
          enabled: true,
          alwaysAllowTools: { run_skill_scripts: HASH },
          googleServicesOff: [],
        })
      expect(await readBesidkaChatSettings(testDb.db, userId, OTHER_CHAT))
        .toEqual({
          enabled: true,
          alwaysAllowTools: {},
          googleServicesOff: [],
        })
    })

  it('lists the skill scripts grant in the chat panel, so it can be reset',
    async () => {
      await addBesidkaChatGrant(testDb.db, userId, CHAT, {
        toolName: 'run_skill_scripts',
        definitionHash: HASH,
      })

      expect(await listChatToolApprovalGrants(testDb.db, userId, CHAT))
        .toEqual([{
          scope: 'chat',
          connectorId: '',
          connectorTitle: 'Skill scripts',
          toolName: 'run_skill_scripts',
          source: 'besidka',
        }])
      expect(await listChatToolApprovalGrants(testDb.db, userId, OTHER_CHAT))
        .toEqual([])
    })

  it('stores no scripts grant when the approved hash is not the current one',
    async () => {
      const entry = {
        ...besidkaEntry('run_skill_scripts'),
        descriptor: {
          family: 'native' as const,
          access: 'write' as const,
          toolName: 'run_skill_scripts',
          definitionHash: 'b'.repeat(64),
          destructiveHint: false,
          consentGate: true,
        },
        taint: null,
        readSource: null,
      }

      await applyRememberGrants({
        db: testDb.db,
        userId,
        chatPublicId: CHAT,
        decisions: [
          decision('run_skill_scripts', 'chat', { definitionHash: HASH }),
        ],
        entries: new Map([['run_skill_scripts', entry]]),
        logger: { set: vi.fn() },
      })

      expect(await readBesidkaChatSettings(testDb.db, userId, CHAT))
        .toEqual({
          enabled: true,
          alwaysAllowTools: {},
          googleServicesOff: [],
        })
    })

  it('stores nothing for a once or always answer to the scripts consent',
    async () => {
      const entry = {
        ...besidkaEntry('run_skill_scripts'),
        descriptor: {
          family: 'native' as const,
          access: 'write' as const,
          toolName: 'run_skill_scripts',
          definitionHash: HASH,
          destructiveHint: false,
          consentGate: true,
        },
        taint: null,
        readSource: null,
      }

      await applyRememberGrants({
        db: testDb.db,
        userId,
        chatPublicId: CHAT,
        decisions: [
          decision('run_skill_scripts', 'once', { definitionHash: HASH }),
          decision('run_skill_scripts', 'always', { definitionHash: HASH }),
        ],
        entries: new Map([['run_skill_scripts', entry]]),
        logger: { set: vi.fn() },
      })

      expect(await readBesidkaChatSettings(testDb.db, userId, CHAT))
        .toEqual({
          enabled: true,
          alwaysAllowTools: {},
          googleServicesOff: [],
        })
      expect(await testDb.db.select().from(schema.besidkaToolPermissions))
        .toEqual([])
    })

  it('lists the Besidka grants that still apply in the chat panel',
    async () => {
      const listFiles = getBesidkaTool('list_files')

      await addBesidkaChatGrant(testDb.db, userId, CHAT, {
        toolName: 'besidka__list_files',
        definitionHash: await hashBesidkaChatTool(listFiles as never),
      })
      await addBesidkaChatGrant(testDb.db, userId, CHAT, {
        toolName: 'besidka__get_project',
        definitionHash: 'stale-hash',
      })
      await setBesidkaToolPermissions(
        userId,
        { tool: 'list_projects' },
        'allow',
        testDb.db,
      )

      expect(await listChatToolApprovalGrants(testDb.db, userId, CHAT))
        .toEqual([
          {
            scope: 'chat',
            connectorId: '',
            connectorTitle: 'Besidka',
            toolName: 'list_files',
            source: 'besidka',
          },
          {
            scope: 'always',
            connectorId: '',
            connectorTitle: 'Besidka',
            toolName: 'list_projects',
            source: 'besidka',
          },
        ])

      await setBesidkaChatEnabled(testDb.db, userId, CHAT, false)

      expect((await listChatToolApprovalGrants(testDb.db, userId, CHAT))
        .map(grant => grant.scope)).toEqual(['chat'])
    })
})

describe('remember choices for Google reads', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
  })

  function googleEntry(toolName: string) {
    return {
      descriptor: {
        family: 'google' as const,
        access: 'read' as const,
        toolName,
        definitionHash: HASH,
        destructiveHint: false,
      },
      summary: toolName,
      taint: 'google' as const,
      readSource: 'google',
      connector: null,
    }
  }

  function googleDecision(toolName: string) {
    return decision(toolName, 'chat', {
      access: 'read',
      definitionHash: HASH,
    })
  }

  it.each([
    'google__gmail_read_thread',
    'google__drive_read_found_file',
  ])('stores no chat grant for the once-only read %s', async (toolName) => {
    await applyRememberGrants({
      db: testDb.db,
      userId,
      chatPublicId: CHAT,
      decisions: [googleDecision(toolName)],
      entries: new Map([[toolName, googleEntry(toolName)]]),
      logger: { set: vi.fn() },
    })

    expect(await readBesidkaChatSettings(testDb.db, userId, CHAT)).toEqual({
      enabled: true,
      alwaysAllowTools: {},
      googleServicesOff: [],
    })
  })

  it('still stores a chat grant for a Google search', async () => {
    await applyRememberGrants({
      db: testDb.db,
      userId,
      chatPublicId: CHAT,
      decisions: [googleDecision('google__gmail_search')],
      entries: new Map([
        ['google__gmail_search', googleEntry('google__gmail_search')],
      ]),
      logger: { set: vi.fn() },
    })

    expect(await readBesidkaChatSettings(testDb.db, userId, CHAT)).toEqual({
      enabled: true,
      alwaysAllowTools: { google__gmail_search: HASH },
      googleServicesOff: [],
    })
  })
})

describe('Google services switched off in a chat', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
  })

  async function storeRawServicesOff(raw: string) {
    await testDb.db.insert(schema.besidkaChatSettings).values({
      userId,
      chatPublicId: CHAT,
      enabled: true,
      alwaysAllowTools: {},
      googleServicesOff: raw,
    })
  }

  it('reads every service on for a chat without a row', async () => {
    expect((await readBesidkaChatSettings(testDb.db, userId, CHAT))
      .googleServicesOff).toEqual([])
  })

  it('switches one service off and keeps the others', async () => {
    expect(await setGoogleServiceEnabled(
      testDb.db,
      userId,
      CHAT,
      'gmail',
      false,
    )).toEqual(['gmail'])
    expect(await setGoogleServiceEnabled(
      testDb.db,
      userId,
      CHAT,
      'drive',
      false,
    )).toEqual(['drive', 'gmail'])
    expect(await setGoogleServiceEnabled(
      testDb.db,
      userId,
      CHAT,
      'gmail',
      true,
    )).toEqual(['drive'])
    expect((await readBesidkaChatSettings(testDb.db, userId, OTHER_CHAT))
      .googleServicesOff).toEqual([])
  })

  function withChangeAfterRead(
    sabotage: (readNumber: number) => Promise<void>,
  ): typeof testDb.db {
    let readCount = 0

    function wrapBuilder(builder: any): any {
      return new Proxy(builder, {
        get(target, property) {
          if (property === 'limit') {
            return (count: number) => ({
              then: (
                resolve: (rows: unknown) => void,
                reject: (reason: unknown) => void,
              ) => {
                target.limit(count).then(async (rows: unknown) => {
                  readCount += 1
                  await sabotage(readCount)
                  resolve(rows)
                }, reject)
              },
            })
          }

          const value = Reflect.get(target, property)

          return typeof value === 'function'
            ? (...args: unknown[]) => wrapBuilder(value.apply(target, args))
            : value
        },
      })
    }

    return new Proxy(testDb.db, {
      get(target, property) {
        if (property !== 'select') {
          const value = Reflect.get(target, property)

          return typeof value === 'function' ? value.bind(target) : value
        }

        return (...args: unknown[]) => {
          return wrapBuilder((target.select as any)(...args))
        }
      },
    })
  }

  async function storedServicesOff(): Promise<string | null> {
    const [row] = await testDb.db.select({
      stored: schema.besidkaChatSettings.googleServicesOff,
    }).from(schema.besidkaChatSettings)

    return row?.stored ?? null
  }

  it('keeps a change another request lands between the read and the '
    + 'write', async () => {
    await setGoogleServicesOff(testDb.db, userId, CHAT, ['drive'])

    const racingDb = withChangeAfterRead(async (readNumber) => {
      if (readNumber === 1) {
        await setGoogleServicesOff(
          testDb.db,
          userId,
          CHAT,
          ['drive', 'calendar'],
        )
      }
    })

    expect(await setGoogleServiceEnabled(
      racingDb,
      userId,
      CHAT,
      'gmail',
      false,
    )).toEqual(['drive', 'gmail', 'calendar'])
    expect(JSON.parse(await storedServicesOff() ?? 'null'))
      .toEqual(['drive', 'gmail', 'calendar'])
  })

  it('retries from null when the row was empty at the read', async () => {
    await setGoogleServicesOff(testDb.db, userId, CHAT, [])

    const racingDb = withChangeAfterRead(async (readNumber) => {
      if (readNumber === 1) {
        await setGoogleServicesOff(testDb.db, userId, CHAT, ['calendar'])
      }
    })

    expect(await setGoogleServiceEnabled(
      racingDb,
      userId,
      CHAT,
      'drive',
      false,
    )).toEqual(['drive', 'calendar'])
  })

  it('treats an insert that loses to another insert as a lost swap',
    async () => {
      const racingDb = withChangeAfterRead(async (readNumber) => {
        if (readNumber === 1) {
          await setGoogleServicesOff(testDb.db, userId, CHAT, ['calendar'])
        }
      })

      expect(await setGoogleServiceEnabled(
        racingDb,
        userId,
        CHAT,
        'gmail',
        false,
      )).toEqual(['gmail', 'calendar'])
    })

  it('answers 409 when the swap keeps losing', async () => {
    const racingDb = withChangeAfterRead(async (readNumber) => {
      await setGoogleServicesOff(
        testDb.db,
        userId,
        CHAT,
        readNumber % 2 ? ['calendar'] : ['drive'],
      )
    })

    await expect(setGoogleServiceEnabled(
      racingDb,
      userId,
      CHAT,
      'gmail',
      false,
    )).rejects.toMatchObject({ status: 409 })
  })

  it('stores null when every service is on again', async () => {
    await setGoogleServicesOff(testDb.db, userId, CHAT, ['calendar'])
    await setGoogleServicesOff(testDb.db, userId, CHAT, [])

    const [row] = await testDb.db.select({
      stored: schema.besidkaChatSettings.googleServicesOff,
    }).from(schema.besidkaChatSettings)

    expect(row?.stored).toBeNull()
  })

  it('keeps Besidka\'s switch and grants when a service changes',
    async () => {
      await addBesidkaChatGrant(testDb.db, userId, CHAT, {
        toolName: 'besidka__list_files',
        definitionHash: HASH,
      })
      await setBesidkaChatEnabled(testDb.db, userId, CHAT, false)
      await setGoogleServiceEnabled(testDb.db, userId, CHAT, 'drive', false)

      expect(await readBesidkaChatSettings(testDb.db, userId, CHAT))
        .toEqual({
          enabled: false,
          alwaysAllowTools: { besidka__list_files: HASH },
          googleServicesOff: ['drive'],
        })
    })

  it('keeps the services when Besidka\'s switch or a grant changes',
    async () => {
      await setGoogleServicesOff(testDb.db, userId, CHAT, ['gmail'])
      await setBesidkaChatEnabled(testDb.db, userId, CHAT, false)
      await addBesidkaChatGrant(testDb.db, userId, CHAT, {
        toolName: 'besidka__list_files',
        definitionHash: HASH,
      })

      expect((await readBesidkaChatSettings(testDb.db, userId, CHAT))
        .googleServicesOff).toEqual(['gmail'])
    })

  it('creates a row with Besidka on and no grants', async () => {
    await setGoogleServicesOff(testDb.db, userId, CHAT, ['calendar'])

    expect(await readBesidkaChatSettings(testDb.db, userId, CHAT))
      .toEqual({
        enabled: true,
        alwaysAllowTools: {},
        googleServicesOff: ['calendar'],
      })
  })

  it.each([
    ['not JSON', 'drive,gmail'],
    ['an empty string', ''],
    ['an object', '{"drive":true}'],
    ['a number', '3'],
    ['a list with a non-string entry', '["drive", 1]'],
    ['a null entry', '[null]'],
  ])('reads every service off for a corrupt value (%s)', async (_label, raw) => {
    await storeRawServicesOff(raw)

    expect((await readBesidkaChatSettings(testDb.db, userId, CHAT))
      .googleServicesOff).toEqual(['drive', 'gmail', 'calendar'])
  })

  it('ignores an unknown service id in a valid list', async () => {
    await storeRawServicesOff('["gmail", "photos", "gmail"]')

    expect((await readBesidkaChatSettings(testDb.db, userId, CHAT))
      .googleServicesOff).toEqual(['gmail'])
  })

  it('reads an empty stored list as every service on', async () => {
    await storeRawServicesOff('[]')

    expect((await readBesidkaChatSettings(testDb.db, userId, CHAT))
      .googleServicesOff).toEqual([])
  })

  describe('the choice a new chat\'s first send carries', () => {
    it('reads and writes nothing without a choice', async () => {
      const failingDb = new Proxy({}, {
        get: () => {
          throw new Error('The database must not be used')
        },
      })

      expect(await applyRequestedGoogleServicesOff(
        failingDb as never,
        userId,
        CHAT,
        undefined,
        { set: vi.fn() },
      )).toBeUndefined()
    })

    it('stores a choice that differs and answers it', async () => {
      expect(await applyRequestedGoogleServicesOff(
        testDb.db,
        userId,
        CHAT,
        ['calendar', 'gmail'],
        { set: vi.fn() },
      )).toEqual(['gmail', 'calendar'])
      expect((await readBesidkaChatSettings(testDb.db, userId, CHAT))
        .googleServicesOff).toEqual(['gmail', 'calendar'])
    })

    it('stores an empty choice as every service on', async () => {
      await setGoogleServicesOff(testDb.db, userId, CHAT, ['gmail'])

      expect(await applyRequestedGoogleServicesOff(
        testDb.db,
        userId,
        CHAT,
        [],
        { set: vi.fn() },
      )).toEqual([])
      expect((await readBesidkaChatSettings(testDb.db, userId, CHAT))
        .googleServicesOff).toEqual([])
    })

    it('leaves the stored row alone when the choice is the same', async () => {
      await setGoogleServicesOff(testDb.db, userId, CHAT, ['drive'])

      const [before] = await testDb.db.select({
        updatedAt: schema.besidkaChatSettings.updatedAt,
      }).from(schema.besidkaChatSettings)

      await applyRequestedGoogleServicesOff(
        testDb.db,
        userId,
        CHAT,
        ['drive'],
        { set: vi.fn() },
      )

      const [after] = await testDb.db.select({
        updatedAt: schema.besidkaChatSettings.updatedAt,
      }).from(schema.besidkaChatSettings)

      expect(after?.updatedAt).toEqual(before?.updatedAt)
    })

    it('still answers the choice and logs when the write fails', async () => {
      const logger = { set: vi.fn() }
      const failingDb = {
        select: () => {
          throw new Error('D1 down')
        },
      }

      expect(await applyRequestedGoogleServicesOff(
        failingDb as never,
        userId,
        CHAT,
        ['gmail'],
        logger,
      )).toEqual(['gmail'])
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          googleTools: {
            servicesOffPersist: 'failed',
            error: expect.any(String),
          },
        },
      })
    })
  })

  it('does not touch the switches when the chat grants are reset',
    async () => {
      await setGoogleServicesOff(testDb.db, userId, CHAT, ['gmail', 'drive'])
      await addBesidkaChatGrant(testDb.db, userId, CHAT, {
        toolName: 'google__gmail_search',
        definitionHash: HASH,
      })

      expect(await resetChatToolApprovalGrants(testDb.db, userId, CHAT))
        .toBeGreaterThan(0)
      expect(await readBesidkaChatSettings(testDb.db, userId, CHAT))
        .toEqual({
          enabled: true,
          alwaysAllowTools: {},
          googleServicesOff: ['drive', 'gmail'],
        })
    })
})

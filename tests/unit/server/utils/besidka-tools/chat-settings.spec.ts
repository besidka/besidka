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
  readBesidkaChatSettings,
  setBesidkaChatEnabled,
} = await import('~~/server/utils/besidka-tools/chat-settings')
const { applyRememberGrants } = await import(
  '~~/server/utils/tool-approval/continuation'
)
const {
  resolveBesidkaPermissionMode,
  setBesidkaToolPermissions,
} = await import('~~/server/utils/besidka-tools/permissions')
const { listChatToolApprovalGrants } = await import(
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
    alwaysGrant: null,
    alwaysGrantWhenTainted: false,
    connector: null,
  }
}

function decision(toolName: string, remember: 'once' | 'chat' | 'always') {
  return {
    approvalId: `approval-${toolName}`,
    toolCallId: `call-${toolName}`,
    toolName,
    approved: true,
    reason: undefined,
    remember,
    denialReason: null,
    record: {} as never,
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
        decisions: [decision('run_skill_scripts', 'chat')],
        entries: new Map([['run_skill_scripts', entry]]),
        logger: { set: vi.fn() },
      })

      expect(await readBesidkaChatSettings(testDb.db, userId, CHAT))
        .toEqual({
          enabled: true,
          alwaysAllowTools: { run_skill_scripts: HASH },
        })
      expect(await readBesidkaChatSettings(testDb.db, userId, OTHER_CHAT))
        .toEqual({ enabled: true, alwaysAllowTools: {} })
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
          decision('run_skill_scripts', 'once'),
          decision('run_skill_scripts', 'always'),
        ],
        entries: new Map([['run_skill_scripts', entry]]),
        logger: { set: vi.fn() },
      })

      expect(await readBesidkaChatSettings(testDb.db, userId, CHAT))
        .toEqual({ enabled: true, alwaysAllowTools: {} })
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GOOGLE_ALWAYS_ALLOW_WRITES_PER_HOUR } from '#shared/utils/google-tool-catalog'
import { TOOL_APPROVAL_ID_PATTERN } from '#shared/utils/tool-approval-policy'
import {
  createMemoryExtractionTestDb,
  seedChat,
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

const { findClaim } = await import('~~/server/utils/tool-approval/claims')
const {
  GOOGLE_RUN_ALREADY_CLAIMED_TEXT,
  GOOGLE_RUN_HOURLY_CAP_TEXT,
  GOOGLE_RUN_UNAVAILABLE_TEXT,
  buildGoogleExecutionId,
  createGoogleRunGate,
} = await import('~~/server/utils/tool-approval/google-run-gate')

const NOW = Date.parse('2026-11-23T10:30:00.000Z')
const MESSAGE_ID = '01JABCDEFGHJKMNPQRSTVWXYZ0'

function createFakeKv(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))

  return {
    values,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value)
    }),
  }
}

describe('the run gate of a Google write that runs without asking', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let owner: { userId: number, chatPublicId: string, messagePublicId: string }
  let logger: { set: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)

    const chat = await seedChat(testDb.db, userId)

    owner = {
      userId,
      chatPublicId: chat.id,
      messagePublicId: MESSAGE_ID,
    }
    logger = { set: vi.fn() }
  })

  afterEach(() => {
    testDb.close()
  })

  function gateWith(kv: ReturnType<typeof createFakeKv>, overrides = {}) {
    return createGoogleRunGate({
      db: testDb.db,
      kv: kv as never,
      owner,
      logger: logger as never,
      now: () => NOW,
      sleep: async () => undefined,
      ...overrides,
    })
  }

  describe('buildGoogleExecutionId', () => {
    it('is deterministic and shaped like an approval id', async () => {
      const first = await buildGoogleExecutionId(owner, 'call-1')
      const second = await buildGoogleExecutionId(owner, 'call-1')

      expect(first).toBe(second)
      expect(first).toMatch(TOOL_APPROVAL_ID_PATTERN)
      expect(first.startsWith('exec_')).toBe(true)
    })

    it('differs by tool call, message, chat and user', async () => {
      const base = await buildGoogleExecutionId(owner, 'call-1')
      const ids = await Promise.all([
        buildGoogleExecutionId(owner, 'call-2'),
        buildGoogleExecutionId(
          { ...owner, messagePublicId: '01JZZZZZZZZZZZZZZZZZZZZZZZ' },
          'call-1',
        ),
        buildGoogleExecutionId({ ...owner, chatPublicId: 'other' }, 'call-1'),
        buildGoogleExecutionId({ ...owner, userId: userId + 1 }, 'call-1'),
      ])

      expect(new Set([base, ...ids]).size).toBe(5)
    })
  })

  describe('through a send', () => {
    const FOLDER = 'google__drive_create_folder'

    async function guardedFolderTool(
      kv: ReturnType<typeof createFakeKv>,
      execute: ReturnType<typeof vi.fn>,
    ) {
      const { buildGoogleApprovalEntry, createSendToolApproval }
        = await import('~~/server/utils/tool-approval/send')
      const { createApprovalState } = await import(
        '~~/server/utils/tool-approval/state'
      )
      const approval = createSendToolApproval({ state: createApprovalState() })
      const entry = {
        ...buildGoogleApprovalEntry({
          toolName: FOLDER,
          kind: 'write',
          definitionHash: 'a'.repeat(64),
          summary: 'Create a folder',
          toolApprovalsActive: true,
        }),
        permissionMode: 'allow' as const,
      }

      approval.registerTools(
        { [FOLDER]: {} } as never,
        new Map([[FOLDER, entry]]),
      )

      const tools = approval.guardNativeWrites(
        { [FOLDER]: { execute } } as never,
        gateWith(kv),
      ) as unknown as Record<string, {
        execute: (input: unknown, options?: unknown) => Promise<unknown>
      }>

      return {
        approval,
        run: async (toolCallId: string, input: unknown) => {
          approval.toolApproval({
            toolCall: { toolCallId, toolName: FOLDER, input },
          })

          return await tools[FOLDER]!.execute(input, { toolCallId })
        },
      }
    }

    it('sends nothing for a second, different write under a reused tool '
      + 'call id, and says why', async () => {
      const execute = vi.fn(async () => 'created')
      const { run } = await guardedFolderTool(createFakeKv(), execute)

      await run('call-1', { name: 'First' })

      await expect(run('call-1', { name: 'Second' })).rejects.toMatchObject({
        message: GOOGLE_RUN_ALREADY_CLAIMED_TEXT,
      })
      expect(execute).toHaveBeenCalledTimes(1)
      expect(execute).toHaveBeenCalledWith(
        { name: 'First' },
        expect.objectContaining({ executionId: expect.stringMatching(/^exec_/) }),
      )
      expect(GOOGLE_RUN_ALREADY_CLAIMED_TEXT).toBe(
        'This tool call id was already used in this message, so nothing was '
        + 'sent. If you meant to run a different action, ask again in a new '
        + 'message.',
      )
    })

    it('refuses a write at the hourly cap instead of asking, without a '
      + 'marker, and sends nothing', async () => {
      const hour = Math.floor(NOW / (60 * 60 * 1000))
      const kv = createFakeKv({
        [`google-always-allow-writes:${userId}:${hour}`]:
          String(GOOGLE_ALWAYS_ALLOW_WRITES_PER_HOUR),
      })
      const execute = vi.fn(async () => 'created')
      const { approval, run } = await guardedFolderTool(kv, execute)

      await expect(run('call-1', { name: 'Reports' })).rejects.toMatchObject({
        message: GOOGLE_RUN_HOURLY_CAP_TEXT,
      })
      expect(execute).not.toHaveBeenCalled()
      expect(approval.getPendingDecision('call-1')).toBeUndefined()
      expect(approval.getGrantScope('call-1')).toBeNull()
      expect(GOOGLE_RUN_HOURLY_CAP_TEXT).toBe(
        'Always allow has reached its limit of 30 Google write calls an '
        + 'hour, so this call did not run. Stop calling Google write tools '
        + 'now. Tell the user what is done and that the rest can continue in '
        + 'the next hour.',
      )
    })
  })

  describe('begin', () => {
    it('claims the call in the approval claims table and records the result',
      async () => {
        const run = await gateWith(createFakeKv()).begin('call-1')
        const claimed = await findClaim(testDb.db, run.executionId, userId)

        expect(run.executionId)
          .toBe(await buildGoogleExecutionId(owner, 'call-1'))
        expect(claimed).toMatchObject({
          status: 'claimed',
          userId,
          chatPublicId: owner.chatPublicId,
          messagePublicId: MESSAGE_ID,
        })

        await run.settle(false)

        expect((await findClaim(testDb.db, run.executionId, userId))?.status)
          .toBe('done')
      })

    it('records a failed write as failed', async () => {
      const run = await gateWith(createFakeKv()).begin('call-1')

      await run.settle(true)

      expect((await findClaim(testDb.db, run.executionId, userId))?.status)
        .toBe('failed')
    })

    it('refuses the same tool call the second time, with a sentence the '
      + 'model can read', async () => {
      const gate = gateWith(createFakeKv())

      await gate.begin('call-1')

      await expect(gate.begin('call-1')).rejects.toMatchObject({
        message: GOOGLE_RUN_ALREADY_CLAIMED_TEXT,
        status: 429,
      })
    })

    it('refuses a replay of the same call from a second gate, as a resumed '
      + 'stream builds one', async () => {
      await gateWith(createFakeKv()).begin('call-1')

      await expect(gateWith(createFakeKv()).begin('call-1'))
        .rejects.toMatchObject({ message: GOOGLE_RUN_ALREADY_CLAIMED_TEXT })
    })

    it('lets a different tool call run', async () => {
      const gate = gateWith(createFakeKv())
      const first = await gate.begin('call-1')
      const second = await gate.begin('call-2')

      expect(first.executionId).not.toBe(second.executionId)
    })

    it('takes one write from the hourly budget and spaces the KV writes',
      async () => {
        const kv = createFakeKv()
        const sleep = vi.fn(async () => undefined)
        const gate = gateWith(kv, { sleep })

        await gate.begin('call-1')
        await gate.begin('call-2')

        const hour = Math.floor(NOW / (60 * 60 * 1000))

        expect(kv.values.get(`google-always-allow-writes:${userId}:${hour}`))
          .toBe('2')
        expect(sleep).toHaveBeenCalledTimes(1)
        expect(sleep.mock.calls[0]![0]).toBeGreaterThan(1000)
      })

    it('counts two writes started at the same moment one after the other',
      async () => {
        const kv = createFakeKv()
        const gate = gateWith(kv)

        await Promise.all([gate.begin('call-1'), gate.begin('call-2')])

        const hour = Math.floor(NOW / (60 * 60 * 1000))

        expect(kv.values.get(`google-always-allow-writes:${userId}:${hour}`))
          .toBe('2')
        expect(kv.put).toHaveBeenCalledTimes(2)
      })

    it('refuses once the hourly budget is spent and fails the claim',
      async () => {
        const hour = Math.floor(NOW / (60 * 60 * 1000))
        const kv = createFakeKv({
          [`google-always-allow-writes:${userId}:${hour}`]:
            String(GOOGLE_ALWAYS_ALLOW_WRITES_PER_HOUR),
        })

        await expect(gateWith(kv).begin('call-1')).rejects.toMatchObject({
          message: GOOGLE_RUN_HOURLY_CAP_TEXT,
          status: 429,
        })
        expect(kv.put).not.toHaveBeenCalled()
        expect((await findClaim(
          testDb.db,
          await buildGoogleExecutionId(owner, 'call-1'),
          userId,
        ))?.status).toBe('failed')
      })

    it('counts a new clock hour from zero', async () => {
      const hour = Math.floor(NOW / (60 * 60 * 1000))
      const kv = createFakeKv({
        [`google-always-allow-writes:${userId}:${hour - 1}`]:
          String(GOOGLE_ALWAYS_ALLOW_WRITES_PER_HOUR),
      })

      await expect(gateWith(kv).begin('call-1')).resolves.toBeDefined()
    })

    it('counts each user on their own', async () => {
      const hour = Math.floor(NOW / (60 * 60 * 1000))
      const kv = createFakeKv({
        [`google-always-allow-writes:${userId + 1}:${hour}`]:
          String(GOOGLE_ALWAYS_ALLOW_WRITES_PER_HOUR),
      })

      await expect(gateWith(kv).begin('call-1')).resolves.toBeDefined()
    })

    it('fails closed when KV cannot count', async () => {
      const kv = createFakeKv()

      kv.get.mockRejectedValueOnce(new Error('kv down'))

      await expect(gateWith(kv).begin('call-1')).rejects.toMatchObject({
        message: GOOGLE_RUN_UNAVAILABLE_TEXT,
      })
      expect((await findClaim(
        testDb.db,
        await buildGoogleExecutionId(owner, 'call-1'),
        userId,
      ))?.status).toBe('failed')
    })
  })
})

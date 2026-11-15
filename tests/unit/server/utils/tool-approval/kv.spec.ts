import { describe, expect, it, vi } from 'vitest'
import {
  deleteToolApproval,
  deleteToolApprovalResult,
  deleteToolApprovalTurn,
  getToolApproval,
  getToolApprovalResult,
  getToolApprovalTurn,
  isWellFormedToolApprovalId,
  putToolApproval,
  putToolApprovalResult,
  putToolApprovalTurn,
  toolApprovalKey,
  toolApprovalResultKey,
  toolApprovalTurnKey,
} from '~~/server/utils/tool-approval/kv'
import type {
  ToolApprovalPendingRecord,
  ToolApprovalResultRecord,
  ToolApprovalTurnRecord,
} from '~~/server/utils/tool-approval/kv'
import {
  createApprovalState,
  recordRead,
  recordTaint,
  serializeApprovalState,
} from '~~/server/utils/tool-approval/state'
import { TOOL_APPROVAL_TTL_SECONDS } from '#shared/utils/tool-approval-policy'

function createFakeKv() {
  const values = new Map<string, string>()
  const put = vi.fn(async (
    key: string,
    value: string,
    _options?: { expirationTtl?: number },
  ) => {
    values.set(key, value)
  })

  return {
    values,
    put,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    delete: vi.fn(async (key: string) => {
      values.delete(key)
    }),
  }
}

const APPROVAL_ID = 'approval_abc123'

function pendingRecord(
  overrides: Partial<ToolApprovalPendingRecord> = {},
): ToolApprovalPendingRecord {
  return {
    version: 1,
    userId: 7,
    chatPublicId: 'chat123',
    messagePublicId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    toolCallId: 'call_1',
    family: 'connector',
    toolName: 'mcp__notion__create_page',
    connectorId: 'conn1',
    definitionHash: 'a'.repeat(64),
    input: { title: 'Plan', nested: { items: [1, 2] } },
    signature: 'sig-value',
    reason: 'default',
    summary: 'Create the page "Plan"',
    snapshot: {
      model: 'claude-haiku-4-5',
      gateway: null,
      reasoning: 'off',
      toolNames: ['mcp__notion__create_page'],
      connectorIds: ['conn1'],
    },
    ...overrides,
  }
}

function turnRecord(): ToolApprovalTurnRecord {
  const state = createApprovalState()

  recordTaint(state, 'web')
  recordRead(state, 'besidka')

  return {
    version: 1,
    userId: 7,
    chatPublicId: 'chat123',
    messagePublicId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    pendingApprovalIds: [APPROVAL_ID],
    state: serializeApprovalState(state),
  }
}

function resultRecord(): ToolApprovalResultRecord {
  return {
    version: 1,
    userId: 7,
    chatPublicId: 'chat123',
    messagePublicId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    toolCallId: 'call_1',
    isError: false,
    output: { ok: true },
    recordedAt: 1_700_000_000_000,
  }
}

describe('tool approval KV keys', () => {
  it('names the three keys apart', () => {
    expect(toolApprovalKey(APPROVAL_ID)).toBe(`tool-approval:${APPROVAL_ID}`)
    expect(toolApprovalTurnKey('msg123'))
      .toBe('tool-approval:turn:msg123')
    expect(toolApprovalResultKey(APPROVAL_ID))
      .toBe(`tool-approval:result:${APPROVAL_ID}`)
  })

  it.each([
    'turn:abcdefgh',
    'result:abcdefgh',
    'a:b',
    'short',
    '',
    'has space here',
    'x'.repeat(129),
    '../escape-path',
  ])('refuses the approval id %j', (approvalId) => {
    expect(isWellFormedToolApprovalId(approvalId)).toBe(false)
    expect(() => toolApprovalKey(approvalId)).toThrow()
  })

  it('refuses a message id with a colon', () => {
    expect(() => toolApprovalTurnKey('turn:other')).toThrow()
  })

  it('never lets an approval id reach another key family', () => {
    const forged = 'turn:' + 'x'.repeat(10)

    expect(isWellFormedToolApprovalId(forged)).toBe(false)
  })
})

describe('pending approval records', () => {
  it('round-trips with a 24 hour TTL', async () => {
    const kv = createFakeKv()
    const record = pendingRecord()

    await putToolApproval(kv as never, APPROVAL_ID, record)

    expect(kv.put).toHaveBeenCalledWith(
      `tool-approval:${APPROVAL_ID}`,
      expect.any(String),
      { expirationTtl: TOOL_APPROVAL_TTL_SECONDS },
    )
    expect(TOOL_APPROVAL_TTL_SECONDS).toBe(86_400)
    expect(await getToolApproval(kv as never, APPROVAL_ID)).toEqual(record)
  })

  it('returns null for a missing record', async () => {
    expect(await getToolApproval(createFakeKv() as never, APPROVAL_ID))
      .toBeNull()
  })

  it('returns null without touching KV for a malformed id', async () => {
    const kv = createFakeKv()

    expect(await getToolApproval(kv as never, 'turn:abcdefgh')).toBeNull()
    expect(kv.get).not.toHaveBeenCalled()
  })

  it('returns null for a corrupt or foreign value', async () => {
    const kv = createFakeKv()

    kv.values.set(toolApprovalKey(APPROVAL_ID), '{not json')

    expect(await getToolApproval(kv as never, APPROVAL_ID)).toBeNull()

    kv.values.set(
      toolApprovalKey(APPROVAL_ID),
      JSON.stringify({ ...pendingRecord(), version: 2 }),
    )

    expect(await getToolApproval(kv as never, APPROVAL_ID)).toBeNull()

    kv.values.set(
      toolApprovalKey(APPROVAL_ID),
      JSON.stringify({ ...pendingRecord(), family: 'unknown' }),
    )

    expect(await getToolApproval(kv as never, APPROVAL_ID)).toBeNull()
  })

  it('requires a signature', async () => {
    const kv = createFakeKv()

    kv.values.set(
      toolApprovalKey(APPROVAL_ID),
      JSON.stringify({ ...pendingRecord(), signature: '' }),
    )

    expect(await getToolApproval(kv as never, APPROVAL_ID)).toBeNull()
  })

  it('accepts a record without connector or hash', async () => {
    const kv = createFakeKv()
    const record = pendingRecord({
      family: 'native',
      connectorId: null,
      definitionHash: null,
    })

    await putToolApproval(kv as never, APPROVAL_ID, record)

    expect(await getToolApproval(kv as never, APPROVAL_ID)).toEqual(record)
  })

  it('deletes only its own key', async () => {
    const kv = createFakeKv()

    await putToolApproval(kv as never, APPROVAL_ID, pendingRecord())
    await putToolApprovalResult(kv as never, APPROVAL_ID, resultRecord())
    await deleteToolApproval(kv as never, APPROVAL_ID)

    expect(await getToolApproval(kv as never, APPROVAL_ID)).toBeNull()
    expect(await getToolApprovalResult(kv as never, APPROVAL_ID))
      .not.toBeNull()
  })

  it('refuses to write a malformed id', async () => {
    await expect(putToolApproval(
      createFakeKv() as never,
      'turn:abcdefgh',
      pendingRecord(),
    )).rejects.toMatchObject({ status: 400 })
  })
})

describe('turn records', () => {
  it('round-trips the approval state with a 24 hour TTL', async () => {
    const kv = createFakeKv()
    const record = turnRecord()

    await putToolApprovalTurn(kv as never, record.messagePublicId, record)

    expect(kv.put).toHaveBeenCalledWith(
      `tool-approval:turn:${record.messagePublicId}`,
      expect.any(String),
      { expirationTtl: TOOL_APPROVAL_TTL_SECONDS },
    )
    expect(await getToolApprovalTurn(kv as never, record.messagePublicId))
      .toEqual(record)
  })

  it('returns null when the stored state is invalid', async () => {
    const kv = createFakeKv()
    const record = turnRecord()

    kv.values.set(
      toolApprovalTurnKey(record.messagePublicId),
      JSON.stringify({
        ...record,
        state: { ...record.state, taint: ['made-up'] },
      }),
    )

    expect(await getToolApprovalTurn(kv as never, record.messagePublicId))
      .toBeNull()
  })

  it('refuses more than ten pending ids', async () => {
    const kv = createFakeKv()
    const record = turnRecord()

    kv.values.set(
      toolApprovalTurnKey(record.messagePublicId),
      JSON.stringify({
        ...record,
        pendingApprovalIds: Array.from(
          { length: 11 },
          (_value, index) => `approval_${index}xx`,
        ),
      }),
    )

    expect(await getToolApprovalTurn(kv as never, record.messagePublicId))
      .toBeNull()
  })

  it('deletes the turn record', async () => {
    const kv = createFakeKv()
    const record = turnRecord()

    await putToolApprovalTurn(kv as never, record.messagePublicId, record)
    await deleteToolApprovalTurn(kv as never, record.messagePublicId)

    expect(await getToolApprovalTurn(kv as never, record.messagePublicId))
      .toBeNull()
  })

  it('returns null for a malformed message id', async () => {
    expect(await getToolApprovalTurn(createFakeKv() as never, 'a:b'))
      .toBeNull()
  })
})

describe('result records', () => {
  it('round-trips with a 24 hour TTL', async () => {
    const kv = createFakeKv()
    const record = resultRecord()

    await putToolApprovalResult(kv as never, APPROVAL_ID, record)

    expect(kv.put).toHaveBeenCalledWith(
      `tool-approval:result:${APPROVAL_ID}`,
      expect.any(String),
      { expirationTtl: TOOL_APPROVAL_TTL_SECONDS },
    )
    expect(await getToolApprovalResult(kv as never, APPROVAL_ID))
      .toEqual(record)
  })

  it('returns null for a corrupt value', async () => {
    const kv = createFakeKv()

    kv.values.set(toolApprovalResultKey(APPROVAL_ID), '[]')

    expect(await getToolApprovalResult(kv as never, APPROVAL_ID)).toBeNull()
  })

  it('deletes the result record', async () => {
    const kv = createFakeKv()

    await putToolApprovalResult(kv as never, APPROVAL_ID, resultRecord())
    await deleteToolApprovalResult(kv as never, APPROVAL_ID)

    expect(await getToolApprovalResult(kv as never, APPROVAL_ID)).toBeNull()
  })
})

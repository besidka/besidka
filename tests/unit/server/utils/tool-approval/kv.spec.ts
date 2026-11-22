import { describe, expect, it, vi } from 'vitest'
import {
  deleteToolApproval,
  deleteToolApprovalChatRecords,
  deleteToolApprovalResult,
  deleteToolApprovalTurn,
  getToolApproval,
  getToolApprovalResult,
  getToolApprovalTurn,
  isWellFormedToolApprovalId,
  putToolApproval,
  putToolApprovalResult,
  putToolApprovalTurn,
  toolApprovalChatKey,
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
import {
  TOOL_APPROVAL_CHAT_INDEX_MAX_APPROVALS,
  TOOL_APPROVAL_CHAT_INDEX_MAX_MESSAGES,
  TOOL_APPROVAL_PAYLOAD_MAX_BYTES,
  TOOL_APPROVAL_TTL_SECONDS,
} from '#shared/utils/tool-approval-policy'

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
    access: 'write',
    toolName: 'mcp__notion__create_page',
    connectorId: 'conn1',
    definitionHash: 'a'.repeat(64),
    input: { title: 'Plan', nested: { items: [1, 2] } },
    signature: 'sig-value',
    reason: 'default',
    rememberOptions: ['once', 'chat', 'always'],
    summary: 'Create the page "Plan"',
    auditCallId: 7,
    snapshot: {
      model: 'claude-haiku-4-5',
      gateway: null,
      reasoning: 'off',
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
  it('names the four keys apart', () => {
    expect(toolApprovalChatKey('chat123')).toBe('tool-approval:chat:chat123')
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
    expect(() => toolApprovalChatKey('chat:other')).toThrow()
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
      JSON.stringify({ ...pendingRecord(), family: 7 }),
    )

    expect(await getToolApproval(kv as never, APPROVAL_ID)).toBeNull()
  })

  it('reads a family from another deploy as null instead of failing', async () => {
    const kv = createFakeKv()

    kv.values.set(
      toolApprovalKey(APPROVAL_ID),
      JSON.stringify({ ...pendingRecord(), family: 'future-family' }),
    )

    const record = await getToolApproval(kv as never, APPROVAL_ID)

    expect(record).not.toBeNull()
    expect(record?.family).toBeNull()
  })

  it('reads a reason from another deploy as default', async () => {
    const kv = createFakeKv()

    kv.values.set(
      toolApprovalKey(APPROVAL_ID),
      JSON.stringify({ ...pendingRecord(), reason: 'future-reason' }),
    )

    expect((await getToolApproval(kv as never, APPROVAL_ID))?.reason)
      .toBe('default')
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

  it('reads back a record of a send that offered hundreds of tools',
    async () => {
      const kv = createFakeKv()
      const record = pendingRecord({
        snapshot: {
          ...pendingRecord().snapshot,
          toolNames: Array.from({ length: 372 }, (_value, index) => {
            return `mcp__github__tool_${index}`
          }),
        } as ToolApprovalPendingRecord['snapshot'],
      })

      await putToolApproval(kv as never, APPROVAL_ID, record)

      expect(await getToolApproval(kv as never, APPROVAL_ID))
        .toMatchObject({ toolCallId: record.toolCallId })
    })

  it('refuses to write a record it could not read back', async () => {
    const kv = createFakeKv()

    await expect(putToolApproval(
      kv as never,
      APPROVAL_ID,
      pendingRecord({ summary: 'x'.repeat(5000) }),
    )).rejects.toMatchObject({ status: 500 })
    expect(kv.put).not.toHaveBeenCalled()
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

  it('requires an access level', async () => {
    const kv = createFakeKv()

    kv.values.set(
      toolApprovalKey(APPROVAL_ID),
      JSON.stringify({ ...pendingRecord(), access: undefined }),
    )

    expect(await getToolApproval(kv as never, APPROVAL_ID)).toBeNull()

    kv.values.set(
      toolApprovalKey(APPROVAL_ID),
      JSON.stringify({ ...pendingRecord(), access: 'admin' }),
    )

    expect(await getToolApproval(kv as never, APPROVAL_ID)).toBeNull()
  })

  it('refuses an input over the payload cap and writes nothing', async () => {
    const kv = createFakeKv()
    const record = pendingRecord({
      input: { text: 'x'.repeat(TOOL_APPROVAL_PAYLOAD_MAX_BYTES) },
    })

    await expect(putToolApproval(kv as never, APPROVAL_ID, record))
      .rejects.toMatchObject({ status: 413 })
    expect(kv.put).not.toHaveBeenCalled()
  })

  it('measures the input in bytes, not characters', async () => {
    const kv = createFakeKv()
    const record = pendingRecord({
      input: { text: 'ї'.repeat(TOOL_APPROVAL_PAYLOAD_MAX_BYTES / 2) },
    })

    await expect(putToolApproval(kv as never, APPROVAL_ID, record))
      .rejects.toMatchObject({ status: 413 })
  })

  it('accepts an input just under the cap', async () => {
    const kv = createFakeKv()
    const record = pendingRecord({
      input: { text: 'x'.repeat(TOOL_APPROVAL_PAYLOAD_MAX_BYTES - 100) },
    })

    await putToolApproval(kv as never, APPROVAL_ID, record)

    expect(await getToolApproval(kv as never, APPROVAL_ID)).toEqual(record)
  })

  it('accepts a record without an input', async () => {
    const kv = createFakeKv()
    const record = pendingRecord({ input: undefined })

    await putToolApproval(kv as never, APPROVAL_ID, record)

    expect(kv.values.has(toolApprovalKey(APPROVAL_ID))).toBe(true)
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
        state: { ...record.state, taint: [7] },
      }),
    )

    expect(await getToolApprovalTurn(kv as never, record.messagePublicId))
      .toBeNull()
  })

  it('reads a taint kind from another deploy as google taint', async () => {
    const kv = createFakeKv()
    const record = turnRecord()

    kv.values.set(
      toolApprovalTurnKey(record.messagePublicId),
      JSON.stringify({
        ...record,
        state: { ...record.state, taint: ['web', 'future-kind'] },
      }),
    )

    const stored = await getToolApprovalTurn(
      kv as never,
      record.messagePublicId,
    )

    expect(stored?.state.taint).toEqual(['web', 'google'])
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

  it('refuses to write more than ten pending ids', async () => {
    const kv = createFakeKv()
    const record = {
      ...turnRecord(),
      pendingApprovalIds: Array.from(
        { length: 11 },
        (_value, index) => `approval_${index}xx`,
      ),
    }

    await expect(putToolApprovalTurn(
      kv as never,
      record.messagePublicId,
      record,
    )).rejects.toMatchObject({ status: 500 })
    expect(kv.put).not.toHaveBeenCalled()
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

  it('stores an output under the cap as is and says it was not cut', async () => {
    const kv = createFakeKv()
    const record = resultRecord()

    expect(await putToolApprovalResult(kv as never, APPROVAL_ID, record))
      .toEqual({ truncated: false })
    expect((await getToolApprovalResult(kv as never, APPROVAL_ID))?.output)
      .toEqual({ ok: true })
  })

  it('replaces an output over the cap with a marker', async () => {
    const kv = createFakeKv()
    const record = {
      ...resultRecord(),
      output: { text: 'x'.repeat(TOOL_APPROVAL_PAYLOAD_MAX_BYTES) },
    }

    expect(await putToolApprovalResult(kv as never, APPROVAL_ID, record))
      .toEqual({ truncated: true })

    const stored = await getToolApprovalResult(kv as never, APPROVAL_ID)

    expect(stored?.output).toEqual(expect.stringContaining('Output omitted'))
    expect(stored?.toolCallId).toBe('call_1')
    expect(JSON.stringify(stored).length).toBeLessThan(1000)
  })

  it('stores a result without an output', async () => {
    const kv = createFakeKv()

    expect(await putToolApprovalResult(
      kv as never,
      APPROVAL_ID,
      { ...resultRecord(), output: undefined },
    )).toEqual({ truncated: false })
  })

  it('deletes the result record', async () => {
    const kv = createFakeKv()

    await putToolApprovalResult(kv as never, APPROVAL_ID, resultRecord())
    await deleteToolApprovalResult(kv as never, APPROVAL_ID)

    expect(await getToolApprovalResult(kv as never, APPROVAL_ID)).toBeNull()
  })
})

describe('per-chat index', () => {
  const MESSAGE_ID = '01JABCDEFGHJKMNPQRSTVWXYZ0'

  function readIndex(kv: ReturnType<typeof createFakeKv>, chat = 'chat123') {
    return JSON.parse(kv.values.get(toolApprovalChatKey(chat)) ?? 'null')
  }

  it('lists the approval id, the turn message id and the result id', async () => {
    const kv = createFakeKv()

    await putToolApproval(kv as never, APPROVAL_ID, pendingRecord())
    await putToolApprovalTurn(kv as never, MESSAGE_ID, turnRecord())
    await putToolApprovalResult(kv as never, APPROVAL_ID, resultRecord())

    expect(readIndex(kv)).toEqual({
      version: 1,
      approvalIds: [APPROVAL_ID],
      messageIds: [MESSAGE_ID],
    })
  })

  it('lists each id once and refreshes the 24 hour TTL', async () => {
    const kv = createFakeKv()

    await putToolApproval(kv as never, APPROVAL_ID, pendingRecord())
    await putToolApproval(kv as never, APPROVAL_ID, pendingRecord())
    await putToolApproval(kv as never, 'approval_second', pendingRecord())

    expect(readIndex(kv).approvalIds).toEqual([APPROVAL_ID, 'approval_second'])
    expect(kv.put).toHaveBeenLastCalledWith(
      `tool-approval:${'approval_second'}`,
      expect.any(String),
      { expirationTtl: TOOL_APPROVAL_TTL_SECONDS },
    )
    expect(kv.put).toHaveBeenCalledWith(
      toolApprovalChatKey('chat123'),
      expect.any(String),
      { expirationTtl: TOOL_APPROVAL_TTL_SECONDS },
    )
  })

  it('writes the index before the record it names', async () => {
    const kv = createFakeKv()

    await putToolApproval(kv as never, APPROVAL_ID, pendingRecord())

    expect(kv.put.mock.calls.map(call => call[0])).toEqual([
      toolApprovalChatKey('chat123'),
      toolApprovalKey(APPROVAL_ID),
    ])
  })

  it('keeps one index per chat', async () => {
    const kv = createFakeKv()

    await putToolApproval(kv as never, APPROVAL_ID, pendingRecord())
    await putToolApproval(
      kv as never,
      'approval_other',
      pendingRecord({ chatPublicId: 'chat456' }),
    )

    expect(readIndex(kv).approvalIds).toEqual([APPROVAL_ID])
    expect(readIndex(kv, 'chat456').approvalIds).toEqual(['approval_other'])
  })

  it('drops the oldest ids past the bound', async () => {
    const kv = createFakeKv()
    const total = TOOL_APPROVAL_CHAT_INDEX_MAX_APPROVALS + 3

    for (let index = 0; index < total; index++) {
      await putToolApproval(
        kv as never,
        `approval_${String(index).padStart(4, '0')}`,
        pendingRecord(),
      )
    }

    const { approvalIds } = readIndex(kv)

    expect(approvalIds).toHaveLength(TOOL_APPROVAL_CHAT_INDEX_MAX_APPROVALS)
    expect(approvalIds[0]).toBe('approval_0003')
    expect(approvalIds.at(-1)).toBe(`approval_${String(total - 1).padStart(4, '0')}`)
  })

  it('bounds the message ids too', async () => {
    const kv = createFakeKv()

    const total = TOOL_APPROVAL_CHAT_INDEX_MAX_MESSAGES + 2

    for (let index = 0; index < total; index++) {
      await putToolApprovalTurn(kv as never, `msg${index}`, turnRecord())
    }

    expect(readIndex(kv).messageIds)
      .toHaveLength(TOOL_APPROVAL_CHAT_INDEX_MAX_MESSAGES)
  })

  it('starts over from a corrupt index', async () => {
    const kv = createFakeKv()

    kv.values.set(toolApprovalChatKey('chat123'), '{not json')

    await putToolApproval(kv as never, APPROVAL_ID, pendingRecord())

    expect(readIndex(kv).approvalIds).toEqual([APPROVAL_ID])
  })

  describe('deleteToolApprovalChatRecords', () => {
    it('deletes the pending, result and turn keys the index lists', async () => {
      const kv = createFakeKv()

      await putToolApproval(kv as never, APPROVAL_ID, pendingRecord())
      await putToolApprovalTurn(kv as never, MESSAGE_ID, turnRecord())
      await putToolApprovalResult(kv as never, APPROVAL_ID, resultRecord())

      const result = await deleteToolApprovalChatRecords(
        kv as never,
        'chat123',
      )

      expect(result.keysDeleted).toBe(3)
      expect([...kv.values.keys()]).toEqual([])
    })

    it('leaves the records of another chat alone', async () => {
      const kv = createFakeKv()

      await putToolApproval(kv as never, APPROVAL_ID, pendingRecord())
      await putToolApproval(
        kv as never,
        'approval_other',
        pendingRecord({ chatPublicId: 'chat456' }),
      )
      await deleteToolApprovalChatRecords(kv as never, 'chat123')

      expect([...kv.values.keys()].sort()).toEqual([
        toolApprovalChatKey('chat456'),
        toolApprovalKey('approval_other'),
      ].sort())
    })

    it('deletes one key at a time', async () => {
      const kv = createFakeKv()
      let inFlight = 0
      let peak = 0

      await putToolApproval(kv as never, APPROVAL_ID, pendingRecord())
      await putToolApproval(kv as never, 'approval_two', pendingRecord())
      kv.delete.mockImplementation(async (key: string) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await Promise.resolve()
        kv.values.delete(key)
        inFlight--
      })
      await deleteToolApprovalChatRecords(kv as never, 'chat123')

      expect(peak).toBe(1)
    })

    it('deletes an unreadable index and nothing else', async () => {
      const kv = createFakeKv()

      kv.values.set(toolApprovalChatKey('chat123'), '[]')
      kv.values.set(toolApprovalKey(APPROVAL_ID), 'kept')

      expect(await deleteToolApprovalChatRecords(kv as never, 'chat123'))
        .toEqual({ keysDeleted: 0 })
      expect(kv.values.has(toolApprovalChatKey('chat123'))).toBe(false)
      expect(kv.values.has(toolApprovalKey(APPROVAL_ID))).toBe(true)
    })

    it('does nothing for a chat without an index', async () => {
      expect(await deleteToolApprovalChatRecords(
        createFakeKv() as never,
        'chat123',
      )).toEqual({ keysDeleted: 0 })
    })

    it('ignores a malformed chat id without touching KV', async () => {
      const kv = createFakeKv()

      expect(await deleteToolApprovalChatRecords(kv as never, 'a:b'))
        .toEqual({ keysDeleted: 0 })
      expect(kv.get).not.toHaveBeenCalled()
      expect(kv.delete).not.toHaveBeenCalled()
    })
  })
})

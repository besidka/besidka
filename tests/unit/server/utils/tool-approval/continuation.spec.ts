import { describe, expect, it, vi } from 'vitest'
import { convertToModelMessages } from 'ai'
import type { UIMessage } from 'ai'
import {
  TOOL_APPROVAL_DENIAL_TEXT,
  assertEndsWithApprovalResponse,
  buildResumedAssistantMessages,
  classifyDuplicateContinuation,
  consumeToolApprovalResponses,
  decideContinuation,
  findContinuationTurn,
  resolveReplayPermissionMode,
  sanitizeApprovalReason,
  startClaimHeartbeats,
  wrapApprovedExecutions,
} from '~~/server/utils/tool-approval/continuation'
import type { ToolApprovalPendingRecord } from '~~/server/utils/tool-approval/kv'
import { buildConnectorApprovalEntry } from '~~/server/utils/tool-approval/send'
import type { SendToolEntry } from '~~/server/utils/tool-approval/send'
import { createApprovalState } from '~~/server/utils/tool-approval/state'

const claimMocks = vi.hoisted(() => ({
  markClaimDone: vi.fn(async () => true),
  markClaimFailed: vi.fn(async () => true),
}))

vi.mock('~~/server/utils/tool-approval/claims', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/tool-approval/claims')
  >()

  return { ...actual, ...claimMocks, touchClaim: vi.fn(async () => true) }
})

vi.mock('~~/server/utils/connectors/store', () => ({
  listConnectorChatSettings: vi.fn(),
  listConnectorToolSettings: vi.fn(),
  upsertConnectorChatSettings: vi.fn(),
  upsertConnectorToolSettings: vi.fn(),
  recordConnectorToolCall: vi.fn(),
  settleConnectorToolCall: vi.fn(),
}))

const HASH = 'b'.repeat(64)
const TOOL_NAME = 'mcp__linear__create_issue'

function message(
  id: string,
  role: 'user' | 'assistant',
  parts: unknown[] = [],
) {
  return {
    id: `row-${id}`,
    publicId: id,
    role,
    parts,
    tools: [],
    reasoning: 'off',
    usage: null,
    createdAt: new Date(),
  }
}

function pendingRecord(
  overrides: Partial<ToolApprovalPendingRecord> = {},
): ToolApprovalPendingRecord {
  return {
    version: 1,
    userId: 1,
    chatPublicId: 'chat-1',
    messagePublicId: 'assistant-1',
    toolCallId: 'call-1',
    family: 'connector',
    access: 'write',
    toolName: TOOL_NAME,
    connectorId: 'c1',
    definitionHash: HASH,
    input: { title: 'exact' },
    signature: 'signed',
    reason: 'always-ask',
    rememberOptions: ['once'],
    summary: 'Linear wants to run create_issue',
    auditCallId: 7,
    snapshot: {
      model: 'gpt-5-mini',
      gateway: null,
      reasoning: 'off',
      toolNames: [TOOL_NAME],
      connectorIds: ['c1'],
    },
    ...overrides,
  }
}

function connectorEntries(hash: string = HASH) {
  return new Map<string, SendToolEntry>([[
    TOOL_NAME,
    buildConnectorApprovalEntry({
      exposedName: TOOL_NAME,
      connectorId: 'c1',
      connectorTitle: 'Linear',
      connectorHost: 'mcp.linear.example.com',
      remoteToolName: 'create_issue',
      definitionHash: hash,
      annotations: {},
    }),
  ]])
}

describe('sanitizeApprovalReason', () => {
  it('keeps plain text only and caps the length', () => {
    expect(sanitizeApprovalReason(' Not‮\u0007\nnow ')).toBe('Not now')
    expect(sanitizeApprovalReason('No\u200Bt\u2060 n\u{E0041}ow'))
      .toBe('Not now')
    expect(sanitizeApprovalReason('   ')).toBeUndefined()
    expect(sanitizeApprovalReason('x'.repeat(900))).toHaveLength(500)
  })
})

describe('findContinuationTurn', () => {
  const messages = [
    message('user-1', 'user'),
    message('assistant-1', 'assistant'),
  ]

  it('returns the paused reply and its user message', () => {
    const turn = findContinuationTurn(messages, 'assistant-1')

    expect(turn.assistant.publicId).toBe('assistant-1')
    expect(turn.user.publicId).toBe('user-1')
  })

  it('answers 404 for a foreign message and 409 for a stale one', () => {
    expect(() => findContinuationTurn(messages, 'elsewhere'))
      .toThrow(expect.objectContaining({ status: 404 }))
    expect(() => findContinuationTurn(messages, 'user-1'))
      .toThrow(expect.objectContaining({
        status: 409,
        code: 'TOOL_APPROVAL_STALE',
      }))
    expect(() => findContinuationTurn([
      ...messages,
      message('user-2', 'user'),
    ], 'assistant-1')).toThrow(expect.objectContaining({ status: 409 }))
  })
})

describe('classifyDuplicateContinuation', () => {
  const now = new Date('2026-11-15T12:00:00Z')
  const claim = {
    approvalId: 'approval-1',
    userId: 1,
    chatPublicId: 'chat-1',
    messagePublicId: 'assistant-1',
    status: 'claimed' as const,
    createdAt: now,
    updatedAt: now,
  }

  it('replays done claims, waits for live ones, reports lapsed ones', () => {
    expect(classifyDuplicateContinuation([{ ...claim, status: 'done' }], now))
      .toBe('replay')
    expect(classifyDuplicateContinuation([claim], now)).toBe('in-progress')
    expect(classifyDuplicateContinuation([{
      ...claim,
      updatedAt: new Date(now.getTime() - 121_000),
    }], now)).toBe('interrupted')
  })
})

describe('consumeToolApprovalResponses', () => {
  it('counts responses per minute and refuses past 30', async () => {
    const store = new Map<string, string>()
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value)
      },
    }
    const now = 1_000_000

    expect(await consumeToolApprovalResponses(kv as never, 1, 25, now))
      .toEqual({ allowed: true, retryAfter: 0 })
    expect(await consumeToolApprovalResponses(kv as never, 1, 6, now + 1000))
      .toEqual({ allowed: false, retryAfter: 59 })
    expect(await consumeToolApprovalResponses(kv as never, 1, 6, now + 61_000))
      .toEqual({ allowed: true, retryAfter: 0 })
  })
})

describe('decideContinuation', () => {
  it('keeps an approved call that still matches and clamps remember', () => {
    const [decision] = decideContinuation({
      answers: [{
        response: { approvalId: 'approval-1', approved: true, remember: 'always' },
        record: pendingRecord(),
      }],
      entries: connectorEntries(),
      state: createApprovalState(),
    })

    expect(decision).toMatchObject({
      approved: true,
      remember: 'once',
      denialReason: null,
    })
  })

  it('denies a drifted, missing or over-cap call with Besidka text', () => {
    const state = createApprovalState()
    const answer = {
      response: { approvalId: 'approval-1', approved: true, remember: 'once' },
      record: pendingRecord(),
    } as const

    expect(decideContinuation({
      answers: [answer],
      entries: connectorEntries('c'.repeat(64)),
      state,
    })[0]).toMatchObject({
      approved: false,
      reason: TOOL_APPROVAL_DENIAL_TEXT['definition-drifted'],
    })
    expect(decideContinuation({
      answers: [answer],
      entries: new Map(),
      state,
    })[0]).toMatchObject({
      approved: false,
      denialReason: 'missing-tool',
    })

    state.counters.connectorCalls = 11

    const decisions = decideContinuation({
      answers: [answer, {
        response: { ...answer.response, approvalId: 'approval-2' },
        record: pendingRecord({ toolCallId: 'call-2' }),
      }],
      entries: connectorEntries(),
      state,
    })

    expect(decisions.map(decision => decision.denialReason))
      .toEqual([null, 'over-cap'])
    expect(state.counters.connectorCalls).toBe(11)
  })

  it('carries the user note on a denial', () => {
    const [decision] = decideContinuation({
      answers: [{
        response: {
          approvalId: 'approval-1',
          approved: false,
          remember: 'chat',
          reason: 'Wrong project',
        },
        record: pendingRecord(),
      }],
      entries: connectorEntries(),
      state: createApprovalState(),
    })

    expect(decision).toMatchObject({
      approved: false,
      remember: 'once',
      reason: 'The user declined this action. Their note: Wrong project',
    })
  })
})

describe('buildResumedAssistantMessages', () => {
  const storedParts = [
    { type: 'step-start' },
    { type: 'text', text: 'Let me file it.' },
    {
      type: 'dynamic-tool',
      toolName: TOOL_NAME,
      toolCallId: 'call-1',
      state: 'approval-requested',
      input: { title: 'redacted' },
      approval: { id: 'approval-1', requestReason: 'always-ask' },
    },
    {
      type: 'data-tool-approval',
      id: 'call-1',
      data: { approvalId: 'approval-1' },
    },
  ]

  function decisions(approved: boolean) {
    return decideContinuation({
      answers: [{
        response: { approvalId: 'approval-1', approved, remember: 'once' },
        record: pendingRecord(),
      }],
      entries: connectorEntries(),
      state: createApprovalState(),
    })
  }

  it('gives the model the exact input and signature, D1 neither', () => {
    const { modelMessage, storedMessage } = buildResumedAssistantMessages({
      messageId: 'assistant-1',
      parts: storedParts,
      decisions: decisions(true),
    })
    const modelTool = modelMessage.parts.find((part: any) => {
      return part.toolCallId === 'call-1'
    }) as any
    const storedTool = storedMessage.parts.find((part: any) => {
      return part.toolCallId === 'call-1'
    }) as any

    expect(modelMessage.parts.map(part => part.type))
      .toEqual(['step-start', 'text', 'dynamic-tool'])
    expect(modelTool).toMatchObject({
      state: 'approval-responded',
      input: { title: 'exact' },
      approval: { id: 'approval-1', approved: true, signature: 'signed' },
    })
    expect(storedMessage.parts).toHaveLength(storedParts.length)
    expect(storedTool).toMatchObject({
      state: 'approval-responded',
      input: { title: 'redacted' },
      approval: { id: 'approval-1', approved: true },
    })
    expect(storedTool.approval.signature).toBeUndefined()
  })

  it('builds a prompt that ends on the approval answers', async () => {
    const { modelMessage } = buildResumedAssistantMessages({
      messageId: 'assistant-1',
      parts: storedParts,
      decisions: decisions(false),
    })
    const modelMessages = await convertToModelMessages([
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Go' }] },
      modelMessage,
    ] as UIMessage[])

    expect(() => assertEndsWithApprovalResponse(modelMessages)).not.toThrow()
    expect(() => assertEndsWithApprovalResponse([
      ...modelMessages,
      { role: 'user', content: 'More' },
    ])).toThrow(expect.objectContaining({ status: 409 }))
  })
})

describe('buildResumedAssistantMessages provider metadata', () => {
  it('keeps thinking and thought signatures on the resumed turn', async () => {
    const [decision] = decideContinuation({
      answers: [{
        response: { approvalId: 'approval-1', approved: true, remember: 'once' },
        record: pendingRecord({
          callProviderMetadata: { google: { thoughtSignature: 'thought-sig' } },
        }),
      }],
      entries: connectorEntries(),
      state: createApprovalState(),
    })
    const { modelMessage } = buildResumedAssistantMessages({
      messageId: 'assistant-1',
      parts: [
        { type: 'step-start' },
        {
          type: 'reasoning',
          text: 'Filing the issue.',
          state: 'done',
          providerMetadata: { anthropic: { signature: 'thinking-sig' } },
        },
        {
          type: 'tool-create_artifact',
          toolCallId: 'call-1',
          state: 'approval-requested',
          input: { kind: 'html', title: 'Plan' },
          approval: { id: 'approval-1' },
        },
      ],
      decisions: [{ ...decision!, toolName: 'create_artifact' }],
    })
    const [, assistant] = await convertToModelMessages([
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Go' }] },
      modelMessage,
    ] as UIMessage[])
    const content = assistant!.content as Array<Record<string, any>>

    expect(content.map(part => part.type))
      .toEqual(['reasoning', 'tool-call', 'tool-approval-request'])
    expect(content[0]!.providerOptions)
      .toEqual({ anthropic: { signature: 'thinking-sig' } })
    expect(content[1]).toMatchObject({
      toolCallId: 'call-1',
      input: { title: 'exact' },
      providerOptions: { google: { thoughtSignature: 'thought-sig' } },
    })
  })
})

describe('resolveReplayPermissionMode', () => {
  it('keeps ask for connector tools and when no family is given', () => {
    expect(resolveReplayPermissionMode()).toBe('ask')
    expect(resolveReplayPermissionMode('connector', TOOL_NAME)).toBe('ask')
    expect(resolveReplayPermissionMode(
      'connector',
      'besidka__create_file',
      new Map([['besidka__create_file', 'blocked' as const]]),
    )).toBe('ask')
  })

  it('reads the resolved mode of a Besidka tool and fails closed', () => {
    const modes = new Map([
      ['besidka__create_file', 'blocked' as const],
      ['besidka__list_files', 'allow' as const],
      ['besidka__get_project', 'ask' as const],
    ])

    expect(resolveReplayPermissionMode(
      'besidka',
      'besidka__create_file',
      modes,
    )).toBe('blocked')
    expect(resolveReplayPermissionMode('besidka', 'besidka__list_files', modes))
      .toBe('allow')
    expect(resolveReplayPermissionMode('besidka', 'besidka__get_project', modes))
      .toBe('ask')
    expect(resolveReplayPermissionMode('besidka', 'besidka__nope', modes))
      .toBe('blocked')
    expect(resolveReplayPermissionMode('besidka', 'besidka__list_files'))
      .toBe('blocked')
  })
})

describe('decideContinuation with Besidka tool permissions', () => {
  const BESIDKA_TOOL_NAME = 'besidka__create_file'

  function besidkaEntries() {
    return new Map<string, SendToolEntry>([[
      BESIDKA_TOOL_NAME,
      {
        descriptor: {
          family: 'besidka',
          access: 'write',
          toolName: BESIDKA_TOOL_NAME,
          destructiveHint: false,
        },
        summary: 'Create a file',
        taint: 'besidka',
        readSource: null,
        alwaysGrant: null,
        alwaysGrantWhenTainted: false,
        connector: null,
      },
    ]])
  }

  function besidkaAnswer() {
    return {
      response: {
        approvalId: 'approval-1',
        approved: true,
        remember: 'once' as const,
      },
      record: pendingRecord({
        family: 'besidka',
        toolName: BESIDKA_TOOL_NAME,
        connectorId: null,
        definitionHash: null,
      }),
    }
  }

  it('denies an approved call the user has since blocked', () => {
    const [decision] = decideContinuation({
      answers: [besidkaAnswer()],
      entries: besidkaEntries(),
      state: createApprovalState(),
      besidkaPermissionModes: new Map([[BESIDKA_TOOL_NAME, 'blocked']]),
    })

    expect(decision).toMatchObject({
      approved: false,
      denialReason: 'blocked',
      reason: TOOL_APPROVAL_DENIAL_TEXT.blocked,
    })
  })

  it('keeps an approved call that is still ask or allow', () => {
    for (const mode of ['ask', 'allow'] as const) {
      const modes = new Map([[BESIDKA_TOOL_NAME, mode]])

      const [decision] = decideContinuation({
        answers: [besidkaAnswer()],
        entries: besidkaEntries(),
        state: createApprovalState(),
        besidkaPermissionModes: modes,
      })

      expect(decision).toMatchObject({ approved: true, denialReason: null })
    }
  })
})

describe('wrapApprovedExecutions', () => {
  it('settles a streaming tool only after its output is consumed', async () => {
    const [decision] = decideContinuation({
      answers: [{
        response: { approvalId: 'approval-1', approved: true, remember: 'once' },
        record: pendingRecord(),
      }],
      entries: connectorEntries(),
      state: createApprovalState(),
    })
    const owner = { userId: 1, chatPublicId: 'chat-1', messagePublicId: 'a-1' }
    const heartbeats = startClaimHeartbeats({
      db: {} as never,
      owner,
      approvalIds: ['approval-1'],
      logger: { set: vi.fn() },
    })
    const stop = vi.spyOn(heartbeats, 'stop')
    const onSettled = vi.fn()
    const tools = wrapApprovedExecutions({
      tools: {
        [TOOL_NAME]: {
          execute: async function* () {
            yield 'partial'
            yield 'final'
          },
        },
      } as never,
      decisions: [decision!],
      db: {} as never,
      owner,
      heartbeats,
      onSettled,
      logger: { set: vi.fn() },
    })!
    const output = (tools[TOOL_NAME] as any).execute({}, {
      toolCallId: 'call-1',
    }) as AsyncIterable<unknown>
    const seen: unknown[] = []

    for await (const value of output) {
      seen.push(value)

      if (value === 'partial') {
        expect(onSettled).not.toHaveBeenCalled()
      }
    }

    heartbeats.stopAll()

    expect(seen).toEqual(['partial', 'final'])
    expect(onSettled).toHaveBeenCalledWith('call-1')
    expect(stop).toHaveBeenCalledWith('approval-1')
    expect(claimMocks.markClaimDone).toHaveBeenCalledTimes(1)
  })
})

import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  buildToolApprovalRequestBody,
  classifyToolApprovalError,
  createToolApprovalRememberStore,
  getPendingToolApprovalIds,
  getPromptBeforeMessage,
  revertToolApprovalResponses,
  shouldSendToolApprovalResponses,
} from '~/composables/tool-approvals'

function pausedMessages(states: Array<{
  id: string
  state: string
  approved?: boolean
  reason?: string
}>): UIMessage[] {
  return [
    { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Go' }] },
    {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        ...states.map(call => ({
          type: 'dynamic-tool',
          toolName: 'mcp__linear__create_issue',
          toolCallId: `call-${call.id}`,
          state: call.state,
          input: {},
          approval: {
            id: `approval-${call.id}`,
            ...(call.approved === undefined ? {} : { approved: call.approved }),
            ...(call.reason ? { reason: call.reason } : {}),
          },
        })),
        {
          type: 'data-tool-approval',
          id: 'call-1',
          data: { approvalId: 'approval-1' },
        },
      ],
    },
  ] as UIMessage[]
}

describe('buildToolApprovalRequestBody', () => {
  it('sends only the answers, with the stored remember choice', () => {
    const store = createToolApprovalRememberStore()

    store.set('approval-2', 'chat')

    expect(buildToolApprovalRequestBody(pausedMessages([
      { id: '1', state: 'approval-responded', approved: true },
      {
        id: '2',
        state: 'approval-responded',
        approved: false,
        reason: 'No',
      },
    ]), store)).toEqual({
      approval: {
        messageId: 'assistant-1',
        responses: [
          { approvalId: 'approval-1', approved: true, remember: 'once' },
          {
            approvalId: 'approval-2',
            approved: false,
            reason: 'No',
            remember: 'chat',
          },
        ],
      },
    })
  })

  it('returns null until every waiting call is answered', () => {
    expect(buildToolApprovalRequestBody(pausedMessages([
      { id: '1', state: 'approval-responded', approved: true },
      { id: '2', state: 'approval-requested' },
    ]))).toBeNull()
    expect(buildToolApprovalRequestBody([
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
    ])).toBeNull()
  })

  it('forgets remember choices once used', () => {
    const store = createToolApprovalRememberStore()

    store.set('approval-1', 'always')
    store.forget(['approval-1'])

    expect(store.get('approval-1')).toBeUndefined()
  })

  it('sends each set of answers automatically only once', () => {
    const store = createToolApprovalRememberStore()
    const messages = pausedMessages([
      { id: '1', state: 'approval-responded', approved: true },
    ])

    expect(shouldSendToolApprovalResponses(messages, store)).toBe(true)

    store.markSent(['approval-1'])

    expect(shouldSendToolApprovalResponses(messages, store)).toBe(false)
    expect(shouldSendToolApprovalResponses(pausedMessages([
      { id: '1', state: 'approval-requested' },
    ]), store)).toBe(false)
  })

  it('counts answers as sent only after a successful response', () => {
    const store = createToolApprovalRememberStore()
    const messages = pausedMessages([
      { id: '1', state: 'approval-responded', approved: true },
    ])

    store.set('approval-1', 'chat')
    store.markInFlight(['approval-1'])
    store.settleInFlight(false)

    expect(shouldSendToolApprovalResponses(messages, store)).toBe(true)
    expect(store.get('approval-1')).toBe('chat')

    store.markInFlight(['approval-1'])
    store.settleInFlight(true)

    expect(shouldSendToolApprovalResponses(messages, store)).toBe(false)
    expect(store.get('approval-1')).toBeUndefined()
  })
})

describe('classifyToolApprovalError', () => {
  function bodyError(body: Record<string, unknown>): Error {
    return new Error(JSON.stringify(body))
  }

  it('reads an expired approval from the 409 body', () => {
    expect(classifyToolApprovalError(bodyError({
      statusCode: 409,
      message: 'This approval expired',
      data: {
        code: 'TOOL_APPROVAL_EXPIRED',
        why: 'The pending record is gone',
        fix: 'Ask again',
      },
    }))).toEqual({
      kind: 'expired',
      message: 'This approval expired',
      why: 'The pending record is gone',
      fix: 'Ask again',
    })
  })

  it('treats a stale approval as expired', () => {
    expect(classifyToolApprovalError(bodyError({
      statusCode: 409,
      message: 'This approval is no longer current',
      data: { code: 'TOOL_APPROVAL_STALE' },
    })).kind).toBe('expired')
  })

  it('reads an interrupted run', () => {
    expect(classifyToolApprovalError(bodyError({
      statusCode: 409,
      message: 'Interrupted. Ask again',
      data: { code: 'TOOL_APPROVAL_INTERRUPTED' },
    })).kind).toBe('interrupted')
  })

  it('lets the user answer again after a rate limit', () => {
    expect(classifyToolApprovalError(bodyError({
      statusCode: 429,
      message: 'Too many approval answers',
      data: {
        why: 'An account can answer at most 30 approvals a minute',
      },
    }))).toEqual({
      kind: 'retry',
      message: 'Too many approval answers',
      why: 'An account can answer at most 30 approvals a minute',
    })
  })

  it('retries a network failure', () => {
    expect(classifyToolApprovalError(new TypeError('Failed to fetch')))
      .toEqual({ kind: 'retry', message: 'Failed to fetch' })
  })
})

describe('revertToolApprovalResponses', () => {
  it('puts the given answers back to waiting and drops the answer', () => {
    const messages = pausedMessages([
      { id: '1', state: 'approval-responded', approved: true },
      { id: '2', state: 'approval-responded', approved: false },
    ])
    const reverted = revertToolApprovalResponses(messages, ['approval-1'])
    const parts = reverted[1]!.parts as Array<Record<string, unknown>>

    expect(parts[1]).toEqual(expect.objectContaining({
      state: 'approval-requested',
      approval: { id: 'approval-1' },
    }))
    expect(parts[2]).toEqual(expect.objectContaining({
      state: 'approval-responded',
    }))
    expect(messages[1]!.parts[1]).toEqual(expect.objectContaining({
      state: 'approval-responded',
    }))
  })

  it('returns the same array when nothing matched', () => {
    const messages = pausedMessages([
      { id: '1', state: 'approval-requested' },
    ])

    expect(revertToolApprovalResponses(messages, ['approval-9']))
      .toBe(messages)
    expect(revertToolApprovalResponses(messages, [])).toBe(messages)
  })
})

describe('getPendingToolApprovalIds', () => {
  it('lists waiting calls of the last message, minus failures', () => {
    const messages = pausedMessages([
      { id: '1', state: 'approval-requested' },
      { id: '2', state: 'approval-requested' },
      { id: '3', state: 'approval-responded', approved: true },
    ])

    expect(getPendingToolApprovalIds(messages))
      .toEqual(['approval-1', 'approval-2'])
    expect(getPendingToolApprovalIds(messages, { 'approval-2': 'expired' }))
      .toEqual(['approval-1'])
  })

  it('is empty when the last message is the user', () => {
    const messages = [
      ...pausedMessages([{ id: '1', state: 'approval-requested' }]),
      { id: 'user-2', role: 'user', parts: [{ type: 'text', text: 'New' }] },
    ] as UIMessage[]

    expect(getPendingToolApprovalIds(messages)).toEqual([])
  })
})

describe('getPromptBeforeMessage', () => {
  it('returns the text of the user message before the reply', () => {
    expect(getPromptBeforeMessage(
      pausedMessages([{ id: '1', state: 'approval-requested' }]),
      'assistant-1',
    )).toBe('Go')
  })

  it('returns an empty string when there is none', () => {
    expect(getPromptBeforeMessage([], 'assistant-1')).toBe('')
  })
})

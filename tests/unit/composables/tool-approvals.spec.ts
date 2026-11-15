import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  buildToolApprovalRequestBody,
  createToolApprovalRememberStore,
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
})

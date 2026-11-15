import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  hasAwaitingApprovalToolPart,
  isAwaitingApprovalToolPart,
  isToolApprovalDataPart,
  isToolApprovalPart,
  toStoredAwaitingApprovalToolPart,
} from '#shared/utils/tool-approval-parts'
import { sanitizeMessagesForModelContext } from '~~/server/utils/files/assistant-files'

const approvalPart = {
  type: 'tool-memory_write',
  toolCallId: 'call-1',
  state: 'approval-requested',
  input: { title: 'Allergy', body: 'secret body' },
  approval: {
    id: 'approval-0001',
    requestReason: 'untrusted-output',
    signature: 'signed',
  },
}

const dataPart = {
  type: 'data-tool-approval',
  id: 'call-1',
  data: { approvalId: 'approval-0001' },
}

describe('tool approval parts', () => {
  it('tells waiting tool parts and the data part from everything else', () => {
    expect(isAwaitingApprovalToolPart(approvalPart)).toBe(true)
    expect(isAwaitingApprovalToolPart({
      ...approvalPart,
      type: 'dynamic-tool',
      state: 'approval-responded',
    })).toBe(true)
    expect(isAwaitingApprovalToolPart({
      ...approvalPart,
      state: 'output-available',
    })).toBe(false)
    expect(isAwaitingApprovalToolPart({
      type: 'text',
      state: 'approval-requested',
    })).toBe(false)
    expect(isToolApprovalDataPart(dataPart)).toBe(true)
    expect(isToolApprovalPart(dataPart)).toBe(true)
    expect(isToolApprovalPart({ type: 'data-artifact', data: {} }))
      .toBe(false)
    expect(hasAwaitingApprovalToolPart([dataPart, approvalPart])).toBe(true)
    expect(hasAwaitingApprovalToolPart('not parts')).toBe(false)
  })

  it('stores a waiting part without its input or signature', () => {
    expect(toStoredAwaitingApprovalToolPart(approvalPart, { title: 'Allergy' }))
      .toEqual({
        type: 'tool-memory_write',
        toolCallId: 'call-1',
        state: 'approval-requested',
        input: { title: 'Allergy' },
        approval: { id: 'approval-0001', requestReason: 'untrusted-output' },
      })
  })

  it('leaves an abandoned approval-only reply out of later model context',
    () => {
      const messages = sanitizeMessagesForModelContext([
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Save it' }] },
        {
          id: 'a1',
          role: 'assistant',
          parts: [{ type: 'step-start' }, approvalPart, dataPart],
        },
        { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Never mind' }] },
      ] as UIMessage[])

      expect(messages.map(message => message.id)).toEqual(['u1', 'u2'])
    })
})

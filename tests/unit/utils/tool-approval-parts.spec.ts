import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  hasAwaitingApprovalToolPart,
  isAwaitingApprovalToolPart,
  isToolApprovalDataPart,
  isToolApprovalPart,
  readApprovalLink,
  toStoredAwaitingApprovalToolPart,
} from '#shared/utils/tool-approval-parts'
import { sanitizeMessagesForModelContext } from '~~/server/utils/files/assistant-files'

describe('readApprovalLink', () => {
  it.each([
    'https://mail.google.com/mail/?authuser=me%40example.com#all/t1',
    'https://drive.google.com/open?id=abc',
    'https://docs.google.com/document/d/abc',
  ])('accepts the Google link %s', (link) => {
    expect(readApprovalLink(link)).toBe(link)
  })

  it.each([
    'http://mail.google.com/mail/#all/t1',
    'https://mail.google.com.evil.example/',
    'https://user:pass@mail.google.com/',
    'https://mail.google.com:8443/',
    'javascript:alert(1)',
    'https://evil.example/',
    'not a url',
    `https://mail.google.com/${'a'.repeat(2100)}`,
    42,
    null,
  ])('refuses %s', (link) => {
    expect(readApprovalLink(link)).toBeNull()
  })
})

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

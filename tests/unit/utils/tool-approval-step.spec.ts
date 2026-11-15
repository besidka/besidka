import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import type { ToolApprovalPartData } from '#shared/utils/tool-approval-parts'
import type { ApprovalStepContext } from '~/utils/tool-approval-step'
import {
  formatApprovalOutcome,
  formatApprovalProgress,
  getApprovalButtons,
  getApprovalDataByToolCallId,
  getApprovalReasonText,
  getApprovalSourceLabel,
  getApprovalStepModel,
  getApprovalStepSummaryLine,
  getApprovalStepTitle,
  getApprovalSummaryLine,
  getBesidkaAlwaysConfirmText,
  isApprovalInputShortened,
  resolveApprovalStepState,
} from '~/utils/tool-approval-step'

function approvalData(
  overrides: Partial<ToolApprovalPartData> = {},
): ToolApprovalPartData {
  return {
    approvalId: 'approval-1',
    toolCallId: 'call-1',
    toolName: 'mcp__linear__create_issue',
    reason: 'always-ask',
    summary: 'Linear wants to run mcp__linear__create_issue',
    rememberOptions: ['once'],
    ...overrides,
  }
}

function connectorPart(overrides: Record<string, unknown> = {}) {
  return {
    type: 'dynamic-tool',
    toolName: 'mcp__linear__create_issue',
    toolCallId: 'call-1',
    state: 'approval-requested',
    input: { title: 'Bug' },
    approval: { id: 'approval-1' },
    ...overrides,
  }
}

function dataMap(data: ToolApprovalPartData = approvalData()) {
  return new Map([[data.toolCallId, data]])
}

const baseContext: ApprovalStepContext = {
  isLastMessage: true,
  sendingApprovalIds: new Set(),
  answeredApprovalIds: new Set(),
  failures: {},
  isEveryCallAnswered: false,
}

describe('getApprovalStepModel', () => {
  it('reads a waiting connector call with its server data', () => {
    expect(getApprovalStepModel(connectorPart(), dataMap())).toEqual({
      approvalId: 'approval-1',
      toolCallId: 'call-1',
      toolName: 'mcp__linear__create_issue',
      connectorSlug: 'linear',
      isBesidka: false,
      tool: 'create_issue',
      reason: 'always-ask',
      summary: 'Linear wants to run mcp__linear__create_issue',
      rememberOptions: ['once'],
      input: { title: 'Bug' },
      partState: 'approval-requested',
      approved: null,
    })
  })

  it('falls back to the default reason and Allow once without data', () => {
    const model = getApprovalStepModel(connectorPart(), new Map())

    expect(model?.reason).toBe('default')
    expect(model?.rememberOptions).toEqual(['once'])
  })

  it('reads a native tool part', () => {
    const model = getApprovalStepModel({
      type: 'tool-memory_write',
      toolCallId: 'call-2',
      state: 'approval-requested',
      input: { content: 'Likes tea' },
      approval: { id: 'approval-2' },
    }, new Map())

    expect(model).toEqual(expect.objectContaining({
      connectorSlug: null,
      tool: 'memory_write',
    }))
  })

  it('keeps a settled call only when the server wrote approval data', () => {
    const approved = connectorPart({
      state: 'output-available',
      approval: { id: 'approval-1', approved: true },
      output: 'ok',
    })

    expect(getApprovalStepModel(approved, dataMap())?.partState)
      .toBe('output-available')
    expect(getApprovalStepModel(approved, new Map())).toBeNull()
  })

  it('reads a denial', () => {
    const denied = connectorPart({
      state: 'output-denied',
      approval: { id: 'approval-1', approved: false },
    })

    expect(getApprovalStepModel(denied, dataMap())?.approved).toBe(false)
  })

  it('ignores tool parts that never asked', () => {
    expect(getApprovalStepModel({
      type: 'tool-search_chats',
      toolCallId: 'call-3',
      state: 'output-available',
      input: {},
    }, new Map())).toBeNull()
  })

  it('clamps unknown remember options and keeps their order', () => {
    const model = getApprovalStepModel(connectorPart(), dataMap(approvalData({
      rememberOptions: ['always', 'once', 'forever'] as never,
    })))

    expect(model?.rememberOptions).toEqual(['once', 'always'])
  })
})

describe('getApprovalDataByToolCallId', () => {
  it('maps data parts by tool call id', () => {
    const parts = [
      { type: 'data-tool-approval', id: 'call-1', data: approvalData() },
      { type: 'text', text: 'Hi' },
    ] as UIMessage['parts']

    expect(getApprovalDataByToolCallId(parts).get('call-1')?.approvalId)
      .toBe('approval-1')
  })
})

describe('resolveApprovalStepState', () => {
  const model = getApprovalStepModel(connectorPart(), dataMap())!

  it('is pending on the last message', () => {
    expect(resolveApprovalStepState(model, baseContext)).toBe('pending')
  })

  it('is expired on an earlier message', () => {
    expect(resolveApprovalStepState(model, {
      ...baseContext,
      isLastMessage: false,
    })).toBe('expired')
  })

  it('takes the failure the server reported', () => {
    expect(resolveApprovalStepState(model, {
      ...baseContext,
      failures: { 'approval-1': 'interrupted' },
    })).toBe('interrupted')
  })

  it('is answered while other calls still wait', () => {
    const responded = { ...model, partState: 'approval-responded' }

    expect(resolveApprovalStepState(responded, baseContext)).toBe('answered')
  })

  it('is sending while the answers are in flight', () => {
    const responded = { ...model, partState: 'approval-responded' }

    expect(resolveApprovalStepState(responded, {
      ...baseContext,
      sendingApprovalIds: new Set(['approval-1']),
    })).toBe('sending')
    expect(resolveApprovalStepState(responded, {
      ...baseContext,
      isEveryCallAnswered: true,
      answeredApprovalIds: new Set(['approval-1']),
    })).toBe('sending')
  })

  it('is interrupted for an answered call nobody sent in this session', () => {
    const responded = { ...model, partState: 'approval-responded' }

    expect(resolveApprovalStepState(responded, {
      ...baseContext,
      isEveryCallAnswered: true,
    })).toBe('interrupted')
  })

  it('is approved or denied once the call settled', () => {
    expect(resolveApprovalStepState(
      { ...model, partState: 'output-available' },
      baseContext,
    )).toBe('approved')
    expect(resolveApprovalStepState(
      { ...model, partState: 'output-denied' },
      { ...baseContext, isLastMessage: false },
    )).toBe('denied')
  })
})

describe('approval copy', () => {
  const model = getApprovalStepModel(connectorPart(), dataMap())!

  it('names the connector and the tool', () => {
    expect(getApprovalStepTitle(model, 'Linear'))
      .toBe('Linear wants to run create_issue')
    expect(getApprovalStepTitle(model, undefined))
      .toBe('linear wants to run create_issue')
  })

  it('describes native writes in plain words', () => {
    const native = {
      ...model,
      connectorSlug: null,
      tool: 'create_document',
    }

    expect(getApprovalStepTitle(native, undefined)).toBe('Create a document')
    expect(getApprovalStepTitle({ ...native, tool: 'memory_write' }, undefined))
      .toBe('Save to memory')
    expect(getApprovalStepTitle({ ...native, tool: 'besidka__x' }, undefined))
      .toBe('Run besidka__x')
  })

  it('hides summaries that only restate the title', () => {
    expect(getApprovalSummaryLine('Besidka wants to create an artifact'))
      .toBe('')
    expect(getApprovalSummaryLine(
      'Linear wants to run mcp__linear__create_issue',
    )).toBe('')
    expect(getApprovalSummaryLine('Delete 3 chats')).toBe('Delete 3 chats')
  })

  it('gives one reason line per policy reason', () => {
    expect(getApprovalReasonText('untrusted-output', 'Notion'))
      .toBe('Because this message read content from Notion')
    expect(getApprovalReasonText('untrusted-output', ''))
      .toBe('Because this message read content from outside Besidka')
    expect(getApprovalReasonText('cross-source', ''))
      .toBe('Because it would use a different connector')
    expect(getApprovalReasonText('always-ask', ''))
      .toBe('Changes or deletes data')
    expect(getApprovalReasonText('default', ''))
      .toBe('Runs only after you allow it')
  })

  it('titles a Besidka step with its server-written summary', () => {
    const besidkaPart = {
      type: 'tool-besidka__delete_chats',
      toolCallId: 'call-b',
      state: 'approval-requested',
      input: { slugs: ['01HZX'] },
      approval: { id: 'approval-b' },
    }
    const besidka = getApprovalStepModel(besidkaPart, new Map([[
      'call-b',
      approvalData({
        toolCallId: 'call-b',
        toolName: 'besidka__delete_chats',
        summary: 'Delete 1 chat: 01HZX',
      }),
    ]]))!

    expect(besidka).toMatchObject({
      isBesidka: true,
      connectorSlug: null,
      tool: 'delete_chats',
    })
    expect(getApprovalStepTitle(besidka, undefined))
      .toBe('Delete 1 chat: 01HZX')
    expect(getApprovalStepSummaryLine(besidka)).toBe('')
    expect(getApprovalStepTitle({ ...besidka, summary: '' }, undefined))
      .toBe('Besidka wants to delete chats')
    expect(getApprovalStepSummaryLine(model)).toBe('')
    expect(getBesidkaAlwaysConfirmText('list_projects'))
      .toMatch(/^Always allow Besidka to list projects\? /)
  })

  it('names the user\'s Besidka data as the source after a Besidka read',
    () => {
      expect(getApprovalSourceLabel([
        {
          type: 'tool-besidka__list_files',
          toolCallId: 'call-0',
          state: 'output-available',
          input: {},
          output: 'framed',
        },
        connectorPart(),
      ] as unknown as UIMessage['parts'], 1, new Map()))
        .toBe('your Besidka data')
    })

  it('finds the source of untrusted content before the call', () => {
    const parts = [
      {
        type: 'dynamic-tool',
        toolName: 'mcp__notion__search',
        toolCallId: 'call-0',
        state: 'output-available',
        input: {},
        output: 'result',
      },
      connectorPart(),
    ] as unknown as UIMessage['parts']

    expect(getApprovalSourceLabel(parts, 1, new Map([['notion', 'Notion']])))
      .toBe('Notion')
    expect(getApprovalSourceLabel([
      { type: 'source-url', sourceId: 's', url: 'https://example.com' },
      connectorPart(),
    ] as unknown as UIMessage['parts'], 1, new Map())).toBe('the web')
    expect(getApprovalSourceLabel(
      [connectorPart()] as unknown as UIMessage['parts'],
      0,
      new Map(),
    )).toBe('')
  })
})

describe('getApprovalButtons', () => {
  it('offers only what the server allowed, in a fixed order', () => {
    expect(getApprovalButtons(['once'])).toEqual([
      { remember: 'once', label: 'Allow once' },
    ])
    expect(getApprovalButtons(['always', 'chat', 'once'])).toEqual([
      { remember: 'once', label: 'Allow once' },
      { remember: 'chat', label: 'Allow in this chat' },
      { remember: 'always', label: 'Always allow' },
    ])
  })
})

describe('isApprovalInputShortened', () => {
  const model = getApprovalStepModel(connectorPart(), dataMap())!

  it('flags redacted or cut arguments', () => {
    expect(isApprovalInputShortened(model, '{"token":"[redacted]"}'))
      .toBe(true)
    expect(isApprovalInputShortened(model, '{"a":"b…')).toBe(true)
    expect(isApprovalInputShortened(model, '{"a":"b"}')).toBe(false)
  })

  it('flags artifact and document writes, whose stored copy is a summary',
    () => {
      expect(isApprovalInputShortened({
        ...model,
        connectorSlug: null,
        tool: 'create_artifact',
      }, '{"kind":"html"}')).toBe(true)
    })
})

describe('outcome and progress', () => {
  it('adds the time only when it is known', () => {
    expect(formatApprovalOutcome('denied', undefined)).toBe('Denied')
    expect(formatApprovalOutcome('approved', Date.UTC(2026, 10, 15, 9, 5)))
      .toMatch(/^Allowed · \d{1,2}[:.]\d{2}/)
  })

  it('counts answers only with two or more calls', () => {
    expect(formatApprovalProgress(0, 1)).toBe('')
    expect(formatApprovalProgress(1, 2)).toBe('1 of 2 answered')
  })
})

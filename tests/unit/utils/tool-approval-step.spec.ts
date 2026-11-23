import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import type { ToolApprovalPartData } from '#shared/utils/tool-approval-parts'
import { GOOGLE_TOOL_CHAT_GRANT_LABELS } from '#shared/utils/google-tool-approvals'
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
  getAlwaysAllowHint,
  getGrantMarkersByToolCallId,
  getGrantMarkerText,
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
      preview: '',
      input: { title: 'Bug' },
      partState: 'approval-requested',
      approved: null,
    })
  })

  it('keeps only a Google link from the server data', () => {
    const link = 'https://mail.google.com/mail/#all/t1'

    expect(getApprovalStepModel(
      connectorPart(),
      dataMap(approvalData({ link })),
    )?.link).toBe(link)
    expect(getApprovalStepModel(
      connectorPart(),
      dataMap(approvalData({ link: 'https://evil.example/' })),
    )).not.toHaveProperty('link')
  })

  it('keeps the Drive names of the server data only when they are valid',
    () => {
      const names = {
        folder: { name: 'Projects', id: 'folder-id-0123456789' },
      }

      expect(getApprovalStepModel(
        connectorPart(),
        dataMap(approvalData({ driveNames: names })),
      )?.driveNames).toEqual(names)
      expect(getApprovalStepModel(
        connectorPart(),
        dataMap(approvalData({
          driveNames: { folder: { name: 'x', id: 'bad id' } },
        })),
      )).not.toHaveProperty('driveNames')
      expect(getApprovalStepModel(
        connectorPart(),
        dataMap(approvalData({ driveNames: { other: names.folder } })),
      )).not.toHaveProperty('driveNames')
    })

  it('keeps the item, source and target names with a kind and refuses any '
    + 'other kind in the browser too', () => {
    const names = {
      item: { name: 'Plan', id: 'item-id-0123456789', kind: 'folder' },
      from: { name: 'Projects', id: 'folder-id-0123456789' },
      to: { name: 'Archive', id: 'target-id-0123456789' },
    }

    expect(getApprovalStepModel(
      connectorPart(),
      dataMap(approvalData({ driveNames: names })),
    )?.driveNames).toEqual(names)
    expect(getApprovalStepModel(
      connectorPart(),
      dataMap(approvalData({
        driveNames: {
          item: { name: 'Plan', id: 'item-id-0123456789', kind: 'shortcut' },
        },
      })),
    )).not.toHaveProperty('driveNames')
    expect(getApprovalStepModel(
      connectorPart(),
      dataMap(approvalData({
        driveNames: {
          item: { name: 'a'.repeat(201), id: 'item-id-0123456789' },
        },
      })),
    )).not.toHaveProperty('driveNames')
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
    expect(getApprovalStepTitle(
      { ...native, tool: 'run_skill_scripts' },
      undefined,
    )).toBe('Run skill scripts')
  })

  it('keeps the scripts summary as the line under the title', () => {
    expect(getApprovalSummaryLine(
      'Run scripts from data-report in Anthropic\'s container on your key?',
    )).toBe(
      'Run scripts from data-report in Anthropic\'s container on your key?',
    )
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
    expect(getApprovalReasonText('consent', ''))
      .toBe('Uploads the skill to your Anthropic workspace')
    expect(getApprovalReasonText('default', ''))
      .toBe('Runs only after you allow it')
    expect(getApprovalReasonText('default', '', 'mcp__notion__notion-search'))
      .toBe('Asks before each use. Change it in the connector\'s tool '
        + 'settings.')
    expect(getApprovalReasonText('default', '', 'besidka__list_files'))
      .toBe('Asks before each use. Change it in Tool permissions in Labs.')
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
    expect(getAlwaysAllowHint(true)).toBe(
      'Runs without asking in every chat. Change it in Tool permissions.',
    )
    expect(getAlwaysAllowHint(false)).toContain('until the tool changes')
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

describe('Google approvals', () => {
  function googleModel(overrides: Record<string, unknown> = {}) {
    return getApprovalStepModel(
      connectorPart({
        toolName: 'google__drive_search',
        ...overrides,
      }),
      dataMap(approvalData({
        toolName: 'google__drive_search',
        reason: 'default',
        summary: 'Besidka wants to search Google Drive',
        rememberOptions: ['once', 'chat'],
      })),
    )!
  }

  it('says that Google content may go to the connector', () => {
    expect(getApprovalReasonText('google-egress', 'Notion',
      'mcp__linear__create_issue'))
      .toBe('Content from Google in this chat may be sent to this connector')
  })

  it('shows the egress prompt without Always allow', () => {
    const model = getApprovalStepModel(
      connectorPart(),
      dataMap(approvalData({
        reason: 'google-egress',
        rememberOptions: ['once', 'chat'],
      })),
    )!

    expect(model.reason).toBe('google-egress')
    expect(getApprovalButtons(model.rememberOptions).map((button) => {
      return button.remember
    })).toEqual(['once', 'chat'])
  })

  it('titles a Google tool with its server-written summary', () => {
    const model = googleModel()

    expect(getApprovalStepTitle(model, undefined))
      .toBe('Besidka wants to search Google Drive')
    expect(getApprovalStepTitle({ ...model, summary: '' }, undefined))
      .toBe('Besidka wants to drive search on Google')
    expect(getApprovalStepSummaryLine(model)).toBe('')
    expect(getApprovalButtons(model.rememberOptions).map((button) => {
      return button.remember
    })).toEqual(['once', 'chat'])
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

describe('getApprovalButtons for a Google Drive tool', () => {
  it('keeps the short label and says what Allow in this chat covers for the '
    + 'read and the list in the accessible name, with Allow once first', () => {
    expect(getApprovalButtons(['once', 'chat'], 'google__drive_read_file'))
      .toEqual([
        { remember: 'once', label: 'Allow once' },
        {
          remember: 'chat',
          label: 'Allow in this chat',
          ariaLabel: 'Allow in this chat: reading any file you picked from '
            + 'Google Drive',
        },
      ])
    expect(getApprovalButtons(['once', 'chat'], 'google__drive_list_picked')[1])
      .toMatchObject({
        label: 'Allow in this chat',
        ariaLabel: 'Allow in this chat: listing the files you picked from '
          + 'Google Drive',
      })
  })

  it('starts the accessible name with the visible label for every Google '
    + 'chat grant', () => {
    for (const toolName of Object.keys(GOOGLE_TOOL_CHAT_GRANT_LABELS)) {
      const chatButton = getApprovalButtons(['once', 'chat'], toolName)[1]!

      expect(chatButton.ariaLabel?.startsWith(`${chatButton.label}: `))
        .toBe(true)
      expect(chatButton.ariaLabel).not.toMatch(/ in this chat$/)
    }
  })

  it('leaves every other tool, and the write, without an accessible name', () => {
    expect(getApprovalButtons(['once', 'chat'], 'google__docs_lookup')[1])
      .toEqual({ remember: 'chat', label: 'Allow in this chat' })
    expect(getApprovalButtons(['once'], 'google__drive_save_file'))
      .toEqual([{ remember: 'once', label: 'Allow once' }])
    expect(getApprovalButtons(['once', 'chat'])[1])
      .toMatchObject({ label: 'Allow in this chat' })
    expect(getApprovalButtons(['once', 'chat'], 'constructor')[1])
      .toMatchObject({ label: 'Allow in this chat' })
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

describe('getGrantMarkersByToolCallId', () => {
  function grantPart(toolCallId: string, scope: 'chat' | 'always') {
    return {
      type: 'data-tool-grant',
      id: `grant-${toolCallId}`,
      data: { toolCallId, toolName: 'mcp__linear__create_issue', scope },
    }
  }

  it('matches getGrantMarkerText for every call, first grant wins', () => {
    const parts = [
      grantPart('call-1', 'always'),
      { type: 'text', text: 'between' },
      grantPart('call-2', 'chat'),
      grantPart('call-1', 'chat'),
    ] as unknown as UIMessage['parts']
    const markers = getGrantMarkersByToolCallId(parts)

    expect(markers.get('call-1')).toBe(getGrantMarkerText(parts, 'call-1'))
    expect(markers.get('call-1')).toBe('Ran without asking (Always allowed)')
    expect(markers.get('call-2'))
      .toBe('Ran without asking (Allowed in this chat)')
    expect(markers.has('call-3')).toBe(false)
  })
})

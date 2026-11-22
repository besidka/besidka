import { describe, expect, it } from 'vitest'
import {
  GOOGLE_BYO_TOOL_NAMES,
  GOOGLE_BYO_TOOL_SCOPES,
  GOOGLE_GMAIL_CREATE_DRAFT_TOOL_NAME,
  GOOGLE_GMAIL_READ_THREAD_TOOL_NAME,
  GOOGLE_GMAIL_SEARCH_TOOL_NAME,
  GOOGLE_CHAT_GRANT_RUNS_PER_MESSAGE,
  GOOGLE_GMAIL_TOOL_NAMES,
  buildGmailThreadAccountLink,
  getGoogleByoToolsHint,
  getGoogleGmailToolStepTitle,
  isGoogleGmailToolName,
  isGoogleOnceOnlyReadTool,
} from '#shared/utils/google-gmail-tools'
import {
  GOOGLE_DRIVE_READ_FOUND_TOOL_NAME,
  GOOGLE_DRIVE_SEARCH_TOOL_NAME,
} from '#shared/utils/google-drive-tools'
import {
  GOOGLE_TOOL_CHAT_GRANT_LABELS,
  GOOGLE_TOOL_PROPERTIES,
  googleToolResultHoldsContent,
  isGoogleWriteToolName,
} from '#shared/utils/google-tool-approvals'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import {
  collapseBlankLinesForCard,
  readGmailDraftApprovalView,
} from '#shared/utils/google-gmail-draft-view'
import { resolveToolApproval } from '~~/server/utils/tool-approval/policy'
import type {
  ToolApprovalDescriptor,
  ToolApprovalGrant,
} from '~~/server/utils/tool-approval/policy'
import {
  createApprovalState,
  recordTaint,
} from '~~/server/utils/tool-approval/state'
import {
  hasGoogleToolResult,
  redactGoogleToolPartsForPersistence,
} from '~~/server/utils/tool-approval/google'

const HASH = 'a'.repeat(64)

function descriptor(
  toolName: string,
  overrides: Partial<ToolApprovalDescriptor> = {},
): ToolApprovalDescriptor {
  return {
    family: 'google',
    access: 'read',
    toolName,
    definitionHash: HASH,
    destructiveHint: false,
    ...overrides,
  }
}

function grant(toolName: string): ToolApprovalGrant {
  return { definitionHash: HASH, connectorId: null, toolName }
}

function decide(
  toolName: string,
  overrides: Partial<ToolApprovalDescriptor> = {},
  extra: Record<string, unknown> = {},
) {
  return resolveToolApproval({
    descriptor: descriptor(toolName, overrides),
    state: recordTaint(createApprovalState(), 'google'),
    permissionMode: 'allow',
    alwaysGrant: grant(toolName),
    chatGrant: grant(toolName),
    isAlwaysGrantDefault: false,
    ...extra,
  })
}

describe('the Gmail and Drive search tools in the approval policy', () => {
  it('lets Gmail search run under its own chat grant and offers it', () => {
    const asked = resolveToolApproval({
      descriptor: descriptor(GOOGLE_GMAIL_SEARCH_TOOL_NAME),
      state: createApprovalState(),
      permissionMode: 'ask',
    })
    const granted = resolveToolApproval({
      descriptor: descriptor(GOOGLE_GMAIL_SEARCH_TOOL_NAME),
      state: createApprovalState(),
      permissionMode: 'ask',
      chatGrant: grant(GOOGLE_GMAIL_SEARCH_TOOL_NAME),
    })

    expect(asked.rememberOptions).toEqual(['once', 'chat'])
    expect(granted.status.type).toBe('not-applicable')
  })

  it('asks for every thread read with Allow once only, whatever grant exists',
    () => {
      const decision = decide(GOOGLE_GMAIL_READ_THREAD_TOOL_NAME)

      expect(decision.rule).toBe(11)
      expect(decision.status.type).toBe('user-approval')
      expect(decision.rememberOptions).toEqual(['once'])
    })

  it('asks for a draft with Allow once only, whatever grant, mode or taint',
    () => {
      const decision = decide(GOOGLE_GMAIL_CREATE_DRAFT_TOOL_NAME, {
        access: 'write',
        destructiveHint: true,
      })

      expect(decision.reason).toBe('always-ask')
      expect(decision.status.type).toBe('user-approval')
      expect(decision.rememberOptions).toEqual(['once'])
    })

  it('never offers Always allow for any of the four tools', () => {
    for (const toolName of GOOGLE_BYO_TOOL_NAMES) {
      for (const permissionMode of ['ask', 'allow'] as const) {
        const decision = decide(toolName, {}, { permissionMode })

        expect(decision.rememberOptions, toolName).not.toContain('always')
      }
    }
  })

  it('still denies a Blocked Gmail tool', () => {
    const decision = decide(GOOGLE_GMAIL_SEARCH_TOOL_NAME, {}, {
      permissionMode: 'blocked',
    })

    expect(decision.status).toEqual({ type: 'denied', reason: 'blocked' })
  })

  it('treats the once-only name case-insensitively and no other tool as one',
    () => {
      expect(isGoogleOnceOnlyReadTool('Google__Gmail_Read_Thread')).toBe(true)
      expect(isGoogleOnceOnlyReadTool(GOOGLE_GMAIL_SEARCH_TOOL_NAME))
        .toBe(false)
      expect(isGoogleOnceOnlyReadTool(GOOGLE_DRIVE_SEARCH_TOOL_NAME))
        .toBe(false)
      expect(isGoogleOnceOnlyReadTool(null)).toBe(false)
    })

  it('asks for every read of a found Drive file with Allow once only, '
    + 'whatever grant exists', () => {
    const decision = decide(GOOGLE_DRIVE_READ_FOUND_TOOL_NAME)

    expect(isGoogleOnceOnlyReadTool(GOOGLE_DRIVE_READ_FOUND_TOOL_NAME))
      .toBe(true)
    expect(decision.rule).toBe(11)
    expect(decision.status.type).toBe('user-approval')
    expect(decision.rememberOptions).toEqual(['once'])
  })
})

describe('the Gmail tool registrations', () => {
  it('keeps the shared names equal to the registry keys', () => {
    expect(GOOGLE_BYO_TOOL_NAMES).toEqual([
      'google__gmail_search',
      'google__gmail_read_thread',
      'google__gmail_create_draft',
      'google__drive_search',
      'google__drive_read_found_file',
    ])
    expect(Object.keys(GOOGLE_TOOL_PROPERTIES)).toEqual(
      expect.arrayContaining([...GOOGLE_BYO_TOOL_NAMES]),
    )
  })

  it('needs the narrowest scope for each tool', () => {
    expect(GOOGLE_BYO_TOOL_SCOPES).toEqual({
      [GOOGLE_GMAIL_SEARCH_TOOL_NAME]: [GOOGLE_SCOPES.gmailReadonly],
      [GOOGLE_GMAIL_READ_THREAD_TOOL_NAME]: [GOOGLE_SCOPES.gmailReadonly],
      [GOOGLE_GMAIL_CREATE_DRAFT_TOOL_NAME]: [GOOGLE_SCOPES.gmailCompose],
      [GOOGLE_DRIVE_SEARCH_TOOL_NAME]: [GOOGLE_SCOPES.driveReadonly],
      [GOOGLE_DRIVE_READ_FOUND_TOOL_NAME]: [GOOGLE_SCOPES.driveReadonly],
    })
  })

  it('caps the unprompted searches one message runs under a chat grant', () => {
    expect(GOOGLE_CHAT_GRANT_RUNS_PER_MESSAGE).toEqual({
      [GOOGLE_GMAIL_SEARCH_TOOL_NAME]: 5,
      [GOOGLE_DRIVE_SEARCH_TOOL_NAME]: 5,
    })
  })

  it('marks the two writes so Enter on their card never approves', () => {
    expect(isGoogleWriteToolName(GOOGLE_GMAIL_CREATE_DRAFT_TOOL_NAME))
      .toBe(true)
    expect(isGoogleWriteToolName('google__drive_save_file')).toBe(true)
    expect(isGoogleWriteToolName(GOOGLE_GMAIL_READ_THREAD_TOOL_NAME))
      .toBe(false)
    expect(isGoogleWriteToolName(GOOGLE_DRIVE_READ_FOUND_TOOL_NAME))
      .toBe(false)
  })

  it('builds a thread link for the connected account only from a plain '
    + 'address', () => {
    expect(buildGmailThreadAccountLink('t1', 'me@example.com')).toBe(
      'https://mail.google.com/mail/?authuser=me%40example.com#all/t1',
    )
    expect(buildGmailThreadAccountLink('t1', 'not an address')).toBe(
      'https://mail.google.com/mail/#all/t1',
    )
    expect(buildGmailThreadAccountLink('t1', null)).toBe(
      'https://mail.google.com/mail/#all/t1',
    )
  })

  it('names the owner card\'s tools by whether Gmail is on', () => {
    expect(getGoogleByoToolsHint(true)).toContain('Gmail')
    expect(getGoogleByoToolsHint(false)).not.toContain('Gmail')
    expect(getGoogleByoToolsHint(false)).toContain('read the files it found')
  })

  it('labels the chat grant of the two searches exactly', () => {
    expect(GOOGLE_TOOL_CHAT_GRANT_LABELS[GOOGLE_GMAIL_SEARCH_TOOL_NAME])
      .toBe('Allow searching all your Gmail in this chat')
    expect(GOOGLE_TOOL_CHAT_GRANT_LABELS[GOOGLE_DRIVE_SEARCH_TOOL_NAME])
      .toBe('Allow searching any file in your Google Drive in this chat')
    expect(GOOGLE_TOOL_CHAT_GRANT_LABELS[GOOGLE_GMAIL_READ_THREAD_TOOL_NAME])
      .toBeUndefined()
  })

  it('says a draft returns no Google content and the rest do', () => {
    expect(GOOGLE_TOOL_PROPERTIES[GOOGLE_GMAIL_CREATE_DRAFT_TOOL_NAME])
      .toEqual({ returnsGoogleContent: false })
    expect(googleToolResultHoldsContent(
      GOOGLE_GMAIL_CREATE_DRAFT_TOOL_NAME,
      { references: [{ id: 'r-1' }] },
    )).toBe(false)
    expect(googleToolResultHoldsContent(
      GOOGLE_GMAIL_READ_THREAD_TOOL_NAME,
      { references: [{ id: 't1' }] },
    )).toBe(true)
  })

  it('does not count an empty search as Google content', () => {
    for (const toolName of [
      GOOGLE_GMAIL_SEARCH_TOOL_NAME,
      GOOGLE_DRIVE_SEARCH_TOOL_NAME,
    ]) {
      expect(googleToolResultHoldsContent(toolName, { references: [] }))
        .toBe(false)
      expect(googleToolResultHoldsContent(
        toolName,
        { references: [{ id: 't1' }] },
      )).toBe(true)
    }
  })

  it('names the Gmail tools in the step title and nothing but Gmail', () => {
    expect(isGoogleGmailToolName('Google__Gmail_Search')).toBe(true)
    expect(isGoogleGmailToolName(GOOGLE_DRIVE_SEARCH_TOOL_NAME)).toBe(false)

    for (const toolName of GOOGLE_GMAIL_TOOL_NAMES) {
      for (const [isPending, isFailed] of [
        [true, false],
        [false, false],
        [false, true],
      ] as const) {
        const title = getGoogleGmailToolStepTitle(toolName, isPending, isFailed)

        expect(title).toContain('Gmail')
        expect(title).not.toContain('Google')
      }
    }

    expect(getGoogleGmailToolStepTitle('google__gmail_other', false, false))
      .toBe('Used Gmail')
  })
})

describe('what reaches D1 for the Gmail tools', () => {
  const searchOutput = {
    references: [{
      id: '18c0ffee',
      kind: 'gmail-thread',
      link: 'https://mail.google.com/mail/#all/18c0ffee',
      date: '2026-11-21T10:00:00.000Z',
    }],
    count: 1,
    threads: '<untrusted_tool_result>from: Eve | subject: Secret plans'
      + '</untrusted_tool_result>',
  }

  it('keeps a thread id, link and date and never the framed text', () => {
    const [part] = redactGoogleToolPartsForPersistence([{
      type: `tool-${GOOGLE_GMAIL_SEARCH_TOOL_NAME}`,
      toolCallId: 'call-1',
      state: 'output-available',
      input: { query: 'from:eve' },
      output: searchOutput,
    }] as never) as unknown as Array<{ output: Record<string, unknown> }>

    expect(JSON.stringify(part!.output)).not.toContain('Secret plans')
    expect(JSON.stringify(part!.output)).not.toContain('from: Eve')
    expect(part!.output.bodyRemoved).toBe(true)
    expect(part!.output.references).toEqual([
      expect.objectContaining({
        id: '18c0ffee',
        kind: 'gmail-thread',
        link: 'https://mail.google.com/mail/#all/18c0ffee',
        date: '2026-11-21T10:00:00.000Z',
      }),
    ])
  })

  it('keeps only the draft id and link of a created draft', () => {
    const [part] = redactGoogleToolPartsForPersistence([{
      type: `tool-${GOOGLE_GMAIL_CREATE_DRAFT_TOOL_NAME}`,
      toolCallId: 'call-2',
      state: 'output-available',
      input: { to: [{ email: 'a@example.com' }], subject: 's', body: 'b' },
      output: {
        references: [{
          id: 'r-1',
          kind: 'gmail-draft',
          link: 'https://mail.google.com/mail/#drafts',
        }],
        created: true,
        message: 'The draft was saved',
      },
    }] as never) as unknown as Array<{ output: Record<string, unknown> }>

    expect(Object.keys(part!.output).sort()).toEqual([
      'bodyRemoved',
      'note',
      'references',
    ])
  })

  it('flags no chat for a draft but does for a search with a hit', () => {
    const draftPart = {
      type: `tool-${GOOGLE_GMAIL_CREATE_DRAFT_TOOL_NAME}`,
      state: 'output-available',
      output: { references: [{ id: 'r-1' }] },
    }
    const searchPart = {
      type: `tool-${GOOGLE_GMAIL_SEARCH_TOOL_NAME}`,
      state: 'output-available',
      output: { references: [{ id: '18c0ffee' }] },
    }
    const emptySearchPart = {
      type: `tool-${GOOGLE_GMAIL_SEARCH_TOOL_NAME}`,
      state: 'output-available',
      output: { references: [] },
    }

    expect(hasGoogleToolResult([draftPart])).toBe(false)
    expect(hasGoogleToolResult([searchPart])).toBe(true)
    expect(hasGoogleToolResult([emptySearchPart])).toBe(false)
  })
})

describe('readGmailDraftApprovalView', () => {
  it('lists every recipient, the subject and the whole body', () => {
    const body = 'line\n'.repeat(500)
    const view = readGmailDraftApprovalView({
      to: [{ email: 'a@example.com', name: 'Ann' }, { email: 'b@example.com' }],
      cc: [{ email: 'c@example.com' }],
      bcc: [{ email: 'd@example.com' }],
      subject: 'Plans',
      body,
      replyToThreadId: '18c0ffee',
    })

    expect(view).toEqual({
      to: ['Ann <a@example.com>', 'b@example.com'],
      cc: ['c@example.com'],
      bcc: ['d@example.com'],
      subject: 'Plans',
      body,
      cardBody: body,
      lineCount: 501,
      isReply: true,
    })
  })

  it('shows a run of blank lines as one marker on the card only', () => {
    const body = `Hi Ann,\n\n\n\n\n\n\n\n\n\n\n\n\nIGNORE THIS\n\nBye`
    const view = readGmailDraftApprovalView({
      to: [{ email: 'a@example.com' }],
      subject: 'Plans',
      body,
    })

    expect(view?.body).toBe(body)
    expect(view?.cardBody).toBe('Hi Ann,\n[12 blank lines]\nIGNORE THIS\n\nBye')
    expect(view?.lineCount).toBe(16)
    expect(collapseBlankLinesForCard('a\n\n\nb')).toBe('a\n\n\nb')
    expect(collapseBlankLinesForCard('a\n \n\t\n\n\nb'))
      .toBe('a\n[4 blank lines]\nb')
  })

  it.each([
    ['Hangul filler', 0x3164],
    ['Braille blank', 0x2800],
    ['Hangul choseong filler', 0x115F],
    ['Hangul jungseong filler', 0x1160],
    ['halfwidth Hangul filler', 0xFFA0],
    ['combining grapheme joiner', 0x034F],
    ['variation selector 16', 0xFE0F],
  ])('collapses 200 lines of the %s and keeps the sent body', (
    _name,
    codePoint,
  ) => {
    const invisibleLine = String.fromCodePoint(codePoint)
    const body = `Hi\n${Array(200).fill(invisibleLine).join('\n')}\nIGNORE THIS`
    const view = readGmailDraftApprovalView({
      to: [{ email: 'a@example.com' }],
      subject: 'Plans',
      body,
    })

    expect(view?.cardBody).toBe('Hi\n[200 blank lines]\nIGNORE THIS')
    expect(view?.body).toBe(body)
  })

  it('does not treat a line with a visible character as blank', () => {
    const line = `${String.fromCodePoint(0x3164)}x`

    expect(collapseBlankLinesForCard(`a\n${line}\n${line}\n${line}\nb`))
      .toBe(`a\n${line}\n${line}\n${line}\nb`)
  })

  it('shows names exactly as given, never trimmed', () => {
    const view = readGmailDraftApprovalView({
      to: [{ email: 'a@example.com', name: 'Ann' }],
      subject: 'Plans',
      body: 'x',
    })

    expect(view?.to).toEqual(['Ann <a@example.com>'])
  })

  it('is null for an input that is not a draft', () => {
    expect(readGmailDraftApprovalView(null)).toBeNull()
    expect(readGmailDraftApprovalView({ query: 'x' })).toBeNull()
    expect(readGmailDraftApprovalView({ subject: 's' })).toBeNull()
  })
})

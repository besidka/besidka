import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  describeGoogleStepReference,
  getGoogleStepData,
} from '../../../app/utils/google-step'
import { resolveReasoningStepSource } from '../../../app/utils/reasoning-step-icons'
import { getToolStepTitle } from '../../../app/utils/reasoning'
import {
  getApprovalButtons,
  getApprovalStepSummaryLine,
  getApprovalStepTitle,
} from '../../../app/utils/tool-approval-step'
import {
  GOOGLE_BYO_TOOL_NAMES,
  GOOGLE_GMAIL_TOOL_NAMES,
} from '#shared/utils/google-gmail-tools'
import {
  GOOGLE_DRIVE_ICON,
  GOOGLE_GMAIL_ICON,
} from '#shared/utils/google-brand-icons'

type Part = UIMessage['parts'][number]

function part(overrides: Record<string, unknown>): Part {
  return {
    type: 'tool-google__gmail_search',
    toolCallId: 'call-1',
    state: 'output-available',
    input: { query: 'x' },
    ...overrides,
  } as unknown as Part
}

const THREAD_LINK = 'https://mail.google.com/mail/#all/18c0ffee'

describe('Gmail reasoning steps', () => {
  it('names Gmail in the title and never Google', () => {
    expect(getToolStepTitle('google__gmail_search', false, false))
      .toBe('Searched Gmail')
    expect(getToolStepTitle('google__gmail_read_thread', true, false))
      .toBe('Reading an email thread in Gmail')
    expect(getToolStepTitle('google__gmail_create_draft', false, true))
      .toBe('Creating a draft in Gmail failed')
    expect(getToolStepTitle('google__drive_search', false, false))
      .toBe('Searched Google Drive')

    for (const toolName of GOOGLE_GMAIL_TOOL_NAMES) {
      expect(getToolStepTitle(toolName, false, false)).not.toContain('Google')
    }
  })

  it('uses the official Gmail mark for Gmail and the Drive mark for the '
    + 'Drive tools', () => {
    for (const toolName of GOOGLE_GMAIL_TOOL_NAMES) {
      expect(resolveReasoningStepSource({ toolName, title: 'x' }).icon)
        .toEqual({ kind: 'iconify', name: GOOGLE_GMAIL_ICON })
    }

    for (const toolName of [
      'google__drive_search',
      'google__drive_read_found_file',
    ]) {
      expect(resolveReasoningStepSource({ toolName, title: 'x' }).icon)
        .toEqual({ kind: 'iconify', name: GOOGLE_DRIVE_ICON })
    }

    expect(getToolStepTitle('google__drive_read_found_file', false, false))
      .toBe('Read a found file from Google Drive')
  })

  it('titles the approval with its server summary and shows no extra line',
    () => {
      const model = {
        toolName: 'google__gmail_create_draft',
        tool: 'google__gmail_create_draft',
        summary: 'Create a Gmail draft "Plans" to a@example.com',
        isBesidka: false,
        connectorSlug: null,
      } as never

      expect(getApprovalStepTitle(model, undefined))
        .toBe('Create a Gmail draft "Plans" to a@example.com')
      expect(getApprovalStepSummaryLine(model)).toBe('')
    })

  it('offers the chat option for a search and never for a thread read or '
    + 'a draft', () => {
    const search = getApprovalButtons(['once', 'chat'], 'google__gmail_search')
    const read = getApprovalButtons(['once'], 'google__gmail_read_thread')
    const draft = getApprovalButtons(['once'], 'google__gmail_create_draft')

    expect(search.map(button => button.label)).toEqual([
      'Allow once',
      'Allow searching all your Gmail in this chat',
    ])
    expect(read.map(button => button.remember)).toEqual(['once'])
    expect(draft.map(button => button.remember)).toEqual(['once'])
  })

  it('has a title for every bring-your-own tool', () => {
    for (const toolName of GOOGLE_BYO_TOOL_NAMES) {
      expect(getToolStepTitle(toolName, false, false)).not.toMatch(/^Used /)
    }
  })
})

describe('Gmail references after a reload', () => {
  it('reads a thread reference with no title, sender or subject', () => {
    const data = getGoogleStepData(part({
      output: {
        references: [{
          id: '18c0ffee',
          kind: 'gmail-thread',
          link: THREAD_LINK,
          date: '2026-11-21T10:00:00.000Z',
        }],
        bodyRemoved: true,
        note: 'The content was not kept.',
      },
    }))

    expect(data?.references).toEqual([{
      id: '18c0ffee',
      kind: 'gmail-thread',
      title: '',
      link: THREAD_LINK,
      date: '2026-11-21T10:00:00.000Z',
    }])
    expect(describeGoogleStepReference(data!.references[0]!)).toEqual({
      text: 'Email thread from 2026-11-21',
      linkText: 'Open in Gmail',
      linkLabel: 'Open the email thread from 2026-11-21 in Gmail',
    })
  })

  it('describes a thread without a date, a draft and a Drive file', () => {
    const base = { id: 'a', title: '', link: '', date: '' }

    expect(describeGoogleStepReference({ ...base, kind: 'gmail-thread' }))
      .toMatchObject({
        text: 'Email thread',
        linkLabel: 'Open the email thread in Gmail',
      })
    expect(describeGoogleStepReference({ ...base, kind: 'gmail-draft' }))
      .toEqual({
        text: 'Draft saved in Gmail',
        linkText: 'Open drafts in Gmail',
        linkLabel: 'Open your drafts in Gmail',
      })
    expect(describeGoogleStepReference({
      ...base,
      kind: 'drive-file',
      title: 'Plan.md',
    })).toEqual({
      text: 'Plan.md',
      linkText: 'Open in Google Drive',
      linkLabel: 'Open Plan.md in Google Drive',
    })
    expect(describeGoogleStepReference({ ...base, kind: '' }).text)
      .toBe('Google Drive file')
  })

  it('ignores a date that is not an ISO day', () => {
    expect(describeGoogleStepReference({
      id: 'a',
      kind: 'gmail-thread',
      title: '',
      link: '',
      date: 'Fri, 21 Nov 2025 <script>',
    }).text).toBe('Email thread')
  })
})

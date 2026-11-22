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
import { GOOGLE_CALENDAR_TOOL_NAMES } from '#shared/utils/google-calendar-tools'
import { GOOGLE_CALENDAR_ICON } from '#shared/utils/google-brand-icons'
import { withoutReferenceNames } from '#shared/utils/google-tool-approvals'

type Part = UIMessage['parts'][number]

function part(overrides: Record<string, unknown>): Part {
  return {
    type: 'tool-google__calendar_list_events',
    toolCallId: 'call-1',
    state: 'output-available',
    input: {},
    ...overrides,
  } as unknown as Part
}

const EVENT_LINK = 'https://www.google.com/calendar/event?eid=YWJjZGVmZ2hp'

describe('Calendar reasoning steps', () => {
  it('names Google Calendar in every title, with no event text', () => {
    expect(getToolStepTitle('google__calendar_list_events', false, false))
      .toBe('Read Google Calendar')
    expect(getToolStepTitle('google__calendar_free_busy', true, false))
      .toBe('Checking free and busy time in Google Calendar')
    expect(getToolStepTitle('google__calendar_create_event', false, true))
      .toBe('Creating an event in Google Calendar failed')

    for (const toolName of GOOGLE_CALENDAR_TOOL_NAMES) {
      expect(getToolStepTitle(toolName, false, false))
        .toContain('Google Calendar')
    }
  })

  it('uses the official Google Calendar mark for every Calendar tool',
    () => {
      for (const toolName of GOOGLE_CALENDAR_TOOL_NAMES) {
        expect(resolveReasoningStepSource({ toolName, title: 'x' }).icon)
          .toEqual({ kind: 'iconify', name: GOOGLE_CALENDAR_ICON })
      }

      expect(GOOGLE_CALENDAR_ICON).toBe('logos:google-calendar')
    })

  it('titles the approval with its server summary and shows no extra line',
    () => {
      const model = {
        toolName: 'google__calendar_create_event',
        tool: 'google__calendar_create_event',
        summary: 'Create the Google Calendar event "Planning" on 2026-12-01',
        isBesidka: false,
        connectorSlug: null,
      } as never

      expect(getApprovalStepTitle(model, undefined))
        .toBe('Create the Google Calendar event "Planning" on 2026-12-01')
      expect(getApprovalStepSummaryLine(model)).toBe('')
    })

  it('offers the chat option for the two reads and never for the write', () => {
    const list = getApprovalButtons(['once', 'chat'], 'google__calendar_list_events')
    const busy = getApprovalButtons(['once', 'chat'], 'google__calendar_free_busy')
    const write = getApprovalButtons(['once'], 'google__calendar_create_event')

    expect(list.map(button => button.label)).toEqual([
      'Allow once',
      'Allow in this chat',
    ])
    expect(list[1]!.ariaLabel)
      .toBe('Allow reading events on your Google Calendar in this chat')
    expect(busy.map(button => button.label)).toEqual([
      'Allow once',
      'Allow in this chat',
    ])
    expect(busy[1]!.ariaLabel).toBe(
      'Allow checking when you are busy in your Google Calendar in this chat',
    )
    expect(write.map(button => button.remember)).toEqual(['once'])
  })

  it('has a title for every Calendar tool', () => {
    for (const toolName of GOOGLE_CALENDAR_TOOL_NAMES) {
      expect(getToolStepTitle(toolName, false, false)).not.toMatch(/^Used /)
    }
  })
})

describe('Calendar references after a reload', () => {
  it('reads an event reference by its day, with no title or guest', () => {
    const data = getGoogleStepData(part({
      output: {
        references: [{
          id: 'abc123def456',
          kind: 'calendar-event',
          link: EVENT_LINK,
          date: '2026-12-01',
        }],
        bodyRemoved: true,
        note: 'The content was not kept.',
      },
    }))

    expect(data!.references).toHaveLength(1)
    expect(describeGoogleStepReference(data!.references[0]!)).toEqual({
      text: 'Calendar event on 2026-12-01',
      linkText: 'Open in Google Calendar',
      linkLabel: 'Open the event on 2026-12-01 in Google Calendar',
    })
    expect(data!.references[0]!.link).toBe(EVENT_LINK)
  })

  it('reads an event reference with no day plainly', () => {
    const data = getGoogleStepData(part({
      output: {
        references: [{ id: 'abc', kind: 'calendar-event' }],
        bodyRemoved: true,
      },
    }))

    expect(describeGoogleStepReference(data!.references[0]!)).toEqual({
      text: 'Calendar event',
      linkText: 'Open in Google Calendar',
      linkLabel: 'Open the event in Google Calendar',
    })
  })

  it('reads a free and busy reference by the day it starts', () => {
    const data = getGoogleStepData(part({
      type: 'tool-google__calendar_free_busy',
      output: {
        references: [{
          id: 'free-busy-2026-12-01',
          kind: 'calendar-free-busy',
          link: 'https://calendar.google.com/calendar/r/day/2026/12/1',
          date: '2026-12-01',
        }],
        bodyRemoved: true,
      },
    }))

    expect(describeGoogleStepReference(data!.references[0]!)).toEqual({
      text: 'Free and busy times from 2026-12-01',
      linkText: 'Open in Google Calendar',
      linkLabel: 'Open 2026-12-01 in Google Calendar',
    })
  })

  it('keeps a http link out of a reference', () => {
    const data = getGoogleStepData(part({
      output: {
        references: [{
          id: 'abc',
          kind: 'calendar-event',
          link: 'http://www.google.com/calendar/event?eid=abc',
          date: '2026-12-01',
        }],
        bodyRemoved: true,
      },
    }))

    expect(data!.references[0]!.link).toBe('')
  })

  it('hands the model only an id, a kind and a day for a stored event',
    () => {
      expect(withoutReferenceNames({
        references: [{
          id: 'abc123def456',
          kind: 'calendar-event',
          link: EVENT_LINK,
          date: '2026-12-01',
          title: 'Quarterly layoffs review',
        }],
      })).toEqual({
        references: [{
          id: 'abc123def456',
          kind: 'calendar-event',
          date: '2026-12-01',
        }],
      })
    })
})

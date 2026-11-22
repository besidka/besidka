import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCalendarInsertPayload } from '~~/server/utils/google/calendar-api'
import { validateCalendarEvent } from '#shared/utils/google-calendar-event'
import { chatHoldsGoogleData } from '~~/server/utils/tool-approval/google'

const ROOT = process.cwd()

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(join(ROOT, directory)).flatMap((name) => {
    const path = join(directory, name)

    return statSync(join(ROOT, path)).isDirectory()
      ? sourceFilesUnder(path)
      : /\.(ts|vue)$/.test(name) ? [path] : []
  })
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

describe('the share dialog names for Calendar references', () => {
  it('names an event by its start day, distinct when two share a day',
    async () => {
      const { listChatGoogleItemNames } = await import(
        '~~/server/utils/google/data-guard'
      )
      const names = await listChatGoogleItemNames({
        db: {
          query: {
            messages: {
              findMany: async () => [{
                parts: [
                  {
                    type: 'tool-google__calendar_list_events',
                    state: 'output-available',
                    output: {
                      references: [
                        { id: 'e1', kind: 'calendar-event', date: '2026-12-01' },
                        { id: 'e2', kind: 'calendar-event', date: '2026-12-01' },
                        { id: 'e3', kind: 'calendar-event', date: '2026-12-02' },
                        { id: 'e4', kind: 'calendar-event' },
                        {
                          id: 'e5',
                          kind: 'calendar-event',
                          date: 'not a day',
                        },
                      ],
                    },
                  },
                  {
                    type: 'tool-google__calendar_create_event',
                    state: 'output-available',
                    output: {
                      references: [
                        { id: 'e1', kind: 'calendar-event', date: '2026-12-01' },
                      ],
                    },
                  },
                  {
                    type: 'tool-google__calendar_free_busy',
                    state: 'output-available',
                    output: {
                      references: [{
                        id: 'free-busy-2026-12-01',
                        kind: 'calendar-free-busy',
                        date: '2026-12-01',
                      }],
                    },
                  },
                ],
              }],
            },
          },
        } as never,
        userId: 1,
        chatId: 'chat-1',
      })

      expect(names).toEqual([
        'Calendar event on 2026-12-01',
        'Calendar event on 2026-12-01 (2)',
        'Calendar event on 2026-12-02',
        'Calendar event',
        'Calendar event (2)',
        'Free and busy times from 2026-12-01',
      ])
    })
})

describe('the Calendar boundary', () => {
  it('has a Calendar API module that can only list, query and insert on '
    + 'the primary calendar', () => {
    const source = read('server/utils/google/calendar-api.ts')

    expect(source).not.toMatch(/method: 'DELETE'|method: 'PUT'|method: 'PATCH'/)
    expect(source.match(/method: 'POST'/g)).toHaveLength(2)
    expect(source.match(/method: 'GET'/g)).toHaveLength(1)
    expect(source).not.toMatch(
      /calendarList|\/acl|\/move|quickAdd|\/import|\/watch|\/instances|\/settings|\/channels|\/colors/,
    )
    expect(source).toContain('/calendars/primary/events')
    expect(source).toContain('/calendar/v3/freeBusy')
    expect(source).toMatch(/NO_GUEST_NOTIFICATIONS = 'none'/)
    expect(source).toContain('sendUpdates')
    expect(source).not.toMatch(/conferenceDataVersion|supportsAttachments/)
    expect(source).not.toMatch(/sendUpdates', '(all|externalOnly)'/)
  })

  it('asks Google for no attendee address or name, link or attachment url',
    () => {
      const source = read('server/utils/google/calendar-api.ts')
      const fields = source.slice(
        source.indexOf('const LIST_FIELDS'),
        source.indexOf('const FREE_BUSY_FIELDS'),
      )

      expect(fields).toContain('attendees(self,responseStatus)')
      expect(fields).toContain('organizer(self,displayName)')
      expect(fields).not.toMatch(/organizer\([^)]*email/)
      expect(fields).not.toMatch(/attendees\([^)]*(email|displayName|id)/)
      expect(fields).not.toMatch(/uri|fileUrl|hangoutLink\(/)
      expect(fields).not.toMatch(/creator|reminders|extendedProperties/)
    })

  it('has a request body type with no attendee, conference or recurrence key',
    () => {
      const source = read('shared/utils/google-calendar-event.ts')
      const block = source.slice(
        source.indexOf('export interface CalendarInsertBody'),
        source.indexOf('export type CalendarEventValidation'),
      )

      expect(block).toContain('summary: string')
      expect(block).not.toMatch(
        /attendees|conferenceData|recurrence|reminders|attachments|guests/,
      )
    })

  it('copies only the whitelisted fields into the payload, even from an '
    + 'object that carries more', () => {
    const validation = validateCalendarEvent({
      title: 'Planning',
      start: '2026-12-01T10:00:00+01:00',
      end: '2026-12-01T11:00:00+01:00',
      timeZone: 'Europe/Berlin',
      description: 'Agenda',
    })

    if (!validation.ok) {
      throw new Error('Expected a valid event')
    }

    const hostile = {
      ...validation.body,
      attendees: [{ email: 'mallory@evil.example' }],
      conferenceData: { createRequest: { requestId: 'x' } },
      recurrence: ['RRULE:FREQ=DAILY'],
      reminders: { useDefault: false },
      attachments: [{ fileUrl: 'https://evil.example' }],
      start: {
        ...validation.body.start,
        attendees: [{ email: 'mallory@evil.example' }],
      },
    }
    const payload = buildCalendarInsertPayload(hostile, 'abcde12345')

    expect(Object.keys(payload).sort()).toEqual([
      'description',
      'end',
      'id',
      'start',
      'summary',
    ])
    expect(payload.id).toBe('abcde12345')
    expect(Object.keys(payload.start as object).sort()).toEqual([
      'dateTime',
      'timeZone',
    ])
    expect(JSON.stringify(payload)).not.toMatch(/mallory|attendees/)
  })

  it('reaches the Calendar API only from the Calendar tools, and those only '
    + 'from the candidate builder', () => {
    const files = [
      ...sourceFilesUnder('server'),
      ...sourceFilesUnder('app'),
      ...sourceFilesUnder('shared'),
    ]
    const importersOf = (pattern: RegExp) => {
      return files
        .filter(path => pattern.test(read(path)))
        .map(path => relative(ROOT, path))
        .sort()
    }

    expect(importersOf(/google\/calendar-api'/)).toEqual([
      'server/utils/google/calendar-tools.ts',
    ])
    expect(importersOf(/google\/calendar-tools'/)).toEqual([
      'server/utils/tool-approval/google-send-candidates.ts',
    ])
  })

  it('does not use the Gmail API module and is not used by it', () => {
    expect(read('server/utils/google/calendar-api.ts'))
      .not.toMatch(/gmail-api|gmail-message/)
    expect(read('server/utils/google/gmail-api.ts'))
      .not.toMatch(/calendar/i)
  })

  it('keeps Calendar out of the MCP server', () => {
    const mcpFiles = [
      ...sourceFilesUnder('server/mcp'),
      ...sourceFilesUnder('server/utils/mcp'),
    ]

    for (const path of mcpFiles) {
      const source = read(path)

      expect(source, path).not.toMatch(/calendar-api|calendar-tools/)
      expect(source, path).not.toMatch(/google__calendar/)
    }

    const names: string[] = []
    const collect = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(collect)
      } else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
          if (key === 'name' && typeof item === 'string') {
            names.push(item)
          }

          collect(item)
        }
      }
    }

    collect(JSON.parse(read('config/mcp-surface.json')))

    expect(names.length).toBeGreaterThan(10)
    expect(names.filter(name => /calendar|event/i.test(name))).toEqual([])
  })

  it('treats a chat that read events or free time as one that holds Google '
    + 'data, and one that only created an event as not', () => {
    const part = (toolName: string, references: unknown[]) => ({
      parts: [{
        type: `tool-${toolName}`,
        state: 'output-available',
        output: { references, bodyRemoved: true },
      }],
    })

    expect(chatHoldsGoogleData({
      messages: [part('google__calendar_list_events', [{ id: 'e1' }])],
    })).toBe(true)
    expect(chatHoldsGoogleData({
      messages: [part('google__calendar_free_busy', [{ id: 'free-busy-x' }])],
    })).toBe(true)
    expect(chatHoldsGoogleData({
      messages: [part('google__calendar_create_event', [{ id: 'e1' }])],
    })).toBe(false)
    expect(chatHoldsGoogleData({
      messages: [part('google__calendar_list_events', [])],
    })).toBe(true)
    expect(chatHoldsGoogleData({
      messages: [part('google__calendar_free_busy', [])],
    })).toBe(true)
  })
})

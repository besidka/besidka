import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
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

describe('the share dialog names for Gmail references', () => {
  it('names an email thread by its day and never by subject or sender',
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
                    type: 'tool-google__gmail_search',
                    state: 'output-available',
                    output: {
                      references: [
                        {
                          id: 't1',
                          kind: 'gmail-thread',
                          date: '2026-11-21T10:00:00.000Z',
                        },
                        { id: 't2', kind: 'gmail-thread' },
                        { id: 't3', kind: 'gmail-thread', date: 'not a date' },
                        {
                          id: 't4',
                          kind: 'gmail-thread',
                          date: '2026-11-21T18:00:00.000Z',
                        },
                        { id: 'r-1', kind: 'gmail-draft' },
                      ],
                    },
                  },
                  {
                    type: 'tool-google__gmail_read_thread',
                    state: 'output-available',
                    output: {
                      references: [{
                        id: 't1',
                        kind: 'gmail-thread',
                        date: '2026-11-21T10:00:00.000Z',
                      }],
                    },
                  },
                  {
                    type: 'tool-google__drive_search',
                    state: 'output-available',
                    output: {
                      references: [
                        { id: 'f1', kind: 'drive-file', title: 'Budget.xlsx' },
                      ],
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
        'Email thread from 2026-11-21',
        'Email thread',
        'Email thread (2)',
        'Email thread from 2026-11-21 (2)',
        'Budget.xlsx',
      ])
    })
})

describe('the Gmail boundary', () => {
  it('has a Gmail API module that can only list, read and create drafts',
    () => {
      const source = read('server/utils/google/gmail-api.ts')

      expect(source).not.toMatch(/\/send\b|\/modify\b|\/trash\b|\/untrash\b/)
      expect(source).not.toMatch(/batchDelete|batchModify|attachments/)
      expect(source).not.toMatch(/method: 'DELETE'|method: 'PUT'|method: 'PATCH'/)
      expect(source.match(/method: 'POST'/g)).toHaveLength(1)
      expect(source).toContain('GMAIL_DRAFTS_URL')
      expect(source).not.toMatch(/drafts\/send|messages\/send/)
    })

  it('reaches the Gmail API only from the Gmail tools', () => {
    const importers = [
      ...sourceFilesUnder('server'),
      ...sourceFilesUnder('app'),
      ...sourceFilesUnder('shared'),
    ].filter((path) => {
      return /google\/gmail-api'/.test(read(path))
    }).map(path => relative(ROOT, path)).sort()

    expect(importers).toEqual([
      'server/utils/google/byo-tools.ts',
      'server/utils/google/drive-search.ts',
    ])
  })

  it('keeps mail out of the MCP server', () => {
    const mcpFiles = [
      ...sourceFilesUnder('server/mcp'),
      ...sourceFilesUnder('server/utils/mcp'),
    ]

    for (const path of mcpFiles) {
      const source = read(path)

      expect(source, path).not.toMatch(/gmail-api|gmail-text|byo-tools/)
      expect(source, path).not.toMatch(/google__gmail/)
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
    expect(names.filter(name => /gmail|mail|draft/i.test(name))).toEqual([])
  })

  it('treats a chat that searched or read Gmail as one that holds Google data',
    () => {
      const searched = [{
        parts: [{
          type: 'tool-google__gmail_search',
          state: 'output-available',
          output: { references: [{ id: 't1' }], bodyRemoved: true },
        }],
      }]
      const read = [{
        parts: [{
          type: 'tool-google__gmail_read_thread',
          state: 'output-available',
          output: { references: [{ id: 't1' }], bodyRemoved: true },
        }],
      }]
      const onlyDraft = [{
        parts: [{
          type: 'tool-google__gmail_create_draft',
          state: 'output-available',
          output: { references: [{ id: 'r-1' }], bodyRemoved: true },
        }],
      }]

      expect(chatHoldsGoogleData({ messages: searched })).toBe(true)
      expect(chatHoldsGoogleData({ messages: read })).toBe(true)
      expect(chatHoldsGoogleData({ messages: onlyDraft })).toBe(false)
      expect(chatHoldsGoogleData({ googleDataAt: new Date() })).toBe(true)
    })
})

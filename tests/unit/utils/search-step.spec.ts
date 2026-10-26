import { describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import {
  SEARCH_STEP_FALLBACK_ERROR,
  formatChatResultCount,
  formatSearchResultCount,
  formatSearchResultDate,
  getSearchFreshnessLabel,
  getSearchFreshnessTooltip,
  getSearchStepData,
  getSearchStepErrorReason,
  isInternalChatPath,
} from '../../../app/utils/search-step'

function part(value: Record<string, unknown>): UIMessage['parts'][number] {
  return value as UIMessage['parts'][number]
}

describe('getSearchStepErrorReason', () => {
  it('joins message and why from a chat error JSON payload', () => {
    const errorText = JSON.stringify({
      code: 'provider-auth',
      message: 'Brave rejected the saved API key.',
      why: 'Brave responded with HTTP 401.',
      fix: 'Update the key.',
    })

    expect(getSearchStepErrorReason(errorText)).toBe(
      'Brave rejected the saved API key. Brave responded with HTTP 401.',
    )
  })

  it('uses message alone when why is absent', () => {
    expect(getSearchStepErrorReason('{"message":"Rate limited."}'))
      .toBe('Rate limited.')
  })

  it('returns plain text unchanged', () => {
    expect(getSearchStepErrorReason('Exa is temporarily unavailable.'))
      .toBe('Exa is temporarily unavailable.')
  })

  it('falls back for missing, empty or message-less payloads', () => {
    expect(getSearchStepErrorReason(undefined))
      .toBe(SEARCH_STEP_FALLBACK_ERROR)
    expect(getSearchStepErrorReason('  ')).toBe(SEARCH_STEP_FALLBACK_ERROR)
    expect(getSearchStepErrorReason('{"code":"unknown"}'))
      .toBe(SEARCH_STEP_FALLBACK_ERROR)
  })

  it('clips very long plain text', () => {
    expect(getSearchStepErrorReason('x'.repeat(1000))).toHaveLength(300)
  })
})

describe('getSearchStepData', () => {
  it('ignores tools that are not external search', () => {
    expect(getSearchStepData(part({
      type: 'tool-web_search_preview',
      state: 'output-available',
    }))).toBeNull()
    expect(getSearchStepData(part({ type: 'text', text: 'hi' }))).toBeNull()
  })

  it('handles undefined input while streaming', () => {
    const data = getSearchStepData(part({
      type: 'tool-web_search_brave',
      state: 'input-streaming',
    }))

    expect(data).toMatchObject({
      toolName: 'web_search_brave',
      state: 'pending',
      query: '',
      results: [],
      hasOutput: false,
    })
  })

  it('reads a partial streaming input', () => {
    const data = getSearchStepData(part({
      type: 'tool-web_search_exa',
      state: 'input-streaming',
      input: { query: 'poland ele' },
    }))

    expect(data?.query).toBe('poland ele')
    expect(data?.freshness).toBeUndefined()
  })

  it('reads query, valid freshness and results when output is available',
    () => {
      const data = getSearchStepData(part({
        type: 'tool-web_search_brave',
        state: 'output-available',
        input: { query: 'news', freshness: 'day' },
        output: {
          provider: 'brave',
          results: [
            {
              title: 'A',
              url: 'https://a.example/x',
              snippet: 's',
              publishedDate: '2026-05-04',
            },
            { url: 42 },
            { title: 'B', url: 'https://b.example/y', snippet: 's' },
          ],
        },
      }))

      expect(data?.state).toBe('done')
      expect(data?.freshness).toBe('day')
      expect(data?.hasOutput).toBe(true)
      expect(data?.results).toEqual([
        {
          title: 'A',
          url: 'https://a.example/x',
          publishedDate: '2026-05-04',
        },
        { title: 'B', url: 'https://b.example/y', publishedDate: undefined },
      ])
    })

  it('reads a DeepSeek web_search output and maps date to the published '
    + 'date', () => {
    const data = getSearchStepData(part({
      type: 'tool-web_search',
      state: 'output-available',
      input: { query: 'nuxt 4' },
      output: {
        provider: 'deepseek',
        query: 'nuxt 4',
        billable: true,
        results: [
          {
            title: 'A',
            url: 'https://a.example/x',
            snippet: 's',
            summary: 'long',
            date: '2026-07-01',
          },
          { title: 'B', url: 'https://b.example/y' },
        ],
      },
    }))

    expect(data).toMatchObject({
      toolName: 'web_search',
      state: 'done',
      query: 'nuxt 4',
      hasOutput: true,
    })
    expect(data?.results).toEqual([
      {
        title: 'A',
        url: 'https://a.example/x',
        publishedDate: '2026-07-01',
      },
      { title: 'B', url: 'https://b.example/y', publishedDate: undefined },
    ])
  })

  it('does not treat other web_search outputs as a search step', () => {
    const outputs = [
      undefined,
      'encrypted-moonshot-blob',
      { results: [{ title: 'A', url: 'https://a.example/x' }] },
      { provider: 'brave', results: [] },
      { sources: [] },
    ]

    for (const output of outputs) {
      expect(getSearchStepData(part({
        type: 'tool-web_search',
        state: 'output-available',
        input: { query: 'x' },
        output,
      }))).toBeNull()
    }
  })

  it('ignores a date field on Brave and Exa results', () => {
    const data = getSearchStepData(part({
      type: 'tool-web_search_brave',
      state: 'output-available',
      input: { query: 'x' },
      output: {
        provider: 'brave',
        results: [{ title: 'A', url: 'https://a.example/x', date: '2026-07-01' }],
      },
    }))

    expect(data?.results[0]?.publishedDate).toBeUndefined()
  })

  it('drops an unknown freshness value', () => {
    const data = getSearchStepData(part({
      type: 'tool-web_search_brave',
      state: 'input-available',
      input: { query: 'x', freshness: 'decade' },
    }))

    expect(data?.freshness).toBeUndefined()
  })

  it('maps output-error to a failed step with a parsed reason', () => {
    const data = getSearchStepData(part({
      type: 'tool-web_search_exa',
      state: 'output-error',
      input: { query: 'x' },
      errorText: JSON.stringify({ message: 'Exa is down.', why: 'HTTP 503.' }),
    }))

    expect(data).toMatchObject({
      state: 'failed',
      hasOutput: false,
      errorReason: 'Exa is down. HTTP 503.',
    })
  })

  it('treats a preliminary output as still pending with no results', () => {
    const data = getSearchStepData(part({
      type: 'tool-web_search_brave',
      state: 'output-available',
      preliminary: true,
      output: { results: [{ title: 'A', url: 'https://a.example' }] },
    }))

    expect(data).toMatchObject({
      state: 'pending',
      hasOutput: false,
      results: [],
    })
  })
})

describe('search step formatting', () => {
  it('labels freshness windows', () => {
    expect(getSearchFreshnessLabel('day')).toBe('Last 24 hours')
    expect(getSearchFreshnessLabel('week')).toBe('Last 7 days')
    expect(getSearchFreshnessLabel('month')).toBe('Last month')
    expect(getSearchFreshnessLabel('year')).toBe('Last 12 months')
  })

  describe('freshness tooltip', () => {
    const searchedAt = '2026-10-05T12:00:00.000Z'
    const MILLISECONDS_PER_DAY = 86_400_000

    function formatCutoff(days: number): string {
      const cutoff = new Date(
        new Date(searchedAt).getTime() - days * MILLISECONDS_PER_DAY,
      )

      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(cutoff)
    }

    it('shows the cutoff relative to when the search ran', () => {
      expect(getSearchFreshnessTooltip('day', searchedAt))
        .toBe(`Only pages published since ${formatCutoff(1)}`)
      expect(getSearchFreshnessTooltip('week', searchedAt))
        .toBe(`Only pages published since ${formatCutoff(7)}`)
      expect(getSearchFreshnessTooltip('month', searchedAt))
        .toBe(`Only pages published since ${formatCutoff(31)}`)
      expect(getSearchFreshnessTooltip('year', searchedAt))
        .toBe(`Only pages published since ${formatCutoff(365)}`)
    })

    it('accepts a numeric timestamp and a Date', () => {
      const expected = `Only pages published since ${formatCutoff(7)}`

      expect(
        getSearchFreshnessTooltip('week', new Date(searchedAt).getTime()),
      ).toBe(expected)
      expect(getSearchFreshnessTooltip('week', new Date(searchedAt)))
        .toBe(expected)
    })

    it('falls back to the window without a usable timestamp', () => {
      expect(getSearchFreshnessTooltip('day'))
        .toBe('Only pages published in the last 24 hours')
      expect(getSearchFreshnessTooltip('week', null))
        .toBe('Only pages published in the last 7 days')
      expect(getSearchFreshnessTooltip('month', 'not a date'))
        .toBe('Only pages published in the last month')
      expect(getSearchFreshnessTooltip('year', undefined))
        .toBe('Only pages published in the last 12 months')
    })
  })

  it('formats result counts', () => {
    expect(formatSearchResultCount(0)).toBe('No results')
    expect(formatSearchResultCount(1)).toBe('1 result')
    expect(formatSearchResultCount(8)).toBe('8 results')
  })

  it('formats dates and rejects invalid ones', () => {
    expect(formatSearchResultDate('2026-05-04')).toContain('2026')
    expect(formatSearchResultDate('2026-05-04T08:06:04.000Z')).toContain('2026')
    expect(formatSearchResultDate('nope')).toBe('')
    expect(formatSearchResultDate('')).toBe('')
  })

  it('formats a date-only value in UTC regardless of the local zone', () => {
    expect(formatSearchResultDate('2026-05-04')).toBe(
      new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date('2026-05-04')),
    )
  })

  it('reuses module-level formatters instead of constructing per call', () => {
    const construct = vi.spyOn(Intl, 'DateTimeFormat')

    formatSearchResultDate('2026-05-04')
    formatSearchResultDate('2026-05-04T08:06:04.000Z')
    formatSearchResultDate('2026-06-01')

    expect(construct).not.toHaveBeenCalled()

    construct.mockRestore()
  })
})

describe('isInternalChatPath', () => {
  it('accepts only a bare /chats/<slug> path', () => {
    expect(isInternalChatPath('/chats/01KABCDEF')).toBe(true)
    expect(isInternalChatPath('/chats/')).toBe(false)
    expect(isInternalChatPath('/chats/a/b')).toBe(false)
    expect(isInternalChatPath('/chats/a?x=1')).toBe(false)
    expect(isInternalChatPath('/chats/a#hash')).toBe(false)
    expect(isInternalChatPath('/chats/a-b')).toBe(false)
    expect(isInternalChatPath('//evil.com')).toBe(false)
    expect(isInternalChatPath('//evil.com/chats/a')).toBe(false)
    expect(isInternalChatPath('javascript:alert(1)')).toBe(false)
    expect(isInternalChatPath('https://evil.com/chats/a')).toBe(false)
    expect(isInternalChatPath('/chats/a\n')).toBe(false)
    expect(isInternalChatPath(undefined)).toBe(false)
    expect(isInternalChatPath(42)).toBe(false)
  })
})

describe('getSearchStepData for chat tools', () => {
  it('maps search_chats results to internal chat links without snippets',
    () => {
      const data = getSearchStepData(part({
        type: 'tool-search_chats',
        state: 'output-available',
        input: { query: 'invoice', limit: 5 },
        output: {
          notice: 'Results come from your own chats.',
          results: [
            {
              chatId: 'abc1',
              title: 'Invoice help',
              url: '/chats/abc1',
              messageId: 'm1',
              role: 'user',
              date: '2026-10-01T10:00:00.000Z',
              snippet: 'secret snippet',
            },
            {
              chatId: 'abc2',
              title: '  ',
              url: '/chats/abc2',
              messageId: 'm2',
              role: 'assistant',
              date: '2026-10-02T10:00:00.000Z',
              snippet: 's',
            },
          ],
        },
      }))

      expect(data).toEqual({
        toolName: 'search_chats',
        state: 'done',
        query: 'invoice',
        freshness: undefined,
        hasOutput: true,
        errorReason: '',
        results: [
          {
            title: 'Invoice help',
            url: '/chats/abc1',
            publishedDate: '2026-10-01T10:00:00.000Z',
            internalPath: '/chats/abc1',
          },
          {
            title: 'Untitled chat',
            url: '/chats/abc2',
            publishedDate: '2026-10-02T10:00:00.000Z',
            internalPath: '/chats/abc2',
          },
        ],
      })
      expect(JSON.stringify(data)).not.toContain('secret snippet')
    })

  it('drops results whose url is not a bare internal chat path', () => {
    const data = getSearchStepData(part({
      type: 'tool-search_chats',
      state: 'output-available',
      input: { query: 'x' },
      output: {
        results: [
          { title: 'a', url: '//evil.com', date: '2026-10-01' },
          { title: 'b', url: 'javascript:alert(1)', date: '2026-10-01' },
          { title: 'c', url: 'https://evil.com/chats/x', date: '2026-10-01' },
          { title: 'd', url: '/chats/x/../../admin', date: '2026-10-01' },
          { title: 'e', url: '/chats/ok', date: '2026-10-01' },
          { title: 'f' },
          'junk',
        ],
      },
    }))

    expect(data?.results).toEqual([
      {
        title: 'e',
        url: '/chats/ok',
        publishedDate: '2026-10-01',
        internalPath: '/chats/ok',
      },
    ])
  })

  it('maps the read_chat chat to a single internal row', () => {
    const data = getSearchStepData(part({
      type: 'tool-read_chat',
      state: 'output-available',
      input: { chatId: 'abc1' },
      output: {
        notice: 'n',
        chat: { chatId: 'abc1', title: 'Invoice help', url: '/chats/abc1' },
        messages: [{ id: 'm1', text: 'hello' }],
        truncated: false,
      },
    }))

    expect(data).toMatchObject({
      toolName: 'read_chat',
      state: 'done',
      query: '',
      hasOutput: true,
      results: [
        {
          title: 'Invoice help',
          url: '/chats/abc1',
          internalPath: '/chats/abc1',
        },
      ],
    })
    expect(data?.results[0]?.publishedDate).toBeUndefined()
  })

  it('returns an empty result list for malformed outputs', () => {
    const searchData = getSearchStepData(part({
      type: 'tool-search_chats',
      state: 'output-available',
      input: { query: 'x' },
      output: 'oops',
    }))
    const readData = getSearchStepData(part({
      type: 'tool-read_chat',
      state: 'output-available',
      input: { chatId: 'abc1' },
      output: { chat: { title: 'No url' } },
    }))

    expect(searchData).toMatchObject({ hasOutput: true, results: [] })
    expect(readData).toMatchObject({ hasOutput: true, results: [] })
  })

  it('reads pending and failed chat steps like web search', () => {
    const pending = getSearchStepData(part({
      type: 'tool-search_chats',
      state: 'input-streaming',
      input: { query: 'inv' },
    }))
    const failed = getSearchStepData(part({
      type: 'tool-read_chat',
      state: 'output-error',
      input: { chatId: 'abc1' },
      errorText: 'The chat search budget for this reply is used up.',
    }))

    expect(pending).toMatchObject({
      state: 'pending',
      query: 'inv',
      results: [],
      hasOutput: false,
    })
    expect(failed).toMatchObject({
      state: 'failed',
      hasOutput: false,
      errorReason: 'The chat search budget for this reply is used up.',
    })
  })

  it('never sets internalPath on web search results', () => {
    const data = getSearchStepData(part({
      type: 'tool-web_search_brave',
      state: 'output-available',
      input: { query: 'x' },
      output: { results: [{ title: 'A', url: '/chats/abc1' }] },
    }))

    expect(data?.results[0]?.internalPath).toBeUndefined()
  })
})

describe('getSearchStepData past-chat pre-retrieval', () => {
  it('flags a search_chats part from the pre-retrieval call id', () => {
    const data = getSearchStepData(part({
      type: 'tool-search_chats',
      toolCallId: 'past-chat-pre-retrieval-user-1',
      state: 'output-available',
      input: { query: 'invoice' },
      output: {
        results: [{ title: 'Invoices', url: '/chats/abc1', date: '' }],
      },
    }))

    expect(data).toMatchObject({
      toolName: 'search_chats',
      preRetrieval: true,
      results: [{ title: 'Invoices', internalPath: '/chats/abc1' }],
    })
  })

  it('leaves a model-called search_chats part unflagged', () => {
    const data = getSearchStepData(part({
      type: 'tool-search_chats',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { query: 'invoice' },
      output: { results: [] },
    }))

    expect(data).not.toHaveProperty('preRetrieval')
  })
})

describe('formatChatResultCount', () => {
  it('words the chat count', () => {
    expect(formatChatResultCount(0)).toBe('No chats')
    expect(formatChatResultCount(1)).toBe('1 chat')
    expect(formatChatResultCount(3)).toBe('3 chats')
  })
})

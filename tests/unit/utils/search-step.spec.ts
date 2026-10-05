import { describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import {
  SEARCH_STEP_FALLBACK_ERROR,
  formatSearchResultCount,
  formatSearchResultDate,
  getSearchFreshnessLabel,
  getSearchFreshnessTooltip,
  getSearchStepData,
  getSearchStepErrorReason,
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

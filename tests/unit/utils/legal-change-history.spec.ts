import { describe, expect, it } from 'vitest'
import {
  LEGAL_CHANGE_HISTORY_EMPTY_TEXT,
  buildLegalChangeHistoryItems,
  buildLegalChangeHistoryMarkdown,
  formatLegalDate,
} from '#shared/utils/legal-change-history'
import type { LegalNotice } from '#shared/utils/legal-notices'

function createNotice(overrides: Partial<LegalNotice>): LegalNotice {
  return {
    id: 'notice',
    documents: ['privacy-policy', 'terms-of-use'],
    publishedAt: '2026-01-10T06:00:00Z',
    sendFrom: '2026-01-10T09:00:00Z',
    effectiveAt: '2026-02-15',
    summary: ['First', 'Second', 'Third'],
    ...overrides,
  }
}

const NOTICES = [
  createNotice({ id: 'old', summary: ['Old one', 'Old two', 'Old three'] }),
  createNotice({
    id: 'terms-only',
    documents: ['terms-of-use'],
    publishedAt: '2026-03-01T06:00:00Z',
    effectiveAt: '2026-04-05',
  }),
  createNotice({
    id: 'future',
    publishedAt: '2026-09-01T06:00:00Z',
    effectiveAt: '2026-10-15',
  }),
]

const NOW = new Date('2026-05-01T00:00:00Z')

describe('formatLegalDate', () => {
  it('writes dates and datetimes the same way in every runtime', () => {
    expect(formatLegalDate('2026-12-01')).toBe('1 December 2026')
    expect(formatLegalDate('2026-10-31T06:00:00Z')).toBe('31 October 2026')
  })

  it('returns an unparseable value unchanged', () => {
    expect(formatLegalDate('soon')).toBe('soon')
  })
})

describe('buildLegalChangeHistoryItems', () => {
  it('lists the notices of one document, newest first, published only', () => {
    expect(
      buildLegalChangeHistoryItems('privacy-policy', NOW, NOTICES)
        .map((item) => {
          return item.id
        }),
    ).toEqual(['old'])
    expect(
      buildLegalChangeHistoryItems('terms-of-use', NOW, NOTICES)
        .map((item) => {
          return item.id
        }),
    ).toEqual(['terms-only', 'old'])
  })

  it('lists every notice when no document is given', () => {
    expect(
      buildLegalChangeHistoryItems(undefined, NOW, NOTICES).map((item) => {
        return item.id
      }),
    ).toEqual(['terms-only', 'old'])
  })

  it('leaves a notice out until its publish time', () => {
    const before = new Date('2026-09-01T05:59:59Z')
    const after = new Date('2026-09-01T06:00:00Z')

    expect(buildLegalChangeHistoryItems('cookie-policy', after, NOTICES))
      .toEqual([])
    expect(
      buildLegalChangeHistoryItems('privacy-policy', before, NOTICES)
        .map((item) => {
          return item.id
        }),
    ).toEqual(['old'])
    expect(
      buildLegalChangeHistoryItems('privacy-policy', after, NOTICES)
        .map((item) => {
          return item.id
        }),
    ).toEqual(['future', 'old'])
  })

  it('carries labels and summaries', () => {
    const [item] = buildLegalChangeHistoryItems('privacy-policy', NOW, NOTICES)

    expect(item).toMatchObject({
      publishedLabel: '10 January 2026',
      effectiveLabel: '15 February 2026',
      summary: ['Old one', 'Old two', 'Old three'],
    })
  })
})

describe('buildLegalChangeHistoryMarkdown', () => {
  it('renders each notice with its dates and bullets', () => {
    expect(
      buildLegalChangeHistoryMarkdown('privacy-policy', NOW, NOTICES),
    ).toBe([
      '**Announced 10 January 2026, in effect from 15 February 2026**',
      '',
      '- Old one',
      '- Old two',
      '- Old three',
    ].join('\n'))
  })

  it('says so when there is no material change yet', () => {
    expect(buildLegalChangeHistoryMarkdown('cookie-policy', NOW, NOTICES))
      .toBe(LEGAL_CHANGE_HISTORY_EMPTY_TEXT)
  })
})

import { describe, expect, it } from 'vitest'
import {
  LEGAL_DOCUMENT_IDS,
  LEGAL_NOTICES,
  SHORT_NOTICE_DAYS,
  STANDARD_NOTICE_DAYS,
  getActiveLegalNotices,
  getLatestLegalNotice,
  getLegalNoticeById,
  getNoticeLeadDays,
  getRequiredNoticeDays,
  isLegalDocumentId,
} from '#shared/utils/legal-notices'
import type { LegalNotice } from '#shared/utils/legal-notices'

const FIRST_NOTICE_ID = '2026-11-legal-notices'

function createNotice(overrides: Partial<LegalNotice> = {}): LegalNotice {
  return {
    id: 'test-notice',
    documents: ['privacy-policy'],
    publishedAt: '2026-01-01T06:00:00Z',
    sendFrom: '2026-01-01T09:00:00Z',
    effectiveAt: '2026-02-01',
    summary: ['One', 'Two', 'Three'],
    ...overrides,
  }
}

describe('LEGAL_NOTICES invariants', () => {
  it('uses unique ids', () => {
    const ids = LEGAL_NOTICES.map((notice) => {
      return notice.id
    })

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is ordered from oldest to newest by publishedAt', () => {
    const publishedAt = LEGAL_NOTICES.map((notice) => {
      return Date.parse(notice.publishedAt)
    })

    expect(publishedAt).toEqual([...publishedAt].sort((a, b) => a - b))
  })

  it.each(LEGAL_NOTICES)('$id has valid dates', (notice) => {
    expect(Number.isNaN(Date.parse(notice.publishedAt))).toBe(false)
    expect(Number.isNaN(Date.parse(notice.sendFrom))).toBe(false)
    expect(notice.effectiveAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isNaN(Date.parse(notice.effectiveAt))).toBe(false)
  })

  it.each(LEGAL_NOTICES)('$id gives the notice period it must', (notice) => {
    const requiredDays = getRequiredNoticeDays(notice)

    expect(
      getNoticeLeadDays(notice),
      `${notice.id} takes effect less than ${requiredDays} days after it `
      + 'is published. Move effectiveAt later, or set shortNoticeReason when '
      + `the change is required by law or for security (then ${SHORT_NOTICE_DAYS} `
      + 'days is enough).',
    ).toBeGreaterThanOrEqual(requiredDays)
  })

  it.each(LEGAL_NOTICES)('$id starts sending after it is published', (notice) => {
    expect(Date.parse(notice.sendFrom)).toBeGreaterThanOrEqual(
      Date.parse(notice.publishedAt),
    )
  })

  it.each(LEGAL_NOTICES)('$id has 3 to 6 summary bullets', (notice) => {
    expect(notice.summary.length).toBeGreaterThanOrEqual(3)
    expect(notice.summary.length).toBeLessThanOrEqual(6)

    for (const line of notice.summary) {
      expect(line.trim().length).toBeGreaterThan(0)
    }
  })

  it.each(LEGAL_NOTICES)('$id names known documents', (notice) => {
    expect(notice.documents.length).toBeGreaterThan(0)

    for (const documentId of notice.documents) {
      expect(isLegalDocumentId(documentId)).toBe(true)
    }

    expect(new Set(notice.documents).size).toBe(notice.documents.length)
  })

  it('records the reason of every short notice', () => {
    for (const notice of LEGAL_NOTICES as readonly LegalNotice[]) {
      if (notice.shortNoticeReason !== undefined) {
        expect(notice.shortNoticeReason.trim().length).toBeGreaterThan(0)
      }
    }
  })
})

describe('notice period rule', () => {
  it('needs 30 days without a reason and 14 with one', () => {
    expect(getRequiredNoticeDays(createNotice())).toBe(STANDARD_NOTICE_DAYS)
    expect(
      getRequiredNoticeDays(createNotice({ shortNoticeReason: 'Security' })),
    ).toBe(SHORT_NOTICE_DAYS)
  })

  it('measures lead time from publishedAt to the start of effectiveAt', () => {
    expect(getNoticeLeadDays(createNotice())).toBe(30.75)
  })
})

describe('known document ids', () => {
  it('knows the three legal pages and nothing else', () => {
    expect([...LEGAL_DOCUMENT_IDS]).toEqual([
      'privacy-policy',
      'terms-of-use',
      'cookie-policy',
    ])
    expect(isLegalDocumentId('privacy')).toBe(false)
    expect(isLegalDocumentId(undefined)).toBe(false)
  })
})

describe('notice helpers', () => {
  const older = createNotice({
    id: 'older',
    publishedAt: '2026-01-01T06:00:00Z',
    effectiveAt: '2026-02-01',
  })
  const newer = createNotice({
    id: 'newer',
    publishedAt: '2026-06-01T06:00:00Z',
    effectiveAt: '2026-07-01',
  })
  const notices = [older, newer]

  it('returns nothing before the first notice is published', () => {
    const now = new Date('2025-12-31T00:00:00Z')

    expect(getLatestLegalNotice(now, notices)).toBeNull()
    expect(getActiveLegalNotices(now, notices)).toEqual([])
  })

  it('returns the newest published notice', () => {
    expect(
      getLatestLegalNotice(new Date('2026-03-01T00:00:00Z'), notices)?.id,
    ).toBe('older')
    expect(
      getLatestLegalNotice(new Date('2026-06-01T06:00:00Z'), notices)?.id,
    ).toBe('newer')
  })

  it('keeps a notice active until 14 days after it takes effect', () => {
    const idsAt = (iso: string) => {
      return getActiveLegalNotices(new Date(iso), notices).map((notice) => {
        return notice.id
      })
    }

    expect(idsAt('2026-01-01T05:59:59Z')).toEqual([])
    expect(idsAt('2026-01-01T06:00:00Z')).toEqual(['older'])
    expect(idsAt('2026-02-14T23:59:59Z')).toEqual(['older'])
    expect(idsAt('2026-02-15T00:00:00Z')).toEqual([])
    expect(idsAt('2026-06-15T00:00:00Z')).toEqual(['newer'])
  })

  it('finds a notice by id', () => {
    expect(getLegalNoticeById('older', notices)).toBe(older)
    expect(getLegalNoticeById('missing', notices)).toBeNull()
    expect(getLegalNoticeById(FIRST_NOTICE_ID)?.documents).toEqual([
      'privacy-policy',
      'terms-of-use',
    ])
  })
})

import { describe, expect, it } from 'vitest'
import type { LegalNotice } from '#shared/utils/legal-notices'
import { LEGAL_NOTICES } from '#shared/utils/legal-notices'
import {
  buildLegalNoticeEmail,
  formatNoticeEffectiveDate,
} from '~~/server/utils/legal/notice-email'

const BASE_NOTICE: LegalNotice = {
  id: '2026-11-test',
  documents: ['privacy-policy', 'terms-of-use'],
  publishedAt: '2026-10-31T06:00:00Z',
  sendFrom: '2026-10-31T09:00:00Z',
  effectiveAt: '2026-12-01',
  summary: ['First change.', 'Second change.'],
}

describe('formatNoticeEffectiveDate', () => {
  it('writes the day without a leading zero and the month in full', () => {
    expect(formatNoticeEffectiveDate(BASE_NOTICE)).toBe('1 December 2026')
    expect(formatNoticeEffectiveDate({
      ...BASE_NOTICE,
      effectiveAt: '2027-01-15',
    })).toBe('15 January 2027')
  })
})

describe('buildLegalNoticeEmail', () => {
  it('builds the subject from the documents and the date', () => {
    const { subject } = buildLegalNoticeEmail(BASE_NOTICE, 'p@example.test')

    expect(subject).toBe(
      'Changes to Besidka\'s Privacy Policy and Terms of Use take effect on '
      + '1 December 2026',
    )
  })

  it('names one, two or three documents', () => {
    const subjectFor = (documents: LegalNotice['documents']) => {
      return buildLegalNoticeEmail(
        { ...BASE_NOTICE, documents },
        'p@example.test',
      ).subject
    }

    expect(subjectFor(['cookie-policy'])).toContain('Besidka\'s Cookie Policy ')
    expect(subjectFor(['privacy-policy', 'terms-of-use', 'cookie-policy']))
      .toContain('Privacy Policy, Terms of Use and Cookie Policy')
  })

  it('links each document to its change history', () => {
    const { props } = buildLegalNoticeEmail(BASE_NOTICE, 'p@example.test')

    expect(props.documents).toEqual([
      {
        label: 'Privacy Policy',
        url: 'https://besidka.com/privacy-policy#change-history',
      },
      {
        label: 'Terms of Use',
        url: 'https://besidka.com/terms-of-use#change-history',
      },
    ])
  })

  it('adapts the intro to what changes', () => {
    const introFor = (documents: LegalNotice['documents']) => {
      return buildLegalNoticeEmail(
        { ...BASE_NOTICE, documents },
        'p@example.test',
      ).props.intro
    }

    expect(introFor(['privacy-policy', 'terms-of-use'])).toBe(
      'I\'m changing how Besidka handles your data and the rules for using '
      + 'it. Here\'s what changes:',
    )
    expect(introFor(['privacy-policy'])).toContain('handles your data')
    expect(introFor(['cookie-policy'])).toContain('handles your data')
    expect(introFor(['terms-of-use'])).toContain('rules for using Besidka')
  })

  it('carries the summary, the contact and an optional short-notice reason',
    () => {
      const plain = buildLegalNoticeEmail(BASE_NOTICE, 'p@example.test')
      const short = buildLegalNoticeEmail({
        ...BASE_NOTICE,
        shortNoticeReason: 'The law requires this change.',
      }, 'p@example.test')

      expect(plain.props.summary).toEqual(BASE_NOTICE.summary)
      expect(plain.props.contactEmail).toBe('p@example.test')
      expect(plain.props).not.toHaveProperty('shortNoticeReason')
      expect(short.props.shortNoticeReason).toBe(
        'The law requires this change.',
      )
    })

  it('builds an email for every registered notice', () => {
    for (const notice of LEGAL_NOTICES) {
      const { subject, props } = buildLegalNoticeEmail(notice, 'p@example.test')

      expect(subject).toContain('take effect on')
      expect(props.summary.length).toBeGreaterThan(0)
    }
  })
})

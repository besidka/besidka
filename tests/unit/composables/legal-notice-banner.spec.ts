import { describe, expect, it } from 'vitest'
import { LEGAL_NOTICES } from '#shared/utils/legal-notices'
import {
  formatLegalDocumentList,
  getLegalNoticeHref,
} from '../../../app/composables/legal-notice-banner'

describe('legal notice banner helpers', () => {
  it('names one document on its own', () => {
    expect(formatLegalDocumentList(['cookie-policy'])).toBe('Cookie Policy')
  })

  it('joins two documents with and', () => {
    expect(formatLegalDocumentList(['privacy-policy', 'terms-of-use']))
      .toBe('Privacy Policy and Terms of Use')
  })

  it('joins three documents with commas and a final and', () => {
    expect(
      formatLegalDocumentList([
        'privacy-policy',
        'terms-of-use',
        'cookie-policy',
      ]),
    ).toBe('Privacy Policy, Terms of Use and Cookie Policy')
  })

  it('points at the change history of the first document', () => {
    const [notice] = LEGAL_NOTICES

    expect(getLegalNoticeHref(notice)).toBe('/privacy-policy#change-history')
    expect(getLegalNoticeHref({
      ...notice,
      documents: ['terms-of-use', 'privacy-policy'],
    })).toBe('/terms-of-use#change-history')
  })
})

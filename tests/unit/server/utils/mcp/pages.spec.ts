import { describe, expect, it } from 'vitest'
import { LEGAL_CHANGE_HISTORY_EMPTY_TEXT } from '#shared/utils/legal-change-history'
import {
  createPageComponentRenderers,
  formatPublicPage,
  publicPageSlugs,
  publicPages,
} from '~~/server/utils/mcp/pages'
import type { PublicPageRecord } from '~~/server/utils/mcp/pages'

const page: PublicPageRecord = {
  title: 'Terms of Use',
  description: 'The rules.',
  updatedAt: '2026-10-28',
  summary: undefined,
  body: {
    type: 'minimark',
    value: [
      ['p', {}, 'Email ', ['privacy-email-link', {}], '.'],
    ],
  },
}

describe('publicPages', () => {
  it('maps each slug to a content path under its collection', () => {
    for (const slug of publicPageSlugs) {
      const { collection, contentPath, route } = publicPages[slug]
      const folder = collection === 'legal' ? '/legal/' : '/guides/'

      expect(contentPath.startsWith(folder)).toBe(true)
      expect(route.startsWith('/')).toBe(true)
    }
  })
})

describe('formatPublicPage', () => {
  it('returns the public URL and markdown with the privacy email filled in', () => {
    const formatted = formatPublicPage(
      'terms-of-use',
      page,
      'https://besidka.com',
      createPageComponentRenderers('privacy@besidka.com'),
    )

    expect(formatted).toMatchObject({
      slug: 'terms-of-use',
      url: 'https://besidka.com/terms-of-use',
      markdown: 'Email privacy@besidka.com.',
    })
  })

  it('renders the account email list component as a markdown list', () => {
    const formatted = formatPublicPage(
      'privacy-policy',
      {
        ...page,
        body: { type: 'minimark', value: [['account-email-list', {}]] },
      },
      'https://besidka.com',
      createPageComponentRenderers('privacy@besidka.com'),
    )

    expect(formatted.markdown).toContain(
      '1. **Address and password:** email address verification, password '
      + 'reset and confirmation of a new email address.',
    )
    expect(formatted.markdown).toContain(
      '2. **Account deletion:** a confirmation link when you ask to delete '
      + 'your account.',
    )
    expect(formatted.markdown).toContain(
      '3. **Security notices**, when something on your account changes: ',
    )
  })

  it('renders the change history component for its document', () => {
    const formatted = formatPublicPage(
      'privacy-policy',
      {
        ...page,
        body: {
          type: 'minimark',
          value: [['legal-change-history', { document: 'cookie-policy' }]],
        },
      },
      'https://besidka.com',
      createPageComponentRenderers('privacy@besidka.com'),
    )

    expect(formatted.markdown).toBe(LEGAL_CHANGE_HISTORY_EMPTY_TEXT)
  })

  it('does not publish the directive for an unknown document attribute', () => {
    const formatted = formatPublicPage(
      'privacy-policy',
      {
        ...page,
        body: {
          type: 'minimark',
          value: [['legal-change-history', { document: 'nope' }]],
        },
      },
      'https://besidka.com',
      createPageComponentRenderers('privacy@besidka.com'),
    )

    expect(formatted.markdown).not.toContain('legal-change-history')
  })
})

import { describe, expect, it } from 'vitest'
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
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const NOINDEX_NOFOLLOW_PATTERN
  = /robots\s*:\s*['"]noindex\s*,\s*nofollow['"]/

function readPageSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8')
}

describe('auth pages set a crawlable noindex meta', () => {
  it(
    'sets robots: noindex, nofollow on signin.vue, since /signin was '
    + 'deliberately removed from robots.disallow — a Disallow-ed URL is '
    + 'never fetched, so this useSeoMeta line is the only remaining guard '
    + 'against indexing',
    () => {
      const source = readPageSource('app/pages/(auth)/signin.vue')

      expect(source).toMatch(NOINDEX_NOFOLLOW_PATTERN)
    },
  )

  it(
    'sets robots: noindex, nofollow on signup.vue, since /signup was '
    + 'deliberately removed from robots.disallow — a Disallow-ed URL is '
    + 'never fetched, so this useSeoMeta line is the only remaining guard '
    + 'against indexing',
    () => {
      const source = readPageSource('app/pages/(auth)/signup.vue')

      expect(source).toMatch(NOINDEX_NOFOLLOW_PATTERN)
    },
  )

  it(
    'sets robots: noindex, nofollow on reset-password.vue, since '
    + '/reset-password was deliberately removed from robots.disallow — '
    + 'a Disallow-ed URL is never fetched, so this useSeoMeta line is the '
    + 'only remaining guard against indexing',
    () => {
      const source = readPageSource('app/pages/(auth)/reset-password.vue')

      expect(source).toMatch(NOINDEX_NOFOLLOW_PATTERN)
    },
  )

  it(
    'sets robots: noindex, nofollow on new-password.vue as a second '
    + 'layer of defense — the route is still disallowed in robots.txt, '
    + 'but this test guards against that disallow rule being removed '
    + 'without this meta being added',
    () => {
      const source = readPageSource('app/pages/(auth)/new-password.vue')

      expect(source).toMatch(NOINDEX_NOFOLLOW_PATTERN)
    },
  )

  it(
    'sets robots: noindex, nofollow on 2fa.vue as a second layer of '
    + 'defense — the route is still disallowed in robots.txt, but this '
    + 'test guards against that disallow rule being removed without '
    + 'this meta being added',
    () => {
      const source = readPageSource('app/pages/(auth)/2fa.vue')

      expect(source).toMatch(NOINDEX_NOFOLLOW_PATTERN)
    },
  )
})

const LEGAL_DOCUMENTS = [
  'privacy-policy',
  'terms-of-use',
  'cookie-policy',
] as const

function readFrontmatter(slug: string): string {
  const source = readPageSource(`content/legal/${slug}.md`)
  const frontmatterMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)

  return frontmatterMatch?.[1] ?? ''
}

function readFrontmatterValue(slug: string, key: string): string {
  const valueMatch = readFrontmatter(slug).match(
    new RegExp(`^${key}:\\s*(.+)$`, 'm'),
  )

  return (valueMatch?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
}

describe('useLegalDocument', () => {
  it(
    'derives the collection path and the payload key from one route slug, so '
    + 'a renamed document cannot leave a page querying a path that no longer '
    + 'exists while still rendering its hardcoded fallback title',
    () => {
      const source = readPageSource('app/composables/legal-document.ts')

      expect(source).toContain('queryCollection(\'legal\')')
      expect(source).toMatch(/path\(`\/legal\/\$\{slug\}`\)/)
      expect(source).toMatch(/`legal-\$\{slug\}`/)
    },
  )
})

describe.each(LEGAL_DOCUMENTS)(
  'legal page %s is content-driven and carries its own SEO meta',
  (slug) => {
    it(
      'fetches through useLegalDocument, since the page renders nothing and '
      + 'silently falls back to a hardcoded title when the path no longer '
      + 'matches a content file',
      () => {
        const source = readPageSource(`app/pages/(legal)/${slug}.vue`)

        expect(source).toContain('useLegalDocument()')
        expect(source).not.toContain('queryCollection(')
      },
    )

    it(
      'sources both title and description from the content document, so the '
      + 'frontmatter stays the single source of truth for this page\'s meta',
      () => {
        const source = readPageSource(`app/pages/(legal)/${slug}.vue`)

        expect(source).toMatch(/title\s*:\s*\(\)\s*=>\s*page\.value\?\.title/)
        expect(source).toMatch(
          /description\s*:\s*\(\)\s*=>\s*page\.value\?\.description/,
        )
      },
    )

    it(
      'has a non-empty description in its content frontmatter, since a '
      + 'missing one silently falls back to the global description and '
      + 'reintroduces duplicate meta descriptions across pages',
      () => {
        expect(readFrontmatterValue(slug, 'description')).toBeTruthy()
      },
    )

    it(
      'has a non-empty title and updatedAt in its content frontmatter — '
      + 'updatedAt is rendered to users and used as the sitemap lastmod',
      () => {
        expect(readFrontmatterValue(slug, 'title')).toBeTruthy()
        expect(readFrontmatterValue(slug, 'updatedAt')).toMatch(
          /^\d{4}-\d{2}-\d{2}$/,
        )
      },
    )
  },
)

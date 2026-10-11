import { describe, expect, it } from 'vitest'
import {
  MAX_URLS_PER_REQUEST,
  buildPayload,
  classifyResponseStatus,
  extractLocs,
  filterSameHostUrls,
  hasIndexableChange,
  isSitemapIndex,
  isValidKey,
} from '../../../scripts/indexnow-submit.mjs'

describe('isValidKey', () => {
  it('accepts 8-128 characters of letters, digits and dashes', () => {
    expect(isValidKey('a1b2c3d4')).toBe(true)
    expect(isValidKey('0f3c-9a7e-41bd-8c2e')).toBe(true)
    expect(isValidKey('a'.repeat(128))).toBe(true)
  })

  it('rejects keys outside the IndexNow spec', () => {
    expect(isValidKey('short')).toBe(false)
    expect(isValidKey('a'.repeat(129))).toBe(false)
    expect(isValidKey('has_underscore_1')).toBe(false)
    expect(isValidKey(undefined)).toBe(false)
  })
})

describe('hasIndexableChange', () => {
  it('submits when content or a public page changed', () => {
    expect(hasIndexableChange(['content/index.md'])).toBe(true)
    expect(hasIndexableChange(['content/guides/byok.md'])).toBe(true)
    expect(hasIndexableChange(['app/pages/byok.vue'])).toBe(true)
    expect(hasIndexableChange(['app/pages/(legal)/terms-of-use.vue']))
      .toBe(true)
    expect(hasIndexableChange(['app/components/content/HomeFaq.vue']))
      .toBe(true)
  })

  it('skips deploys that cannot change what crawlers see', () => {
    expect(hasIndexableChange([
      'server/api/v1/chats/[slug]/index.post.ts',
      'app/pages/chats/new.vue',
      'app/pages/profile/keys.vue',
      'app/pages/(auth)/signin.vue',
      'tests/unit/config/seo.spec.ts',
    ])).toBe(false)
    expect(hasIndexableChange([])).toBe(false)
  })
})

describe('extractLocs and isSitemapIndex', () => {
  const urlset = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://besidka.com/</loc></url>
  <url><loc>
    https://besidka.com/byok
  </loc></url>
  <url><loc>https://besidka.com/a?x=1&amp;y=2</loc></url>
</urlset>`

  it('reads every <loc>, trimmed and entity-decoded', () => {
    expect(extractLocs(urlset)).toEqual([
      'https://besidka.com/',
      'https://besidka.com/byok',
      'https://besidka.com/a?x=1&y=2',
    ])
  })

  it('tells a sitemap index from a urlset', () => {
    expect(isSitemapIndex(urlset)).toBe(false)
    expect(isSitemapIndex(
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
      + '<sitemap><loc>https://besidka.com/__sitemap__/en.xml</loc></sitemap>'
      + '</sitemapindex>',
    )).toBe(true)
  })
})

describe('filterSameHostUrls', () => {
  it('keeps unique same-host URLs and drops other hosts and junk', () => {
    expect(filterSameHostUrls([
      'https://besidka.com/',
      'https://besidka.com/',
      'https://www.besidka.com/byok',
      'https://example.com/',
      'not a url',
      'https://besidka.com/byok',
    ], 'https://besidka.com')).toEqual([
      'https://besidka.com/',
      'https://besidka.com/byok',
    ])
  })
})

describe('buildPayload', () => {
  it('points keyLocation at the Worker-served key file on the same host',
    () => {
      expect(buildPayload({
        siteUrl: 'https://besidka.com',
        key: 'a1b2c3d4',
        urls: ['https://besidka.com/'],
      })).toEqual({
        host: 'besidka.com',
        key: 'a1b2c3d4',
        keyLocation: 'https://besidka.com/indexnow-key.txt',
        urlList: ['https://besidka.com/'],
      })
    })

  it('caps the URL list at the per-request limit', () => {
    const length = MAX_URLS_PER_REQUEST + 5
    const urls = Array.from({ length }, (_, index) => {
      return `https://besidka.com/${index}`
    })

    expect(buildPayload({
      siteUrl: 'https://besidka.com',
      key: 'a1b2c3d4',
      urls,
    }).urlList).toHaveLength(MAX_URLS_PER_REQUEST)
  })
})

describe('classifyResponseStatus', () => {
  it('accepts 200 and 202', () => {
    expect(classifyResponseStatus(200)).toBe('ok')
    expect(classifyResponseStatus(202)).toBe('ok')
  })

  it('treats rate limits and server errors as transient', () => {
    expect(classifyResponseStatus(429)).toBe('transient')
    expect(classifyResponseStatus(503)).toBe('transient')
  })

  it('fails on key or request errors', () => {
    expect(classifyResponseStatus(400)).toBe('error')
    expect(classifyResponseStatus(403)).toBe('error')
    expect(classifyResponseStatus(422)).toBe('error')
  })
})

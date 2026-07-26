import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('defineNuxtConfig', <Configuration>(configuration: Configuration) => {
  return configuration
})

const { default: configuration } = await import('../../../nuxt.config')

describe('robots and sitemap configuration contract', () => {
  it('disallows private, non-public surfaces in robots.txt', () => {
    const disallow = configuration.robots?.disallow

    expect(disallow).toContain('/api/')
    expect(disallow).toContain('/chats/')
    expect(disallow).toContain('/files/')
    expect(disallow).toContain('/profile/')
    expect(disallow).toContain('/_studio')
    expect(disallow).toContain('/__nuxt_content/')
  })

  it(
    'does not disallow auth routes, since a Disallow-ed URL is never '
    + 'fetched so its noindex meta is never read and the URL can still be '
    + 'indexed without content — the landing hero CTA links straight to '
    + '/signup, so those pages rely on a crawlable useSeoMeta '
    + 'noindex/nofollow instead',
    () => {
      const disallow = configuration.robots?.disallow

      expect(disallow).not.toContain('/signin')
      expect(disallow).not.toContain('/signup')
      expect(disallow).not.toContain('/reset-password')
      expect(disallow).not.toContain('/new-password')
    },
  )

  it(
    'excludes auth routes and private paths from the sitemap, since '
    + 'they must stay crawlable but should never be advertised as '
    + 'indexable URLs',
    () => {
      const exclude = configuration.sitemap?.exclude

      expect(exclude).toContain('/api/**')
      expect(exclude).toContain('/chats/**')
      expect(exclude).toContain('/files/**')
      expect(exclude).toContain('/profile/**')
      expect(exclude).toContain('/_studio')
      expect(exclude).toContain('/__nuxt_content/**')
      expect(exclude).toContain('/signin')
      expect(exclude).toContain('/signup')
      expect(exclude).toContain('/reset-password')
      expect(exclude).toContain('/new-password')
    },
  )

  it(
    'falls back the canonical site URL to the www host when '
    + 'NUXT_PUBLIC_BASE_URL is unset',
    () => {
      expect(configuration.site?.url).toBe('https://www.besidka.com')
    },
  )
})

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
    'does not disallow the crawler-reachable auth routes, since a '
    + 'Disallow-ed URL is never fetched so its noindex meta is never read '
    + 'and the bare URL can still be indexed without content — the hero CTA '
    + 'links to /signup and /signin links to /reset-password, so those pages '
    + 'rely on a crawlable useSeoMeta noindex/nofollow instead',
    () => {
      const disallow = configuration.robots?.disallow

      expect(disallow).not.toContain('/signin')
      expect(disallow).not.toContain('/signup')
      expect(disallow).not.toContain('/reset-password')
    },
  )

  it(
    'still disallows /new-password, which is only reachable through a '
    + 'tokened email link — nothing crawlable points at it, so there is no '
    + 'discovery for a noindex to prevent, and keeping it disallowed keeps '
    + 'token-bearing URLs away from crawlers and link prefetchers',
    () => {
      expect(configuration.robots?.disallow).toContain('/new-password')
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
    'falls back the canonical site URL to the apex host when '
    + 'NUXT_PUBLIC_BASE_URL is unset',
    () => {
      expect(configuration.site?.url).toBe('https://besidka.com')
    },
  )
})

describe('agent discovery configuration contract', () => {
  const contentSignal = 'search=yes, ai-input=yes, ai-train=no'

  it('emits one Content-Signal in the wildcard robots group', () => {
    expect(configuration.robots?.groups).toEqual([
      { userAgent: ['*'], contentSignal },
    ])
    expect(configuration.robots).not.toHaveProperty('blockAiBots')
  })

  it('keeps the agent discovery robots policy off and its signal in step',
    () => {
      expect(configuration.agentDiscovery?.robots).toEqual({
        aiPolicy: false,
        contentSignal,
      })
      expect(configuration.agentDiscovery?.sitemap).toEqual({
        markdown: false,
      })
    })

  it('serves llms.txt on demand from the site URL, never prerendered', () => {
    expect(configuration.llms?.prerender).toBe(false)
    expect(configuration.llms?.domain).toBe(configuration.site?.url)
    expect(configuration.agentDiscovery?.siteUrl)
      .toBe(configuration.site?.url)
  })

  it('describes docs and blog as planned rather than published', () => {
    const notes = (configuration.llms?.notes ?? []).join(' ')

    expect(notes).toContain('/docs')
    expect(notes).toContain('/blog')
    expect(notes).toContain('planned')
  })

  it('negotiates markdown only for the public content set', () => {
    const paths = (configuration.agentDiscovery?.routes ?? []).map((route) => {
      return typeof route === 'string' ? route : route.path
    })

    expect(paths).toEqual([
      '/',
      '/byok',
      '/memory',
      '/privacy-policy',
      '/terms-of-use',
      '/cookie-policy',
      '/guides/**',
    ])
  })

  it('maps each page route to the raw twin of its content path', () => {
    const rawByPath = Object.fromEntries(
      (configuration.agentDiscovery?.routes ?? [])
        .filter((route) => {
          return typeof route !== 'string'
        })
        .map((route) => {
          return [route.path, route.raw]
        }),
    )

    expect(rawByPath).toEqual({
      '/byok': '/raw/guides/byok.md',
      '/memory': '/raw/guides/memory.md',
      '/privacy-policy': '/raw/legal/privacy-policy.md',
      '/terms-of-use': '/raw/legal/terms-of-use.md',
      '/cookie-policy': '/raw/legal/cookie-policy.md',
    })
  })

  it('never answers an agent with markdown on private surfaces', () => {
    const excluded = configuration.agentDiscovery?.excludePrefixes?.extend

    expect(excluded).toEqual(
      expect.arrayContaining(['/chats', '/profile', '/files']),
    )
  })

  it('redirects content paths that are not pages to the real page', () => {
    expect(configuration.routeRules?.['/guides/byok']).toEqual({
      redirect: { to: '/byok', statusCode: 301 },
    })
    expect(configuration.routeRules?.['/legal/privacy-policy']).toEqual({
      redirect: { to: '/privacy-policy', statusCode: 301 },
    })
  })

  it('clears every route the build would prerender', () => {
    const registered: Array<(routes: Set<string>) => void> = []
    const nitro = {
      hooks: {
        hook: (name: string, handler: (routes: Set<string>) => void) => {
          if (name === 'prerender:routes') {
            registered.push(handler)
          }
        },
      },
    }
    const hooks = configuration.hooks as unknown as Record<
      string,
      (nitro: unknown) => void
    >

    hooks['nitro:build:before']!(nitro)

    const routes = new Set(['/raw/index.md', '/llms.txt', '/sitemap.md'])

    registered.forEach((handler) => {
      handler(routes)
    })

    expect(registered).toHaveLength(1)
    expect(routes.size).toBe(0)
  })
})

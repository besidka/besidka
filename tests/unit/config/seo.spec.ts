import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isNegotiablePath,
  normalizePathname,
} from '../../../node_modules/nuxt-agent-discovery/dist/runtime/shared/negotiation.js'
import type { NegotiationConfig } from '../../../node_modules/nuxt-agent-discovery/dist/runtime/shared/types'
import {
  agentDiscoveryRoutes,
  contentPathRedirects,
} from '~~/config/agent-discovery-routes'

const MODULE_DEFAULT_EXCLUDE_PREFIXES = ['/_', '/api/', '/mcp', '/.well-known/']

vi.stubGlobal('defineNuxtConfig', <Configuration>(configuration: Configuration) => {
  return configuration
})
vi.stubEnv('NUXT_PUBLIC_BASE_URL', '')

const { default: configuration } = await import('../../../nuxt.config')

type ReadyHook = (nuxt: {
  options: { dev: boolean, test: boolean, _prepare: boolean }
}) => void

async function importConfigurationWithBaseUrl(baseUrl: string) {
  vi.resetModules()
  vi.stubEnv('NUXT_PUBLIC_BASE_URL', baseUrl)

  const { default: reimported } = await import('../../../nuxt.config')

  return reimported
}

function createNegotiationConfig(): NegotiationConfig {
  const extendedPrefixes
    = configuration.agentDiscovery?.excludePrefixes?.extend ?? []

  return {
    siteUrl: 'https://besidka.com',
    siteName: 'Besidka',
    rawPrefix: '/raw',
    routes: agentDiscoveryRoutes.map((route) => {
      return typeof route === 'string' ? { path: route } : route
    }),
    userAgents: [],
    excludePrefixes: [
      ...MODULE_DEFAULT_EXCLUDE_PREFIXES,
      ...extendedPrefixes,
    ],
    links: [],
    linkHeader: true,
    sitemapSections: { expand: [], labels: {} },
    cachedRoutes: [],
    notAcceptable: false,
  }
}

afterEach(() => {
  vi.stubEnv('NUXT_PUBLIC_BASE_URL', '')
})

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

  it('serves llms.txt on demand, never prerendered', () => {
    expect(configuration.llms?.prerender).toBe(false)
  })

  it('bakes the apex URL into llms.txt and discovery when no base URL is set',
    () => {
      expect(configuration.llms?.domain).toBe('https://besidka.com')
      expect(configuration.agentDiscovery?.siteUrl)
        .toBe('https://besidka.com')
    })

  it('fails a production build whose site URL is not https', async () => {
    const reimported = await importConfigurationWithBaseUrl(
      'http://localhost:3000',
    )
    const ready = reimported.hooks!.ready as unknown as ReadyHook

    expect(() => {
      ready({ options: { dev: false, test: false, _prepare: false } })
    }).toThrow(/NUXT_PUBLIC_BASE_URL/)
  })

  it('lets dev and prepare runs keep a local site URL', async () => {
    const reimported = await importConfigurationWithBaseUrl(
      'http://localhost:3000',
    )
    const ready = reimported.hooks!.ready as unknown as ReadyHook

    expect(() => {
      ready({ options: { dev: true, test: false, _prepare: false } })
      ready({ options: { dev: false, test: false, _prepare: true } })
      ready({ options: { dev: false, test: true, _prepare: false } })
    }).not.toThrow()
  })

  it('lets a production build run with the default or an https URL',
    async () => {
      const ready = configuration.hooks!.ready as unknown as ReadyHook
      const reimported = await importConfigurationWithBaseUrl(
        'https://staging.besidka.com',
      )
      const stagingReady = reimported.hooks!.ready as unknown as ReadyHook

      expect(() => {
        ready({ options: { dev: false, test: false, _prepare: false } })
        stagingReady({ options: { dev: false, test: false, _prepare: false } })
      }).not.toThrow()
    })

  it('forbids framing the sign-in, sign-up, 2FA and consent pages', () => {
    for (const path of ['/signin', '/signup', '/2fa', '/oauth/**']) {
      expect(configuration.routeRules?.[path]).toEqual({
        headers: expect.objectContaining({
          'Content-Security-Policy': 'frame-ancestors \'none\'',
          'X-Frame-Options': 'DENY',
        }),
      })
    }
  })

  it('caches the raw markdown twins like the landing page', () => {
    const productionRules = (configuration as unknown as {
      $production: { routeRules: Record<string, unknown> }
    }).$production.routeRules

    expect(productionRules['/raw/**']).toEqual({
      cache: expect.objectContaining({ swr: false, maxAge: 3600 }),
    })
    expect(productionRules['/raw/**']).toEqual(productionRules['/'])
  })

  it('advertises the MCP server card and llms.txt on the MCP anchor', () => {
    const anchored = (configuration.agentDiscovery?.discovery?.links ?? [])
      .filter((link) => {
        return link.anchor === '/mcp'
      })

    expect(anchored).toEqual([
      expect.objectContaining({
        href: '/.well-known/mcp/server-card.json',
        rel: 'service-desc',
        header: false,
      }),
      expect.objectContaining({
        href: '/llms.txt',
        rel: 'service-doc',
        header: false,
      }),
    ])
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

  it.each([
    '/chats/x',
    '/profile',
    '/files/x',
    '/shared/x',
    '/signin',
    '/api/v1/x',
    '/mcp',
  ])('never negotiates markdown on %s', (path) => {
    expect(isNegotiablePath(createNegotiationConfig(), path)).toBe(false)
  })

  it.each([
    '/',
    '/byok',
    '/memory',
    '/privacy-policy',
    '/guides/openai-api-key',
  ])('negotiates markdown on the public page %s', (path) => {
    expect(isNegotiablePath(createNegotiationConfig(), path)).toBe(true)
  })

  it('normalizes a trailing slash before matching a route', () => {
    expect(normalizePathname('/byok/')).toBe('/byok')
    expect(isNegotiablePath(createNegotiationConfig(), '/byok/')).toBe(true)
  })

  it('redirects every content path that is not a page to the real page', () => {
    expect(contentPathRedirects).toEqual({
      '/guides/byok': { redirect: { to: '/byok', statusCode: 301 } },
      '/guides/memory': { redirect: { to: '/memory', statusCode: 301 } },
      '/legal/privacy-policy': {
        redirect: { to: '/privacy-policy', statusCode: 301 },
      },
      '/legal/terms-of-use': {
        redirect: { to: '/terms-of-use', statusCode: 301 },
      },
      '/legal/cookie-policy': {
        redirect: { to: '/cookie-policy', statusCode: 301 },
      },
    })

    for (const [path, rule] of Object.entries(contentPathRedirects)) {
      expect(configuration.routeRules?.[path]).toEqual(rule)
    }
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

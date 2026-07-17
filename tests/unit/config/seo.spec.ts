import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    app: {
      baseURL: '/',
    },
    public: {
      baseUrl: 'https://www.besidka.com',
    },
  })
})

vi.stubGlobal('defineNuxtConfig', <Configuration>(configuration: Configuration) => {
  return configuration
})
vi.stubGlobal('defineEventHandler', <Handler>(handler: Handler) => handler)
vi.stubGlobal('setHeader', vi.fn())

const { default: configuration } = await import('../../../nuxt.config')
const { default: sitemapHandler } = await import(
  '../../../server/routes/sitemap.xml'
)

describe('private file SEO configuration', () => {
  it('blocks file responses in robots.txt', () => {
    expect(configuration.robots?.disallow).toContain('/files/')
  })

  it('renders only public URLs without private file paths', () => {
    const xml = sitemapHandler({} as never)
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => {
      return match[1]
    })

    expect(urls).toEqual([
      'https://www.besidka.com/',
      'https://www.besidka.com/privacy',
      'https://www.besidka.com/terms',
    ])
    expect(xml).not.toContain('/files')
  })
})

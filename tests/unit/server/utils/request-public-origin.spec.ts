import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestEvent } from 'nuxt/server'

const PREVIEW_HOSTS = '*-besidka.chernenko.workers.dev'
const LONG_LIVED_PREVIEW = 'https://preview-besidka.chernenko.workers.dev'

const mocks = vi.hoisted(() => {
  return {
    runtimeConfig: {
      authAdditionalAllowedHosts: '',
      public: { baseUrl: '' },
    },
  }
})

vi.mock('#app/nuxt', () => {
  return {
    useRuntimeConfig: () => {
      return mocks.runtimeConfig
    },
  }
})

vi.mock('nuxt/server', () => {
  return {
    getRequestURL: (event: {
      node: { req: { headers: Record<string, string> } }
    }) => {
      const headers = event.node.req.headers

      return new URL(`http://${headers.host}/`)
    },
  }
})

interface CloudflareEventOptions {
  requestUrl?: string
  hostHeader?: string
}

function createCloudflareEvent(
  options: CloudflareEventOptions,
): RequestEvent {
  const requestUrl = options.requestUrl
  const hostHeader = options.hostHeader
    ?? (requestUrl ? new URL(requestUrl).host : 'localhost')

  return {
    node: { req: { headers: { host: hostHeader } } },
    context: requestUrl ? { cloudflare: { url: new URL(requestUrl) } } : {},
  } as unknown as RequestEvent
}

function usePreviewConfig() {
  mocks.runtimeConfig.public.baseUrl = LONG_LIVED_PREVIEW
  mocks.runtimeConfig.authAdditionalAllowedHosts = PREVIEW_HOSTS
}

describe('resolveRequestPublicOrigin', () => {
  beforeEach(() => {
    vi.stubGlobal('useRuntimeConfig', () => {
      return mocks.runtimeConfig
    })
    mocks.runtimeConfig.public.baseUrl = ''
    mocks.runtimeConfig.authAdditionalAllowedHosts = ''
  })

  it.each([
    'https://pr-1015-besidka.chernenko.workers.dev',
    'https://32e00506-besidka.chernenko.workers.dev',
    LONG_LIVED_PREVIEW,
  ])('returns the own origin of the preview host %s', async (origin) => {
    usePreviewConfig()

    const { resolveRequestPublicOrigin } = await import(
      '~~/server/utils/request-public-origin'
    )

    expect(resolveRequestPublicOrigin(createCloudflareEvent({
      requestUrl: `${origin}/api/v1/connectors`,
    }))).toBe(origin)
  })

  it('keeps the configured base URL in production', async () => {
    mocks.runtimeConfig.public.baseUrl = 'https://besidka.com'

    const { resolveRequestPublicOrigin } = await import(
      '~~/server/utils/request-public-origin'
    )

    expect(resolveRequestPublicOrigin(createCloudflareEvent({
      requestUrl: 'https://besidka.com/api/v1/connectors',
    }))).toBe('https://besidka.com')
    expect(resolveRequestPublicOrigin(createCloudflareEvent({
      requestUrl: 'https://www.besidka.com/api/v1/connectors',
    }))).toBe('https://besidka.com')
  })

  it.each([
    'https://besidka.com',
    'https://evil.example.com',
    'https://evil-besidka.chernenko.workers.dev.attacker.com',
    'https://x.pr-1-besidka.chernenko.workers.dev',
  ])('gives the configured origin to the foreign host %s', async (origin) => {
    usePreviewConfig()

    const { resolveRequestPublicOrigin } = await import(
      '~~/server/utils/request-public-origin'
    )

    expect(resolveRequestPublicOrigin(createCloudflareEvent({
      requestUrl: `${origin}/api/v1/connectors`,
    }))).toBe(LONG_LIVED_PREVIEW)
  })

  it('refuses a plain-http request on a preview host', async () => {
    usePreviewConfig()

    const { resolveRequestPublicOrigin } = await import(
      '~~/server/utils/request-public-origin'
    )

    expect(resolveRequestPublicOrigin(createCloudflareEvent({
      requestUrl: 'http://pr-1015-besidka.chernenko.workers.dev/',
    }))).toBe(LONG_LIVED_PREVIEW)
  })

  it('ignores the Host header when the platform URL names another host',
    async () => {
      usePreviewConfig()

      const { resolveRequestPublicOrigin } = await import(
        '~~/server/utils/request-public-origin'
      )

      expect(resolveRequestPublicOrigin(createCloudflareEvent({
        requestUrl: 'https://besidka.com/',
        hostHeader: 'pr-1015-besidka.chernenko.workers.dev',
      }))).toBe(LONG_LIVED_PREVIEW)
    })

  it('falls back to the h3 request URL without a platform URL', async () => {
    mocks.runtimeConfig.public.baseUrl = 'http://localhost:3000'

    const { resolveRequestPublicOrigin } = await import(
      '~~/server/utils/request-public-origin'
    )

    expect(resolveRequestPublicOrigin(createCloudflareEvent({
      hostHeader: 'localhost:3000',
    }))).toBe('http://localhost:3000')
  })
})

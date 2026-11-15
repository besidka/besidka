import { describe, expect, it, vi } from 'vitest'
import { resolvePublicOrigin } from '~~/server/utils/auth-hosts'
import { buildConnectorClientMetadata } from '~~/server/utils/connectors/client-metadata'

const mocks = vi.hoisted(() => ({ origin: 'https://besidka.com' }))

vi.mock('nuxt/server', () => ({
  defineEventHandler: (handler: unknown) => handler,
}))

vi.mock('~~/server/utils/request-public-origin', () => ({
  resolveRequestPublicOrigin: () => mocks.origin,
}))

const PREVIEW_HOSTS = '*-besidka.chernenko.workers.dev'
const PREVIEW_BASE = 'https://preview-besidka.chernenko.workers.dev'

describe('connector Client ID Metadata Document', () => {
  it('serves the document with a stable cache header', async () => {
    const { default: handler } = await import(
      '~~/server/routes/connectors/client-metadata.json.get'
    )
    const event = { res: { headers: new Headers() } }
    const document = (handler as (input: unknown) => unknown)(event)

    expect(document).toEqual({
      client_id: 'https://besidka.com/connectors/client-metadata.json',
      client_name: 'Besidka',
      client_uri: 'https://besidka.com/',
      logo_uri: 'https://besidka.com/web-app-manifest-512x512.png',
      policy_uri: 'https://besidka.com/privacy-policy',
      tos_uri: 'https://besidka.com/terms-of-use',
      redirect_uris: ['https://besidka.com/api/v1/connectors/oauth/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    })
    expect(event.res.headers.get('cache-control'))
      .toBe('public, max-age=3600')
    expect(event.res.headers.get('content-type')).toBe('application/json')
    expect(JSON.stringify(document)).not.toContain('contacts')
  })

  it('has one exact redirect URI on the same origin as client_id', () => {
    const document = buildConnectorClientMetadata('https://besidka.com')

    expect(document.redirect_uris).toHaveLength(1)
    expect(new URL(document.redirect_uris[0]!).origin)
      .toBe(new URL(document.client_id).origin)
  })

  describe('origin rule', () => {
    it('ignores the Host header in production', () => {
      expect(resolvePublicOrigin(
        new URL('https://attacker.example/connectors/client-metadata.json'),
        'https://besidka.com',
        '',
      )).toBe('https://besidka.com')
    })

    it('uses an allow-listed preview host', () => {
      expect(resolvePublicOrigin(
        new URL('https://pr-12-besidka.chernenko.workers.dev/x'),
        PREVIEW_BASE,
        PREVIEW_HOSTS,
      )).toBe('https://pr-12-besidka.chernenko.workers.dev')
    })

    it('falls back to the base URL for any other host on a preview', () => {
      expect(resolvePublicOrigin(
        new URL('https://evil.chernenko.workers.dev.attacker.example/x'),
        PREVIEW_BASE,
        PREVIEW_HOSTS,
      )).toBe(PREVIEW_BASE)
    })
  })
})

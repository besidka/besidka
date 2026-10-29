import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    runtimeConfig: { public: { baseUrl: 'https://besidka.com' } },
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
    defineEventHandler: (handler: unknown) => {
      return handler
    },
  }
})

function createEvent(origin = 'https://preview.besidka.dev') {
  return {
    url: new URL(`${origin}/.well-known/poppy.json`),
    res: { headers: new Headers() },
  }
}

async function callRoute(event: ReturnType<typeof createEvent>) {
  const siteOrigin = await import('~~/server/utils/agent-discovery/site-origin')

  vi.stubGlobal('getSiteHostname', siteOrigin.getSiteHostname)

  const { default: handler } = await import(
    '~~/server/routes/.well-known/poppy.json.get'
  )
  const body = await (handler as (event: unknown) => unknown)(event)

  return JSON.parse(body as string)
}

describe('GET /.well-known/poppy.json', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.runtimeConfig = { public: { baseUrl: 'https://besidka.com' } }
  })

  it('serves JSON with open CORS', async () => {
    const event = createEvent()

    await callRoute(event)

    expect(event.res.headers.get('content-type')).toContain('application/json')
    expect(event.res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('declares the organization and an empty web section', async () => {
    const poppy = await callRoute(createEvent())

    expect(poppy).toEqual({
      protocol_version: '0.1',
      organization: { name: 'Besidka', domain: 'besidka.com' },
      web: {},
    })
  })

  it('uses the request hostname when no base URL is configured', async () => {
    mocks.runtimeConfig = { public: { baseUrl: '' } }

    const poppy = await callRoute(createEvent())

    expect(poppy.organization.domain).toBe('preview.besidka.dev')
  })

  it('keeps the bare hostname as the domain when the origin has a port',
    async () => {
      mocks.runtimeConfig = { public: { baseUrl: '' } }

      const poppy = await callRoute(createEvent('http://localhost:3000'))

      expect(poppy.organization.domain).toBe('localhost')
    })
})

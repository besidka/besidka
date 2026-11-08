import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    runtimeConfig: { openaiAppsChallenge: '' },
    setResponseStatus: vi.fn(),
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
    setResponseStatus: mocks.setResponseStatus,
  }
})

function createEvent() {
  return {
    url: new URL('https://besidka.com/.well-known/openai-apps-challenge'),
    res: { headers: new Headers() },
  }
}

async function callRoute(event: ReturnType<typeof createEvent>) {
  const { default: handler } = await import(
    '~~/server/routes/.well-known/openai-apps-challenge.get'
  )

  return (handler as (event: unknown) => unknown)(event) as string | null
}

describe('GET /.well-known/openai-apps-challenge', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.setResponseStatus.mockClear()
    mocks.runtimeConfig = { openaiAppsChallenge: '' }
  })

  it('responds 404 when no token is configured', async () => {
    const event = createEvent()

    expect(await callRoute(event)).toBeNull()
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 404)
  })

  it('responds 404 when the token is only whitespace', async () => {
    mocks.runtimeConfig = { openaiAppsChallenge: '  \n ' }

    const event = createEvent()

    expect(await callRoute(event)).toBeNull()
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 404)
  })

  it('serves the trimmed token as plain text', async () => {
    mocks.runtimeConfig = { openaiAppsChallenge: '  token-abc123\n' }

    const event = createEvent()
    const body = await callRoute(event)

    expect(body).toBe('token-abc123')
    expect(event.res.headers.get('content-type'))
      .toBe('text/plain; charset=utf-8')
    expect(event.res.headers.get('cache-control'))
      .toBe('public, max-age=300')
    expect(event.res.headers.get('x-robots-tag')).toBe('noindex')
    expect(mocks.setResponseStatus).not.toHaveBeenCalled()
  })
})

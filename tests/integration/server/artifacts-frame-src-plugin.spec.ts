import { beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { buildArtifactFrameSrc } from '#shared/utils/artifact-frame-policy'

const ARTIFACTS_ORIGIN = 'https://artifacts.example.test'
const TURNSTILE = 'https://challenges.cloudflare.com'
const SELF = '\'self\''

beforeAll(() => {
  vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
})

async function loadPlugin() {
  return await import('../../../server/plugins/artifacts-frame-src')
}

function createContext(path: string) {
  return { event: { path, context: {} } }
}

describe('artifacts frame-src plugin', () => {
  it('limits frames on a chat page to the artifacts origin', async () => {
    const { applyArtifactFrameSrc } = await loadPlugin()
    const response = { headers: { 'content-type': 'text/html' } }

    applyArtifactFrameSrc(
      response as never,
      createContext('/chats/01JCHAT') as never,
      { artifactsOrigin: ARTIFACTS_ORIGIN },
    )

    expect(response.headers).toEqual({
      'content-type': 'text/html',
      'content-security-policy': `frame-src ${SELF} ${ARTIFACTS_ORIGIN} ${TURNSTILE}`,
    })
  })

  it('limits frames on a shared chat page, ignoring the query', async () => {
    const { applyArtifactFrameSrc } = await loadPlugin()
    const response = { headers: {} as Record<string, string> }

    applyArtifactFrameSrc(
      response as never,
      createContext('/shared/01JSHARE?ref=x') as never,
      { artifactsOrigin: `${ARTIFACTS_ORIGIN}/v1/index.html` },
    )

    expect(response.headers['content-security-policy'])
      .toBe(`frame-src ${SELF} ${ARTIFACTS_ORIGIN} ${TURNSTILE}`)
  })

  it('limits frames on a public artifact link and the admin pages',
    async () => {
      const { applyArtifactFrameSrc } = await loadPlugin()

      for (const path of [
        '/artifacts/token-1',
        '/artifacts/token-1?utm_source=x',
        '/admin/artifact-reports',
      ]) {
        const response = { headers: {} as Record<string, string> }

        applyArtifactFrameSrc(
          response as never,
          createContext(path) as never,
          { artifactsOrigin: ARTIFACTS_ORIGIN },
        )

        expect(response.headers['content-security-policy'])
          .toBe(`frame-src ${SELF} ${ARTIFACTS_ORIGIN} ${TURNSTILE}`)
      }
    })

  it('keeps the frame-ancestors a route rule set on the event', async () => {
    const { applyArtifactFrameSrc } = await loadPlugin()
    const response = { headers: { 'content-type': 'text/html' } }

    applyArtifactFrameSrc(
      response as never,
      createContext('/artifacts/token-1') as never,
      {
        artifactsOrigin: ARTIFACTS_ORIGIN,
        eventPolicy: 'frame-ancestors \'none\'',
      },
    )

    expect(response.headers).toEqual({
      'content-type': 'text/html',
      'content-security-policy': 'frame-ancestors \'none\'; '
        + `frame-src ${SELF} ${ARTIFACTS_ORIGIN} ${TURNSTILE}`,
    })
  })

  it('prefers the renderer policy over the event policy', async () => {
    const { applyArtifactFrameSrc } = await loadPlugin()
    const response = {
      headers: { 'Content-Security-Policy': 'img-src data:' },
    }

    applyArtifactFrameSrc(
      response as never,
      createContext('/artifacts/token-1') as never,
      {
        artifactsOrigin: ARTIFACTS_ORIGIN,
        eventPolicy: 'frame-ancestors \'none\'',
      },
    )

    expect(response.headers['Content-Security-Policy']).toBe(
      `img-src data:; frame-src ${SELF} ${ARTIFACTS_ORIGIN} ${TURNSTILE}`,
    )
  })

  it('leaves other pages unchanged', async () => {
    const { applyArtifactFrameSrc } = await loadPlugin()

    for (const path of ['/', '/profile/keys', '/chats', '/sharedx', '/signin', '/admin', '/about/artifacts/x', '/about', '/ab', '/api/v1/x', '/artifactsx', '/a/tokenvalue']) {
      const response = { headers: { 'content-type': 'text/html' } }

      applyArtifactFrameSrc(
        response as never,
        createContext(path) as never,
        { artifactsOrigin: ARTIFACTS_ORIGIN },
      )

      expect(response.headers).toEqual({ 'content-type': 'text/html' })
    }
  })

  it('extends an existing policy instead of replacing it', async () => {
    const { applyArtifactFrameSrc } = await loadPlugin()
    const response = {
      headers: { 'Content-Security-Policy': 'frame-ancestors \'none\'' },
    }

    applyArtifactFrameSrc(
      response as never,
      createContext('/chats/new') as never,
      { artifactsOrigin: ARTIFACTS_ORIGIN },
    )

    expect(response.headers).toEqual({
      'Content-Security-Policy':
        `frame-ancestors 'none'; frame-src ${SELF} ${ARTIFACTS_ORIGIN} ${TURNSTILE}`,
    })
  })

  it('merges into an existing frame-src instead of adding a second one',
    async () => {
      const { applyArtifactFrameSrc } = await loadPlugin()
      const response = {
        headers: {
          'Content-Security-Policy':
            `default-src 'self'; frame-src ${SELF} https://example.com;`,
        },
      }

      applyArtifactFrameSrc(
        response as never,
        createContext('/chats/new') as never,
        { artifactsOrigin: ARTIFACTS_ORIGIN },
      )

      const policy = response.headers['Content-Security-Policy']

      expect(policy).toBe(
        `default-src 'self'; frame-src ${SELF} https://example.com `
        + `${ARTIFACTS_ORIGIN} ${TURNSTILE}`,
      )
      expect(policy.match(/frame-src/g)).toHaveLength(1)
    })

  it('replaces a frame-src of none with the artifact sources', async () => {
    const { mergeFrameSrc } = await loadPlugin()

    expect(mergeFrameSrc(
      'FRAME-SRC \'none\'; img-src data:',
      `frame-src ${SELF} ${ARTIFACTS_ORIGIN}`,
    )).toBe(`frame-src ${SELF} ${ARTIFACTS_ORIGIN}; img-src data:`)
  })

  it('appends frame-src when the policy only has default-src', async () => {
    const { mergeFrameSrc } = await loadPlugin()

    expect(mergeFrameSrc(
      'default-src \'self\'',
      `frame-src ${SELF} ${ARTIFACTS_ORIGIN}`,
    )).toBe(`default-src 'self'; frame-src ${SELF} ${ARTIFACTS_ORIGIN}`)
  })

  it('sends the same directive as the client meta policy', async () => {
    const { applyArtifactFrameSrc } = await loadPlugin()
    const response = { headers: {} as Record<string, string> }

    applyArtifactFrameSrc(
      response as never,
      createContext('/chats/new') as never,
      { artifactsOrigin: ARTIFACTS_ORIGIN },
    )

    expect(response.headers['content-security-policy'])
      .toBe(buildArtifactFrameSrc(ARTIFACTS_ORIGIN))
  })

  it('skips an origin that is not an http(s) URL', async () => {
    const { applyArtifactFrameSrc } = await loadPlugin()

    for (const artifactsOrigin of ['', 'not a url', 'javascript:alert(1)']) {
      const response = { headers: {} as Record<string, string> }

      applyArtifactFrameSrc(
        response as never,
        createContext('/chats/new') as never,
        { artifactsOrigin },
      )

      expect(response.headers).toEqual({})
    }
  })

  it('registers a render hook that uses the runtime config origin',
    async () => {
      const hooks: Record<string, Function> = {}
      const runtimeConfig = inject('nuxtRuntimeConfig') as {
        public: { artifactsOrigin: string }
      }
      const runtimeOrigin = new URL(runtimeConfig.public.artifactsOrigin).origin
      const { default: plugin } = await loadPlugin()
      const install = plugin as unknown as (app: unknown) => void

      install({
        hooks: {
          hook: (name: string, handler: Function) => {
            hooks[name] = handler
          },
        },
      })

      const response = { headers: {} as Record<string, string> }

      hooks['render:response']!(response, createContext('/chats/new'))

      expect(response.headers['content-security-policy'])
        .toMatch(new RegExp(
          `^frame-src 'self' ${runtimeOrigin} ${TURNSTILE}$`,
        ))
    })
})

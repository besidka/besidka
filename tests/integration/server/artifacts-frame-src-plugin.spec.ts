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

      await hooks['render:response']!(response, createContext('/chats/new'))

      expect(response.headers['content-security-policy'])
        .toMatch(new RegExp(
          `^frame-src 'self' ${runtimeOrigin} ${TURNSTILE}$`,
        ))
    })

  describe('Google Drive Picker', () => {
    const PICKER_FRAMES
      = 'https://docs.google.com/picker https://docs.google.com/picker/'

    it('lets a chat page frame the Picker path once it is allowed',
      async () => {
        const { applyArtifactFrameSrc } = await loadPlugin()
        const response = { headers: {} as Record<string, string> }

        applyArtifactFrameSrc(
          response as never,
          createContext('/chats/01JCHAT') as never,
          {
            artifactsOrigin: ARTIFACTS_ORIGIN,
            allowsGooglePicker: true,
          },
        )

        expect(response.headers['content-security-policy']).toBe(
          `frame-src ${SELF} ${ARTIFACTS_ORIGIN} ${TURNSTILE} ${PICKER_FRAMES}`,
        )
        expect(response.headers['content-security-policy'])
          .not.toContain('drive.google.com')
      })

    it('adds no Google frame while the Picker is not allowed',
      async () => {
        const { applyArtifactFrameSrc } = await loadPlugin()
        const response = { headers: {} as Record<string, string> }

        applyArtifactFrameSrc(
          response as never,
          createContext('/chats/01JCHAT') as never,
          { artifactsOrigin: ARTIFACTS_ORIGIN, allowsGooglePicker: false },
        )

        expect(response.headers['content-security-policy'])
          .not.toContain('google.com')
      })

    it.each([
      '/shared/01JSHARE',
      '/artifacts/token-1',
      '/admin/artifact-reports',
    ])('never opens a Google frame on %s', async (path) => {
      const { applyArtifactFrameSrc } = await loadPlugin()
      const response = { headers: {} as Record<string, string> }

      applyArtifactFrameSrc(
        response as never,
        createContext(path) as never,
        {
          artifactsOrigin: ARTIFACTS_ORIGIN,
          allowsGooglePicker: true,
        },
      )

      expect(response.headers['content-security-policy'])
        .not.toContain('google.com')
    })

    it('never adds a script, connect or image directive', async () => {
      const { applyArtifactFrameSrc } = await loadPlugin()
      const response = { headers: {} as Record<string, string> }

      applyArtifactFrameSrc(
        response as never,
        createContext('/chats/new') as never,
        {
          artifactsOrigin: ARTIFACTS_ORIGIN,
          allowsGooglePicker: true,
        },
      )

      expect(response.headers['content-security-policy'])
        .not.toMatch(/script-src|connect-src|img-src|default-src/)
    })

    it('matches the Picker URL and no other docs.google.com URL', async () => {
      const { applyArtifactFrameSrc } = await loadPlugin()
      const response = { headers: {} as Record<string, string> }

      applyArtifactFrameSrc(
        response as never,
        createContext('/chats/new') as never,
        { artifactsOrigin: ARTIFACTS_ORIGIN, allowsGooglePicker: true },
      )

      const sources = cspSources(
        response.headers['content-security-policy']!,
        'frame-src',
      )

      expect(matchesCspSources(
        sources,
        'https://docs.google.com/picker?foo=bar',
      )).toBe(true)
      expect(matchesCspSources(
        sources,
        'https://docs.google.com/picker/embed?foo=bar',
      )).toBe(true)
      expect(matchesCspSources(
        sources,
        'https://docs.google.com/forms/d/e/x/formResponse?entry.1=chat',
      )).toBe(false)
      expect(matchesCspSources(
        sources,
        'https://docs.google.com/pickerx',
      )).toBe(false)
      expect(matchesCspSources(
        sources,
        'https://docs.google.com/',
      )).toBe(false)
      expect(matchesCspSources(
        sources,
        'https://drive.google.com/picker',
      )).toBe(false)
      expect(matchesCspSources(
        sources,
        'https://evil.example/picker',
      )).toBe(false)
    })
  })

  describe('whether a chat document may frame the Picker', () => {
    async function allowed(event: unknown, key: unknown) {
      const { isGooglePickerFrameAllowed } = await import(
        '~~/server/utils/google/picker-frame'
      )

      return await isGooglePickerFrameAllowed(event as never, key)
    }

    it('is never allowed without the public Picker key', async () => {
      expect(await allowed({ context: {} }, '')).toBe(false)
      expect(await allowed({ context: {} }, undefined)).toBe(false)
    })

    it('falls back to the key alone when the render left no feature state',
      async () => {
        expect(await allowed({ context: {} }, 'public-key')).toBe(true)
      })

    it('answers from the memoized feature state, with no new read',
      async () => {
        const active = await allowed({
          context: {
            features: Promise.resolve({
              rules: {},
              userState: null,
              config: {},
              userId: null,
              isAdmin: false,
              exposures: new Set(),
            }),
          },
        }, 'public-key')

        expect(active).toBe(false)
      })

    it('answers no when the memoized state cannot be read', async () => {
      const rejected = Promise.reject(new Error('feature state failed'))

      rejected.catch(() => undefined)

      expect(await allowed({ context: { features: rejected } }, 'public-key'))
        .toBe(false)
    })
  })
})

/**
 * A small matcher for host-source expressions with a path, as CSP Level 3
 * defines them: scheme and host must match, a path ending in `/` matches
 * every path below it, any other path must match exactly, and the query is
 * ignored. It checks the directive string only: real browser enforcement is
 * not tested here (the Picker frame in a real browser is on the owner
 * checklist, `docs/google.md`).
 */
function cspSources(policy: string, directive: string): string[] {
  const entry = policy
    .split(';')
    .map(part => part.trim())
    .find(part => part.split(/\s+/)[0] === directive)

  return entry ? entry.split(/\s+/).slice(1) : []
}

function matchesCspSources(sources: string[], rawUrl: string): boolean {
  const url = new URL(rawUrl)

  return sources.some((source) => {
    if (!source.startsWith('https://')) {
      return false
    }

    const expression = new URL(source)

    if (expression.origin !== url.origin) {
      return false
    }

    if (expression.pathname === '/') {
      return true
    }

    return expression.pathname.endsWith('/')
      ? url.pathname.startsWith(expression.pathname)
      : url.pathname === expression.pathname
  })
}

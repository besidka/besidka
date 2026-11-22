import { describe, expect, it, vi } from 'vitest'

vi.mock('nuxt/server', () => {
  return {
    defineEventHandler: (handler: unknown) => {
      return handler
    },
    setResponseStatus: (
      event: { status?: number },
      status: number,
    ) => {
      event.status = status
    },
  }
})

const {
  default: handler,
  isNonCanonicalArtifactSharePath,
} = await import('~~/server/middleware/02.artifact-share-path')

function createEvent(path: string) {
  return {
    path,
    status: undefined as number | undefined,
    res: { headers: new Headers() },
  }
}

function run(event: ReturnType<typeof createEvent>): unknown {
  return (handler as unknown as (event: unknown) => unknown)(event)
}

describe('artifact share path guard', () => {
  it.each([
    ['/Artifacts', true],
    ['/Artifacts?x=1', true],
    ['/Artifacts/token-1', true],
    ['/ARTIFACTS/token-1', true],
    ['/artifacts', true],
    ['/artifacts/', true],
    ['/artifacts/token-1/', true],
    ['/artifacts/token-1/_payload.json', true],
    ['/artifacts/token-1', false],
    ['/artifacts/token-1?utm_source=x', false],
    ['/artifacts/return', false],
    ['/a', false],
    ['/a/token-1', false],
    ['/api/v1/artifact-shares/current', false],
    ['/api/v1/artifacts/ArtifactId1/shares', false],
    ['/chats/artifacts', false],
    ['/artifactsx', false],
    ['/About', false],
    ['/admin', false],
    ['/', false],
  ])('%s → %s', (path, expected) => {
    expect(isNonCanonicalArtifactSharePath(path)).toBe(expected)
  })

  it.each(['/Artifacts/token-1', '/artifacts/', '/artifacts'])(
    'answers %s with a plain 404 and the link privacy headers',
    (path) => {
      const event = createEvent(path)

      expect(run(event)).toBe('Not found')
      expect(event.status).toBe(404)
      expect(event.res.headers.get('Content-Type'))
        .toBe('text/plain; charset=utf-8')
      expect(event.res.headers.get('Cache-Control')).toBe('private, no-store')
      expect(event.res.headers.get('Referrer-Policy')).toBe('no-referrer')
      expect(event.res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
      expect(event.res.headers.get('Content-Security-Policy'))
        .toBe('frame-ancestors \'none\'')
    },
  )

  it('lets the link page and every other path through', () => {
    for (const path of ['/artifacts/token-1', '/artifacts/x?x=1', '/about']) {
      const event = createEvent(path)

      expect(run(event)).toBeUndefined()
      expect(event.status).toBeUndefined()
      expect([...event.res.headers.keys()]).toEqual([])
    }
  })
})

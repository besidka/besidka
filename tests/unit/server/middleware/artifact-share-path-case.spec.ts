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
  isMiscasedArtifactSharePath,
} = await import('~~/server/middleware/02.artifact-share-path-case')

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

describe('artifact share path case guard', () => {
  it.each([
    ['/A/token-1', true],
    ['/A/', true],
    ['/a/token-1', false],
    ['/a/token-1?x=1', false],
    ['/api/v1/artifact-shares/current', false],
    ['/About', false],
    ['/', false],
  ])('%s → %s', (path, expected) => {
    expect(isMiscasedArtifactSharePath(path)).toBe(expected)
  })

  it('answers 404 with the link privacy headers for /A/<token>', () => {
    const event = createEvent('/A/token-1')

    expect(run(event)).toBe('Not found')
    expect(event.status).toBe(404)
    expect(event.res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(event.res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(event.res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })

  it('lets the lower-case link and every other path through', () => {
    const event = createEvent('/a/token-1')

    expect(run(event)).toBeUndefined()
    expect(event.status).toBeUndefined()
    expect([...event.res.headers.keys()]).toEqual([])
  })
})

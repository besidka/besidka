import { describe, expect, it } from 'vitest'
import { appendNextToPath } from '../../../shared/utils/auth-redirect'
import { isArtifactShareLocation } from '../../../app/utils/artifact-share-location'

describe('isArtifactShareLocation', () => {
  it.each([
    [{ path: '/a' }, true],
    [{ path: '/A' }, true],
    [{ path: '/a/' }, true],
    [{ path: '/a/token-1' }, true],
    [{ path: '/A/token-1' }, true],
    [{ path: '/signin', query: { next: '/a' } }, true],
    [{ path: '/signin', query: { next: '/A' } }, true],
    [{ path: '/signin', query: { next: '/a/token-1' } }, true],
    [{ path: '/signup', query: { next: ['/a'] } }, true],
    [{ path: '/signin', query: { next: '/chats/new' } }, false],
    [{ path: '/about' }, false],
    [{ path: '/admin' }, false],
    [{ path: '/api/v1/artifact-shares/current' }, false],
    [{ path: '/ab' }, false],
    [{ path: '/about/a/token' }, false],
    [{ path: '/signin', query: { next: '/about' } }, false],
    [{ path: '/chats/abc' }, false],
    [{ path: '/', query: { next: 42 } }, false],
  ])('%j → %s', (location, expected) => {
    expect(isArtifactShareLocation(location)).toBe(expected)
  })

  it('matches the sign-up link the sign-in page builds from `next`', () => {
    const url = new URL(
      appendNextToPath('/signup', '/a'),
      'https://besidka.test',
    )

    expect(isArtifactShareLocation({
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
    })).toBe(true)
  })
})

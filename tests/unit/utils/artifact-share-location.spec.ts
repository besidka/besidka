import { describe, expect, it } from 'vitest'
import { appendNextToPath } from '../../../shared/utils/auth-redirect'
import { isArtifactShareLocation } from '../../../app/utils/artifact-share-location'

describe('isArtifactShareLocation', () => {
  it.each([
    [{ path: '/a/token-1' }, true],
    [{ path: '/a/' }, true],
    [{ path: '/signin', query: { next: '/a/token-1' } }, true],
    [{ path: '/signup', query: { next: ['/a/token-1'] } }, true],
    [{ path: '/signin', query: { next: '/chats/new' } }, false],
    [{ path: '/about/a/token' }, false],
    [{ path: '/chats/abc' }, false],
    [{ path: '/', query: { next: 42 } }, false],
  ])('%j → %s', (location, expected) => {
    expect(isArtifactShareLocation(location)).toBe(expected)
  })

  it('matches the sign-up link the sign-in page builds from `next`', () => {
    const url = new URL(
      appendNextToPath('/signup', '/a/abc_DEF-123'),
      'https://besidka.test',
    )

    expect(isArtifactShareLocation({
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
    })).toBe(true)
  })
})

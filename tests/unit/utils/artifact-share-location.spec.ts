import { describe, expect, it } from 'vitest'
import { appendNextToPath } from '../../../shared/utils/auth-redirect'
import { isArtifactShareLocation } from '../../../app/utils/artifact-share-location'

describe('isArtifactShareLocation', () => {
  it.each([
    [{ path: '/artifacts' }, true],
    [{ path: '/Artifacts' }, true],
    [{ path: '/artifacts/' }, true],
    [{ path: '/artifacts/token-1' }, true],
    [{ path: '/Artifacts/token-1' }, true],
    [{ path: '/signin', query: { next: '/artifacts/return' } }, true],
    [{ path: '/signin', query: { next: '/Artifacts/return' } }, true],
    [{ path: '/signin', query: { next: '/artifacts/token-1' } }, true],
    [{ path: '/signup', query: { next: ['/artifacts/return'] } }, true],
    [{ path: '/signin', query: { next: '/chats/new' } }, false],
    [{ path: '/about' }, false],
    [{ path: '/admin' }, false],
    [{ path: '/api/v1/artifact-shares/current' }, false],
    [{ path: '/a' }, false],
    [{ path: '/chats/artifacts' }, false],
    [{ path: '/api/v1/artifacts/ArtifactId1/shares' }, false],
    [{ path: '/about/artifacts/token' }, false],
    [{ path: '/signin', query: { next: '/about' } }, false],
    [{ path: '/chats/abc' }, false],
    [{ path: '/', query: { next: 42 } }, false],
  ])('%j → %s', (location, expected) => {
    expect(isArtifactShareLocation(location)).toBe(expected)
  })

  it('matches the sign-up link the sign-in page builds from `next`', () => {
    const url = new URL(
      appendNextToPath('/signup', '/artifacts/return'),
      'https://besidka.test',
    )

    expect(isArtifactShareLocation({
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
    })).toBe(true)
  })
})

function containsForbiddenCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)

    return code <= 0x20
      || (code >= 0x7f && code <= 0x9f)
      || character === '\\'
      || /\s/.test(character)
  })
}

/**
 * Resolves a push navigation target against the app origin and returns its
 * path, search and hash only when it stays on that origin. A bare
 * `startsWith('/')` check is not enough: `/\evil.com` is read by the URL
 * parser as `https://evil.com/`. Backslashes, whitespace and control
 * characters are rejected outright. Shared by the page plugin and the service
 * worker, so it must stay free of any DOM or service worker globals.
 */
export function resolveInternalNavigationTarget(
  target: unknown,
  origin: string,
): string | null {
  if (
    typeof target !== 'string'
    || !target.startsWith('/')
    || containsForbiddenCharacter(target)
  ) {
    return null
  }

  try {
    const resolved = new URL(target, origin)

    if (resolved.origin !== new URL(origin).origin) {
      return null
    }

    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch (exception) {
    void exception

    return null
  }
}

const MAX_DECODE_PASSES = 3
const SPACE = ' '

function isForbiddenCharacter(character: string): boolean {
  const code = character.charCodeAt(0)

  return code < 0x20
    || (code >= 0x7f && code <= 0x9f)
    || character === '\\'
    || (character !== SPACE && /\s/.test(character))
}

function containsForbiddenCharacter(value: string): boolean {
  return Array.from(value).some(isForbiddenCharacter)
}

function isSafeLiteralPath(target: string, origin: string): boolean {
  if (
    !target.startsWith('/')
    || target.startsWith('//')
    || containsForbiddenCharacter(target)
  ) {
    return false
  }

  try {
    return new URL(target, origin).origin === new URL(origin).origin
  } catch {
    return false
  }
}

function decodePercentEncoding(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * Accepts only a path that stays on `origin` once a browser resolves it. A
 * bare `startsWith('/')` check is not enough: `/\evil.example` is read by the
 * URL parser as `https://evil.example/`. Because consumers may percent-decode
 * a stored value again before redirecting (`/%5Cevil` becomes `/\evil`),
 * every decoded form of the target must pass as well, and a malformed
 * percent sequence is rejected. Only a plain space is tolerated in a decoded
 * form (`/foo%20bar`): the URL parser keeps interior spaces, so it cannot move
 * the target off `origin`. Tabs, newlines and every other control or
 * non-ASCII whitespace character are rejected because browsers strip or
 * reinterpret them (`/\t/evil.example` resolves as `//evil.example`).
 */
export function isSafeSameOriginPath(
  target: unknown,
  origin: string,
): boolean {
  if (typeof target !== 'string') {
    return false
  }

  let candidate = target

  for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
    if (!isSafeLiteralPath(candidate, origin)) {
      return false
    }

    const decoded = decodePercentEncoding(candidate)

    if (decoded === null) {
      return false
    }

    if (decoded === candidate) {
      return true
    }

    candidate = decoded
  }

  return false
}

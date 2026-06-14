import type { CookieEntryDeclaration } from '../types/module'

export function buildCookieDeleteString(name: string, path = '/'): string {
  return `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}`
}

// Non-root-path or domain-scoped cookies cannot be cleared here;
// clear them server-side.
export function deleteBrowserCookie(name: string): void {
  document.cookie = buildCookieDeleteString(name, '/')
}

export function getBrowserCookieNames(): string[] {
  return document.cookie
    .split(';')
    .map(part => (part.split('=')[0] ?? '').trim())
    .filter(name => name.length > 0)
}

export function cleanupEntry(entry: CookieEntryDeclaration): void {
  const isPrefix = entry.name.endsWith('*')
  const baseName = isPrefix ? entry.name.slice(0, -1) : entry.name

  if (entry.type === 'localStorage') {
    if (isPrefix) {
      const keys = Object.keys(localStorage).filter((key) => {
        return key.startsWith(baseName)
      })

      for (const key of keys) {
        localStorage.removeItem(key)
      }
    } else {
      localStorage.removeItem(baseName)
    }

    return
  }

  if (entry.type === 'sessionStorage') {
    if (isPrefix) {
      const keys = Object.keys(sessionStorage).filter((key) => {
        return key.startsWith(baseName)
      })

      for (const key of keys) {
        sessionStorage.removeItem(key)
      }
    } else {
      sessionStorage.removeItem(baseName)
    }

    return
  }

  if (isPrefix) {
    const cookieNames = getBrowserCookieNames().filter((name) => {
      return name.startsWith(baseName)
    })

    for (const cookieName of cookieNames) {
      deleteBrowserCookie(cookieName)
    }
  } else {
    deleteBrowserCookie(baseName)
  }
}

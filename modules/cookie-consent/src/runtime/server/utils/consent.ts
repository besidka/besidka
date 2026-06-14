import type { H3Event } from 'h3'
import { getCookie } from 'h3'
import { useRuntimeConfig } from '#imports'
import type { ConsentCookie } from '../../types/module'

export function getCookieConsent(event: H3Event): {
  isDecided: boolean
  granted: string[]
  isAllowed: (id: string) => boolean
} {
  const config = useRuntimeConfig()
  const options = config.public.cookieConsent as {
    cookieName: string
    revision: number
  }

  const raw = getCookie(event, options.cookieName)

  if (!raw) {
    return {
      isDecided: false,
      granted: [],
      isAllowed: () => false,
    }
  }

  let parsed: ConsentCookie | null = null

  try {
    parsed = JSON.parse(raw) as ConsentCookie
  } catch {
    return {
      isDecided: false,
      granted: [],
      isAllowed: () => false,
    }
  }

  if (
    !parsed
    || typeof parsed !== 'object'
    || parsed.v !== options.revision
    || !Array.isArray(parsed.granted)
    || !parsed.granted.every(item => typeof item === 'string')
  ) {
    return {
      isDecided: false,
      granted: [],
      isAllowed: () => false,
    }
  }

  const granted = parsed.granted

  return {
    isDecided: true,
    granted,
    isAllowed: (id: string) => granted.includes(id),
  }
}

import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('defineNuxtConfig', <Configuration>(configuration: Configuration) => {
  return configuration
})

const { default: configuration } = await import('../../../nuxt.config')

interface CookieEntry {
  id: string
  name: string
  type: string
}

interface CookieCategory {
  id: string
  entries?: CookieEntry[]
}

describe('cookie consent manifest contract', () => {
  it(
    'declares the real Better Auth last-used-login-method cookie name, '
    + 'not the unhyphenated/mistyped name that matches no real cookie',
    () => {
      const categories = configuration.cookieConsent
        ?.categories as CookieCategory[]

      const preferences = categories.find((category) => {
        return category.id === 'preferences'
      })

      const entry = preferences?.entries?.find((candidate) => {
        return candidate.id === 'last-login-method'
      })

      expect(entry?.type).toBe('cookie')
      expect(entry?.name).toBe('better-auth.last_used_login_method')
    },
  )
})

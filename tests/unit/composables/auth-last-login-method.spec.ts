import { describe, expect, it, vi } from 'vitest'

vi.unmock('better-auth/vue')

const { createAuthClient } = await import('better-auth/vue')
const { lastLoginMethodClient } = await import('better-auth/client/plugins')

describe('better-auth last-login-method client contract', () => {
  it(
    'exposes clearLastUsedLoginMethod as a top-level client action, so '
    + 'the cookie-consent gate plugin can call it directly instead of '
    + 'hand-writing the cookie name',
    () => {
      const client = createAuthClient({
        baseURL: 'http://localhost:3000',
        plugins: [lastLoginMethodClient()],
      })

      expect(typeof client.clearLastUsedLoginMethod).toBe('function')
    },
  )

  it(
    'clears the real better-auth.last_used_login_method cookie name by '
    + 'default, with no domain scoping unless explicitly configured',
    () => {
      const client = createAuthClient({
        baseURL: 'http://localhost:3000',
        plugins: [lastLoginMethodClient()],
      })

      document.cookie = 'better-auth.last_used_login_method=google; path=/'

      client.clearLastUsedLoginMethod()

      expect(document.cookie).not.toContain(
        'better-auth.last_used_login_method=google',
      )
    },
  )
})

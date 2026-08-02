import type { KVNamespace } from '@cloudflare/workers-types'

interface AuthRateLimitRule {
  window: number
  max: number
}

interface AuthRateLimitValue {
  key: string
  count: number
  lastRequest: number
}

interface AuthRateLimitConsumeResult {
  allowed: boolean
  retryAfter: number | null
}

interface AuthRateLimitStorage {
  get: (key: string) => Promise<AuthRateLimitValue | null>
  set: (key: string, value: AuthRateLimitValue) => Promise<void>
  consume: (
    key: string,
    rule: AuthRateLimitRule,
  ) => Promise<AuthRateLimitConsumeResult>
}

export const authRateLimitDefaults: AuthRateLimitRule = {
  window: 60,
  max: 60,
}

export const authRateLimitRules: Record<string, AuthRateLimitRule> = {
  '/sign-in/email': { window: 300, max: 10 },
  '/sign-up/email': { window: 900, max: 5 },
  '/sign-in/social': { window: 300, max: 20 },
  '/request-password-reset': { window: 900, max: 3 },
  '/reset-password': { window: 900, max: 5 },
  '/send-verification-email': { window: 900, max: 3 },
  '/change-password': { window: 900, max: 5 },
  '/change-email': { window: 900, max: 3 },
  '/delete-user': { window: 900, max: 3 },
  '/verify-email': { window: 300, max: 20 },
  '/two-factor/verify-totp': { window: 300, max: 5 },
  '/two-factor/verify-otp': { window: 300, max: 5 },
  '/two-factor/verify-backup-code': { window: 900, max: 5 },
  '/two-factor/generate-backup-codes': { window: 900, max: 3 },
  '/two-factor/enable': { window: 900, max: 5 },
  '/two-factor/disable': { window: 900, max: 5 },
  '/two-factor/*': { window: 300, max: 10 },
  '/passkey/verify-authentication': { window: 300, max: 10 },
  '/passkey/verify-registration': { window: 900, max: 10 },
  '/passkey/delete-passkey': { window: 900, max: 10 },
  '/passkey/*': { window: 60, max: 20 },
  '/link-social': { window: 300, max: 10 },
  '/unlink-account': { window: 900, max: 5 },
  '/list-accounts': { window: 60, max: 30 },
  '/revoke-session': { window: 300, max: 20 },
  '/revoke-sessions': { window: 900, max: 5 },
  '/revoke-other-sessions': { window: 900, max: 5 },
}

export const authRateLimitMaxWindow = Math.max(
  ...Object.values(authRateLimitRules).map(rule => rule.window),
)

export function createAuthRateLimitStorage(
  kv: KVNamespace,
  keyPrefix: string,
): AuthRateLimitStorage {
  const ttl = Math.max(60, authRateLimitMaxWindow)

  function storageKey(key: string): string {
    return `${keyPrefix}:${key}`
  }

  async function get(key: string): Promise<AuthRateLimitValue | null> {
    const raw = await kv.get(storageKey(key))

    if (!raw) {
      return null
    }

    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  async function set(key: string, value: AuthRateLimitValue): Promise<void> {
    await kv.put(storageKey(key), JSON.stringify(value), {
      expirationTtl: ttl,
    })
  }

  async function consume(
    key: string,
    rule: AuthRateLimitRule,
  ): Promise<AuthRateLimitConsumeResult> {
    const now = Date.now()
    const windowInMs = rule.window * 1000
    const data = await get(key)

    if (!data || now - data.lastRequest > windowInMs) {
      await set(key, { key, count: 1, lastRequest: now })

      return { allowed: true, retryAfter: null }
    }

    if (data.count >= rule.max) {
      const retryAfter = Math.ceil(
        (data.lastRequest + windowInMs - now) / 1000,
      )

      return { allowed: false, retryAfter }
    }

    await set(key, {
      key,
      count: data.count + 1,
      lastRequest: now,
    })

    return { allowed: true, retryAfter: null }
  }

  return { get, set, consume }
}

import type { KVNamespace } from '@cloudflare/workers-types'

export const GOOGLE_REFRESH_LOCK_KEY_PREFIX = 'google:refresh:'
export const GOOGLE_REFRESH_LOCK_TTL_SECONDS = 30
export const GOOGLE_REFRESH_LOCK_WAIT_MS = 500
export const GOOGLE_REFRESH_LOCK_WAIT_ATTEMPTS = 3

const KV_MIN_TTL_SECONDS = 60

interface RefreshLockValue {
  owner: string
  acquiredAt: number
}

function lockKey(connectionId: string): string {
  return `${GOOGLE_REFRESH_LOCK_KEY_PREFIX}${connectionId}`
}

function parseLock(raw: string | null): RefreshLockValue | null {
  if (!raw) {
    return null
  }

  try {
    const value = JSON.parse(raw) as RefreshLockValue

    return typeof value.owner === 'string'
      && typeof value.acquiredAt === 'number'
      ? value
      : null
  } catch {
    return null
  }
}

function isFresh(lock: RefreshLockValue | null, now: number): boolean {
  return lock !== null
    && now - lock.acquiredAt < GOOGLE_REFRESH_LOCK_TTL_SECONDS * 1000
}

/**
 * Best-effort refresh lock, the same scheme as `connectors:refresh:`: read,
 * write a random owner, read again. KV has no compare-and-set and is
 * eventually consistent, so two locations can both win; the D1
 * compare-and-set on the stored token ciphertext is what keeps the row
 * right. KV refuses TTLs under 60 s, so the entry lives 60 s and carries its
 * own 30 s expiry. Throws when KV fails; the caller then refreshes unlocked.
 */
export async function acquireGoogleRefreshLock(
  kv: KVNamespace,
  connectionId: string,
  now: number,
): Promise<string | null> {
  const key = lockKey(connectionId)

  if (isFresh(parseLock(await kv.get(key)), now)) {
    return null
  }

  const owner = crypto.randomUUID()

  await kv.put(key, JSON.stringify({ owner, acquiredAt: now }), {
    expirationTtl: Math.max(
      GOOGLE_REFRESH_LOCK_TTL_SECONDS,
      KV_MIN_TTL_SECONDS,
    ),
  })

  return parseLock(await kv.get(key))?.owner === owner ? owner : null
}

export async function releaseGoogleRefreshLock(
  kv: KVNamespace,
  connectionId: string,
  owner: string,
): Promise<void> {
  try {
    const key = lockKey(connectionId)

    if (parseLock(await kv.get(key))?.owner === owner) {
      await kv.delete(key)
    }
  } catch {
    return
  }
}

export async function isGoogleRefreshLockHeld(
  kv: KVNamespace,
  connectionId: string,
  now: number,
): Promise<boolean> {
  try {
    return isFresh(parseLock(await kv.get(lockKey(connectionId))), now)
  } catch {
    return false
  }
}

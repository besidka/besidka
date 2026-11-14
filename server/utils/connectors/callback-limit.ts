import type { KVNamespace } from '@cloudflare/workers-types'
import {
  CONNECTOR_CALLBACK_FAILURES_MAX,
  CONNECTOR_CALLBACK_FAILURE_WINDOW_SECONDS,
} from '#shared/utils/connectors-policy'

const KEY_PREFIX = 'connectors:callback-failures:'
const WINDOW_MS = CONNECTOR_CALLBACK_FAILURE_WINDOW_SECONDS * 1000

interface FailureWindow {
  count: number
  windowStart: number
}

/**
 * The key of a callback client: a SHA-256 of its IP, so KV never holds the
 * address itself.
 */
export async function callbackClientKey(ip: string | null | undefined) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(ip || 'unknown'),
  )

  return `${KEY_PREFIX}${Buffer.from(digest).toString('base64url')}`
}

function parseWindow(raw: string | null, now: number): FailureWindow | null {
  if (!raw) {
    return null
  }

  try {
    const window = JSON.parse(raw) as FailureWindow
    const ageMs = now - window.windowStart

    return ageMs >= 0 && ageMs < WINDOW_MS ? window : null
  } catch {
    return null
  }
}

/**
 * Whether a client has used up its failed-callback budget (20 failures in
 * 10 minutes per IP). Only failures count, so a real sign-in never spends
 * it, and it is separate from the user's shared connector limit. A KV
 * failure answers false: the state is single use and unguessable, so the
 * budget is a flood guard, never a reason to fail a real sign-in.
 */
export async function isCallbackBudgetExhausted(
  kv: KVNamespace,
  clientKey: string,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const window = parseWindow(await kv.get(clientKey), now)

    return (window?.count ?? 0) >= CONNECTOR_CALLBACK_FAILURES_MAX
  } catch {
    return false
  }
}

export async function recordCallbackFailure(
  kv: KVNamespace,
  clientKey: string,
  now: number = Date.now(),
): Promise<void> {
  try {
    const window = parseWindow(await kv.get(clientKey), now)
      ?? { count: 0, windowStart: now }

    await kv.put(
      clientKey,
      JSON.stringify({ ...window, count: window.count + 1 }),
      { expirationTtl: CONNECTOR_CALLBACK_FAILURE_WINDOW_SECONDS },
    )
  } catch {
    return
  }
}

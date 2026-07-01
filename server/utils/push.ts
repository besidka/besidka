import type {
  PushMessage,
  PushSubscription as WebPushSubscription,
  VapidKeys,
} from '@block65/webcrypto-web-push'
import { buildPushPayload } from '@block65/webcrypto-web-push'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

// Push payloads transit third-party infrastructure (Google/Mozilla/Apple's
// own push services) and can render on a lock screen — never put generated
// message content or the user's prompt in title/body, only a fixed generic
// string. See PushNotificationPayload call site in
// server/api/v1/chats/[slug]/index.post.ts.
export type PushNotificationPayload = {
  title: string
  body: string
  url: string
}

interface StoredPushSubscription {
  id: number
  endpoint: string
  p256dhKey: string
  authKey: string
}

interface PushLogger {
  set: (fields: Record<string, unknown>) => void
}

// Without this, a client could subscribe with any URL as the "endpoint" and
// the server would fetch() it on every future generation via waitUntil — an
// attacker-controlled outbound request trigger. Push service domains aren't
// a contractually stable API from any vendor, so this fails closed (skip +
// log) rather than open on an unrecognized host: a dropped notification from
// a not-yet-listed vendor domain is a far smaller problem than silently
// allowing the server to fetch() anywhere a client asks.
const ALLOWED_PUSH_SERVICE_HOSTS = new Set([
  'fcm.googleapis.com',
  'jmt17.google.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
])
const ALLOWED_PUSH_SERVICE_HOST_SUFFIXES = [
  '.push.apple.com',
  '.notify.windows.com',
]

export function isAllowedPushServiceEndpoint(endpoint: string): boolean {
  let host: string

  try {
    host = new URL(endpoint).host
  } catch (exception) {
    void exception

    return false
  }

  if (ALLOWED_PUSH_SERVICE_HOSTS.has(host)) {
    return true
  }

  return ALLOWED_PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => {
    return host.endsWith(suffix)
  })
}

export function isPushConfigured(vapid: VapidKeys): boolean {
  return Boolean(vapid.publicKey && vapid.privateKey)
}

// Web Push gives no other signal for "this subscription no longer exists"
// than the push service's own HTTP response — 404/410 means the browser
// dropped it (uninstalled, cleared site data, etc.), so this is the only
// place that ever finds out and is the right place to clean it up.
//
// Never pass subscription.endpoint/p256dhKey/authKey to logger.set() below —
// the endpoint is a capability URL (anyone who has it can trigger a push to
// that browser) and the keys let anyone decrypt payloads sent to it; both are
// spec-treated as secrets, not just identifiers.
async function sendToSubscription(
  db: ReturnType<typeof useDb>,
  subscription: StoredPushSubscription,
  message: PushMessage,
  vapid: VapidKeys,
  logger: PushLogger,
): Promise<void> {
  if (!isAllowedPushServiceEndpoint(subscription.endpoint)) {
    logger.set({
      push: {
        operation: 'send',
        error: 'endpoint host not in the push service allowlist',
      },
    })

    return
  }

  const webPushSubscription: WebPushSubscription = {
    endpoint: subscription.endpoint,
    expirationTime: null,
    keys: {
      p256dh: subscription.p256dhKey,
      auth: subscription.authKey,
    },
  }

  try {
    const payload = await buildPushPayload(message, webPushSubscription, vapid)
    const response = await fetch(
      subscription.endpoint,
      payload as RequestInit,
    )

    if (response.status === 404 || response.status === 410) {
      await db.delete(schema.pushSubscriptions)
        .where(eq(schema.pushSubscriptions.id, subscription.id))

      return
    }

    if (!response.ok) {
      logger.set({
        push: {
          operation: 'send',
          status: response.status,
        },
      })
    }
  } catch (exception) {
    logger.set({
      push: {
        operation: 'send',
        error: exception instanceof Error
          ? exception.message
          : String(exception),
      },
    })
  }
}

// Sequential, not Promise.allSettled — Workers cap simultaneous connections
// at 6, and a notification arriving a beat later across someone's several
// devices costs nothing, so there is no reason to parallelize this.
export async function sendPushNotificationToUser(
  db: ReturnType<typeof useDb>,
  userId: number,
  payload: PushNotificationPayload,
  vapid: VapidKeys,
  logger: PushLogger,
): Promise<void> {
  if (!isPushConfigured(vapid)) {
    return
  }

  const subscriptions = await db.query.pushSubscriptions.findMany({
    where(table, { eq }) {
      return eq(table.userId, userId)
    },
  })

  if (subscriptions.length === 0) {
    return
  }

  const message: PushMessage = {
    data: payload,
    options: {
      ttl: 300,
      urgency: 'normal',
    },
  }

  for (const subscription of subscriptions) {
    await sendToSubscription(db, subscription, message, vapid, logger)
  }
}

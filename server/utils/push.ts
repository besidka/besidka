import { createRequestLogger } from 'evlog'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { shipWideEventToAxiom } from './evlog-drains'

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

export interface VapidKeys {
  publicKey?: string
  privateKey?: string
  subject?: string
}

interface StoredPushSubscription {
  id: number
  endpoint: string
  p256dhKey: string
  authKey: string
}

type SendOutcome = 'sent' | 'staleRemoved' | 'rejected' | 'failed'

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
  return Boolean(vapid.publicKey && vapid.privateKey && vapid.subject)
}

// NUXT_VAPID_SUBJECT holds a bare contact address (e.g. abuse@domain.com) —
// this adds the mailto: scheme RFC 8292 requires. Left as-is if it already
// carries a scheme (mailto: or https:, both spec-valid), so a stale
// pre-existing value never ends up double-prefixed or malformed.
export function buildVapidSubject(
  vapidSubject: string,
): string | undefined {
  if (!vapidSubject) {
    return undefined
  }

  if (/^(mailto|https):/.test(vapidSubject)) {
    return vapidSubject
  }

  return `mailto:${vapidSubject}`
}

// Web Push gives no other signal for "this subscription no longer exists"
// than the push service's own HTTP response — 404/410 means the browser
// dropped it (uninstalled, cleared site data, etc.), so this is the only
// place that ever finds out and is the right place to clean it up.
//
// generateRequestDetails() only builds the request (encryption + VAPID
// headers) — it never touches Node's https module, unlike sendNotification()
// on this same package, which does. Sending via fetch() ourselves is what
// keeps this Workers-compatible: web-push's crypto path only needs
// node:crypto (ECDH/HMAC/AES-GCM), which Cloudflare Workers' nodejs_compat
// has genuinely supported since workerd PR #3688 (2025-03-10) — its HTTP
// client path does not need to work here, and hasn't been verified to.
//
// Never pass subscription.endpoint/p256dhKey/authKey to the wide event built
// in sendPushNotificationToUser below — the endpoint is a capability URL
// (anyone who has it can trigger a push to that browser) and the keys let
// anyone decrypt payloads sent to it; both are spec-treated as secrets, not
// just identifiers. Only aggregate outcome counts are ever logged.
//
// The `web-push` import below is dynamic, not static, so Nitro's dev server
// never needs to resolve its dependency graph (jws/asn1.js/https-proxy-agent)
// at startup — a static top-level import here made the Playwright webServer
// hang indefinitely in CI (Linux runners only; unreproducible on macOS),
// with no failure past `nuxt dev`'s first log line. The production Workers
// build was never affected; only Nitro's own dev-server bundling was.
async function sendToSubscription(
  db: ReturnType<typeof useDb>,
  subscription: StoredPushSubscription,
  payloadJson: string,
  vapid: Required<VapidKeys>,
): Promise<SendOutcome> {
  if (!isAllowedPushServiceEndpoint(subscription.endpoint)) {
    return 'rejected'
  }

  try {
    const { generateRequestDetails } = await import('web-push')
    const requestDetails = generateRequestDetails(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dhKey,
          auth: subscription.authKey,
        },
      },
      payloadJson,
      {
        vapidDetails: vapid,
        TTL: 300,
        urgency: 'normal',
        contentEncoding: 'aes128gcm',
      },
    )

    const response = await fetch(requestDetails.endpoint, {
      method: requestDetails.method,
      headers: requestDetails.headers,
      // Buffer extends Uint8Array at runtime — a valid BodyInit — but its
      // Node type doesn't structurally match fetch()'s DOM-lib signature.
      body: requestDetails.body as BodyInit | null,
    })

    if (response.status === 404 || response.status === 410) {
      await db.delete(schema.pushSubscriptions)
        .where(eq(schema.pushSubscriptions.id, subscription.id))

      return 'staleRemoved'
    }

    if (!response.ok) {
      return 'failed'
    }

    return 'sent'
  } catch (exception) {
    void exception

    return 'failed'
  }
}

// Sequential, not Promise.allSettled — Workers cap simultaneous connections
// at 6, and a notification arriving a beat later across someone's several
// devices costs nothing, so there is no reason to parallelize this.
//
// This runs inside a fire-and-forget ExecutionContext.waitUntil() call from
// the chat handler, well after that request's own evlog wide event has
// already been built and emitted on the Nitro `afterResponse` hook — calling
// logger.set() on the shared per-request logger here would race that emit
// and silently miss it (evlog logs a "set called after emit" warning and
// drops the fields, the same hazard documented for aiLogger in
// server/api/v1/chats/[slug]/index.post.ts). So this builds its own
// standalone wide event via createRequestLogger and ships it to Axiom
// directly, the same pattern aiLogger/shipWideEventToAxiom already uses.
export async function sendPushNotificationToUser(
  db: ReturnType<typeof useDb>,
  userId: number,
  payload: PushNotificationPayload,
  vapid: VapidKeys,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<void> {
  if (!isPushConfigured(vapid)) {
    return
  }

  const subscriptions = await db.query.pushSubscriptions.findMany({
    where: { userId },
  })

  if (subscriptions.length === 0) {
    return
  }

  const payloadJson = JSON.stringify(payload)

  const outcomes: Record<SendOutcome, number> = {
    sent: 0,
    staleRemoved: 0,
    rejected: 0,
    failed: 0,
  }

  for (const subscription of subscriptions) {
    const outcome = await sendToSubscription(
      db,
      subscription,
      payloadJson,
      vapid as Required<VapidKeys>,
    )

    outcomes[outcome] += 1
  }

  const logger = createRequestLogger({
    method: 'PUSH',
    path: '/internal/push-send',
    waitUntil,
  })

  logger.set({
    push: {
      operation: 'send',
      userId,
      subscriptionCount: subscriptions.length,
      ...outcomes,
    },
  })

  const wideEvent = logger.emit({
    message: 'Push notification send completed',
    status: outcomes.failed > 0 ? 502 : 200,
  })

  if (wideEvent && waitUntil) {
    waitUntil(shipWideEventToAxiom(wideEvent))
  }
}

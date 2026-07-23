import { createRequestLogger } from 'evlog'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { shipWideEventToAxiom } from './evlog-drains'
import { buildPushRequest, isValidVapidPublicKey } from './push-protocol'

// Push payloads transit third-party infrastructure (Google/Mozilla/Apple's
// own push services) and can render on a lock screen — never put generated
// message content or the user's prompt in title/body, only a fixed generic
// string. See PushNotificationPayload call site in
// server/api/v1/chats/[slug]/index.post.ts.
export type PushNotificationPayload = {
  title: string
  body: string
  url: string
  tag?: string
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
  origin: string | null
}

type SendOutcome = 'sent' | 'staleRemoved' | 'rejected' | 'failed'

export interface PushFailureDetail {
  host: string
  status: number
  reason: string
}

export interface PushSendOutcomes {
  sent: number
  staleRemoved: number
  rejected: number
  failed: number
  failures: PushFailureDetail[]
}

interface SendResult {
  outcome: SendOutcome
  failure?: PushFailureDetail
}

function getEndpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch (exception) {
    void exception

    return 'invalid-endpoint'
  }
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
// The request is built by server/utils/push-protocol.ts, a dependency-free
// WebCrypto implementation of RFC 8291/8292 — see its file-top doc for the
// postmortem on why no evaluated Web Push library works on workerd against
// Apple's push service.
//
// Never pass subscription.endpoint/p256dhKey/authKey to the wide event built
// in sendPushNotificationToUser below — the endpoint is a capability URL
// (anyone who has it can trigger a push to that browser) and the keys let
// anyone decrypt payloads sent to it; both are spec-treated as secrets, not
// just identifiers. Only aggregate outcome counts are ever logged.
async function sendToSubscription(
  db: ReturnType<typeof useDb>,
  subscription: StoredPushSubscription,
  payload: PushNotificationPayload,
  vapid: Required<VapidKeys>,
): Promise<SendResult> {
  const host = getEndpointHost(subscription.endpoint)

  if (!isAllowedPushServiceEndpoint(subscription.endpoint)) {
    return {
      outcome: 'rejected',
      failure: {
        host,
        status: 0,
        reason: 'push service host is not allowed',
      },
    }
  }

  try {
    const request = await buildPushRequest({
      endpoint: subscription.endpoint,
      p256dhKey: subscription.p256dhKey,
      authKey: subscription.authKey,
      payload: JSON.stringify(payload),
      ttl: 300,
      urgency: 'normal',
      vapid: {
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
        subject: vapid.subject,
      },
    })

    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: request.body as BodyInit,
    })

    if (response.status === 404 || response.status === 410) {
      await db.delete(schema.pushSubscriptions)
        .where(eq(schema.pushSubscriptions.id, subscription.id))

      return {
        outcome: 'staleRemoved',
        failure: {
          host,
          status: response.status,
          reason: 'subscription expired at the push service — removed',
        },
      }
    }

    if (!response.ok) {
      let body = ''

      try {
        body = await response.text()
      } catch (exception) {
        void exception
      }

      return {
        outcome: 'failed',
        failure: {
          host,
          status: response.status,
          reason: body.slice(0, 140)
            || response.statusText
            || 'rejected by the push service',
        },
      }
    }

    return { outcome: 'sent' }
  } catch (exception) {
    const message = exception instanceof Error
      ? exception.message
      : String(exception)

    return {
      outcome: 'failed',
      failure: {
        host,
        status: 0,
        reason: message.slice(0, 140),
      },
    }
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
  targetOrigin?: string,
): Promise<PushSendOutcomes | null> {
  if (!isPushConfigured(vapid)) {
    return null
  }

  if (!isValidVapidPublicKey(vapid.publicKey as string)) {
    return null
  }

  const subscriptions = await db.query.pushSubscriptions.findMany({
    where: { userId },
  })

  if (subscriptions.length === 0) {
    return { sent: 0, staleRemoved: 0, rejected: 0, failed: 0, failures: [] }
  }

  // Preview deployments all share one D1 database, so one user can carry a
  // subscription per preview origin they visited (issue #3: 4 duplicate
  // notifications, one per stale preview origin's own service worker). Scope
  // delivery to the origin the caller cares about — but fall back to the
  // full set whenever nothing matches (legacy rows with a null origin, or a
  // caller/environment that never passes targetOrigin) so this can never
  // silently drop a notification.
  const originMatchedSubscriptions = targetOrigin
    ? subscriptions.filter(subscription => subscription.origin === targetOrigin)
    : []
  const subscriptionsToNotify = originMatchedSubscriptions.length > 0
    ? originMatchedSubscriptions
    : subscriptions

  const outcomes: PushSendOutcomes = {
    sent: 0,
    staleRemoved: 0,
    rejected: 0,
    failed: 0,
    failures: [],
  }

  for (const subscription of subscriptionsToNotify) {
    const result = await sendToSubscription(
      db,
      subscription,
      payload,
      vapid as Required<VapidKeys>,
    )

    outcomes[result.outcome] += 1

    if (result.failure) {
      outcomes.failures.push(result.failure)
    }
  }

  const logger = createRequestLogger({
    method: 'PUSH',
    path: '/internal/push-send',
    waitUntil,
  })

  const { failures, ...outcomeCounts } = outcomes

  logger.set({
    push: {
      operation: 'send',
      userId,
      subscriptionCount: subscriptionsToNotify.length,
      totalSubscriptionCount: subscriptions.length,
      ...outcomeCounts,
    },
    attributes: {
      push: {
        failures,
      },
    },
  })

  const wideEvent = logger.emit({
    message: 'Push notification send completed',
    status: outcomes.failed > 0 ? 502 : 200,
  })

  if (wideEvent && waitUntil) {
    waitUntil(shipWideEventToAxiom(wideEvent))
  }

  return outcomes
}

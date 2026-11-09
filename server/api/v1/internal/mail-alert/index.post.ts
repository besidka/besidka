import { createError } from 'evlog'
import { z } from 'zod'
import {
  defineEventHandler,
  getRequestHeader,
  setResponseStatus,
} from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'
import {
  MAIL_ALERT_MAILBOXES,
  MAIL_ALERT_MAX_BODY_BYTES,
  MAIL_ALERT_SIGNATURE_HEADER,
  MAIL_ALERT_TIMESTAMP_HEADER,
  verifyMailAlertSignature,
} from '#shared/utils/mail-alert-protocol'
import { getFeatureEvaluationConfig } from '~~/server/utils/features/evaluate'
import { notifyMailAlert } from '~~/server/utils/mail-alerts/notify'
import { buildVapidSubject } from '~~/server/utils/push'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

type WaitUntilContext = {
  cloudflare?: {
    context?: {
      waitUntil?: (promise: Promise<unknown>) => void
    }
  }
}

const RAW_SUBJECT_MAX_LENGTH = 400

const bodySchema = z.object({
  mailbox: z.enum(MAIL_ALERT_MAILBOXES),
  subject: z.string().max(RAW_SUBJECT_MAX_LENGTH),
  urgent: z.boolean(),
})

function notFound(): never {
  throw createError({
    message: 'Not found',
    status: 404,
  })
}

function resolveOrigin(baseUrl: unknown): string | undefined {
  try {
    return new URL(String(baseUrl)).origin
  } catch {
    return undefined
  }
}

async function readBoundedBody(event: RequestEvent): Promise<string | null> {
  const declaredLength = Number(getRequestHeader(event, 'content-length') ?? 0)

  if (declaredLength > MAIL_ALERT_MAX_BODY_BYTES) {
    return null
  }

  const reader = event.req.body?.getReader()

  if (!reader) {
    return null
  }

  const chunks: Uint8Array[] = []
  let receivedBytes = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    receivedBytes += value.byteLength

    if (receivedBytes > MAIL_ALERT_MAX_BODY_BYTES) {
      await reader.cancel()

      return null
    }

    chunks.push(value)
  }

  const bytes = new Uint8Array(receivedBytes)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder().decode(bytes)
}

function parsePayload(body: string) {
  try {
    return bodySchema.safeParse(JSON.parse(body))
  } catch {
    return null
  }
}

/**
 * Receives "mail arrived" signals from the `besidka-mail-alerts` Email
 * Worker over a service binding and pushes them to every admin. The route is
 * also reachable from the internet, so anything without a valid, fresh HMAC
 * signature, and every call while the secret is unset, gets a 404.
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const runtimeConfig = useRuntimeConfig()
  const secret = runtimeConfig.mailAlertSecret

  if (!secret) {
    notFound()
  }

  const timestamp = getRequestHeader(event, MAIL_ALERT_TIMESTAMP_HEADER)
  const signature = getRequestHeader(event, MAIL_ALERT_SIGNATURE_HEADER)

  if (!timestamp || !signature) {
    notFound()
  }

  const body = await readBoundedBody(event)

  if (body === null) {
    notFound()
  }

  const isAuthentic = await verifyMailAlertSignature({
    secret,
    timestamp,
    signature,
    body,
    nowSeconds: Math.floor(Date.now() / 1000),
  })

  if (!isAuthentic) {
    logger.set({ attributes: { mailAlert: { outcome: 'rejected' } } })
    notFound()
  }

  const payload = parsePayload(body)

  if (!payload?.success) {
    logger.set({ attributes: { mailAlert: { outcome: 'invalid' } } })

    throw createError({
      message: 'Invalid mail alert',
      status: 400,
      why: 'The signed body does not match the mail alert schema.',
      fix: 'Deploy the mail-alerts Worker and the app from the same commit.',
    })
  }

  const now = new Date()
  const cloudflareContext = (event.context as WaitUntilContext | undefined)
    ?.cloudflare?.context
  const waitUntil = cloudflareContext?.waitUntil?.bind(cloudflareContext)
  const result = await notifyMailAlert(payload.data, {
    db: useDb(),
    kv: useKV(),
    config: getFeatureEvaluationConfig(runtimeConfig, now),
    vapid: {
      subject: buildVapidSubject(runtimeConfig.vapidSubject),
      publicKey: runtimeConfig.public.vapidPublicKey || undefined,
      privateKey: runtimeConfig.vapidPrivateKey || undefined,
    },
    targetOrigin: resolveOrigin(runtimeConfig.public.baseUrl),
    waitUntil,
  })

  logger.set({
    attributes: {
      mailAlert: {
        mailbox: payload.data.mailbox,
        urgent: payload.data.urgent,
        outcome: result.outcome,
        recipients: result.recipients,
        sent: result.sent,
      },
    },
  })

  setResponseStatus(event, 202)

  return { outcome: result.outcome }
})

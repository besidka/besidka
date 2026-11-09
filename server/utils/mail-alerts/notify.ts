import type { KVNamespace } from '@cloudflare/workers-types'
import type { FeatureEvaluationConfig } from '~~/server/utils/features/provider'
import type {
  PushDeliveryOptions,
  PushNotificationPayload,
  VapidKeys,
} from '~~/server/utils/push'
import type { MailAlertPayload } from '#shared/utils/mail-alert-protocol'
import { sanitizeMailSubject } from '#shared/utils/mail-alert-protocol'
import { listAdminRecipients } from '~~/server/utils/features/admin-recipients'
import {
  isPushConfigured,
  sendPushNotificationToUser,
} from '~~/server/utils/push'

export const MAIL_ALERT_COLLAPSE_SECONDS = 120

export const URGENT_MAIL_ALERT_COLLAPSE_SECONDS = 60

export const MAIL_ALERT_CLICK_URL = '/admin'

export const URGENT_MAIL_PUSH_DELIVERY: PushDeliveryOptions = {
  ttl: 600,
  urgency: 'high',
}

export const MAIL_PUSH_DELIVERY: PushDeliveryOptions = {
  ttl: 300,
  urgency: 'normal',
}

const NO_SUBJECT = '(no subject)'

export type MailAlertOutcome
  = | 'sent'
    | 'collapsed'
    | 'no-recipients'
    | 'push-not-configured'
    | 'push-failed'

export interface NotifyMailAlertInput {
  db: ReturnType<typeof useDb>
  kv: Pick<KVNamespace, 'get' | 'put' | 'delete'>
  config: FeatureEvaluationConfig
  vapid: VapidKeys
  targetOrigin?: string
  waitUntil?: (promise: Promise<unknown>) => void
  createTag?: () => string
}

export interface MailAlertResult {
  outcome: MailAlertOutcome
  recipients: number
  sent: number
  failed: number
}

export function mailAlertCollapseKey(mailbox: string): string {
  return `mail-alert:collapse:${mailbox}`
}

export function urgentMailAlertCollapseKey(mailbox: string): string {
  return `mail-alert:collapse-urgent:${mailbox}`
}

function collapseWindowFor(payload: MailAlertPayload) {
  if (payload.urgent) {
    return {
      key: urgentMailAlertCollapseKey(payload.mailbox),
      seconds: URGENT_MAIL_ALERT_COLLAPSE_SECONDS,
    }
  }

  return {
    key: mailAlertCollapseKey(payload.mailbox),
    seconds: MAIL_ALERT_COLLAPSE_SECONDS,
  }
}

export function buildMailAlertPush(
  payload: MailAlertPayload,
  createTag: () => string = () => crypto.randomUUID(),
): PushNotificationPayload {
  const subject = sanitizeMailSubject(payload.subject) || NO_SUBJECT
  const mailboxLabel = `${payload.mailbox}@`

  if (payload.urgent) {
    return {
      title: `Urgent: new mail to ${mailboxLabel}`,
      body: subject,
      url: MAIL_ALERT_CLICK_URL,
      tag: `besidka-mail-urgent-${createTag()}`,
    }
  }

  return {
    title: `New mail to ${mailboxLabel}`,
    body: subject,
    url: MAIL_ALERT_CLICK_URL,
    tag: `besidka-mail-${payload.mailbox}`,
  }
}

/**
 * Claims a collapse window. KV errors (for example the one-write-per-second
 * limit when two mails race) fail open: a duplicate push is better than a
 * missing one.
 */
async function claimCollapseWindow(
  kv: NotifyMailAlertInput['kv'],
  window: ReturnType<typeof collapseWindowFor>,
): Promise<boolean> {
  try {
    if (await kv.get(window.key)) {
      return false
    }

    await kv.put(window.key, '1', { expirationTtl: window.seconds })
  } catch {
    return true
  }

  return true
}

async function releaseCollapseWindow(
  kv: NotifyMailAlertInput['kv'],
  window: ReturnType<typeof collapseWindowFor>,
): Promise<void> {
  try {
    await kv.delete(window.key)
  } catch {
    return
  }
}

async function pushToAdmins(
  payload: MailAlertPayload,
  input: NotifyMailAlertInput,
): Promise<MailAlertResult> {
  const recipients = await listAdminRecipients(input.db, input.config)

  if (recipients.size === 0) {
    return { outcome: 'no-recipients', recipients: 0, sent: 0, failed: 0 }
  }

  const push = buildMailAlertPush(payload, input.createTag)
  const delivery = payload.urgent
    ? URGENT_MAIL_PUSH_DELIVERY
    : MAIL_PUSH_DELIVERY
  let sent = 0
  let failed = 0

  for (const userId of recipients.keys()) {
    try {
      const outcomes = await sendPushNotificationToUser(
        input.db,
        userId,
        push,
        input.vapid,
        input.waitUntil,
        input.targetOrigin,
        delivery,
      )

      sent += outcomes?.sent ?? 0
    } catch {
      failed += 1
    }
  }

  return {
    outcome: sent > 0 ? 'sent' : 'push-failed',
    recipients: recipients.size,
    sent,
    failed,
  }
}

/**
 * Pushes a mail alert to every admin's subscribed devices, at most once per
 * mailbox per collapse window: 60 seconds for urgent mail (high urgency, its
 * own window, so a normal window never holds it back) and 2 minutes for the
 * rest. The cap keeps a stranger from flooding the phone with keyword mail
 * while still meeting the one-hour rule. KV is eventually consistent, so a
 * second push can slip through across locations, which is acceptable. A
 * window whose push reached nobody is released, so the next mail can try
 * again. The result carries counts only, never the subject or any address.
 */
export async function notifyMailAlert(
  payload: MailAlertPayload,
  input: NotifyMailAlertInput,
): Promise<MailAlertResult> {
  if (!isPushConfigured(input.vapid)) {
    return {
      outcome: 'push-not-configured',
      recipients: 0,
      sent: 0,
      failed: 0,
    }
  }

  const window = collapseWindowFor(payload)
  const claimed = await claimCollapseWindow(input.kv, window)

  if (!claimed) {
    return { outcome: 'collapsed', recipients: 0, sent: 0, failed: 0 }
  }

  const result = await pushToAdmins(payload, input)

  if (result.outcome !== 'sent') {
    await releaseCollapseWindow(input.kv, window)
  }

  return result
}

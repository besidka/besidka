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
  kv: Pick<KVNamespace, 'get' | 'put'>
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
}

export function mailAlertCollapseKey(mailbox: string): string {
  return `mail-alert:collapse:${mailbox}`
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

async function claimCollapseWindow(
  kv: NotifyMailAlertInput['kv'],
  mailbox: string,
): Promise<boolean> {
  const key = mailAlertCollapseKey(mailbox)

  if (await kv.get(key)) {
    return false
  }

  await kv.put(key, '1', { expirationTtl: MAIL_ALERT_COLLAPSE_SECONDS })

  return true
}

/**
 * Pushes a mail alert to every admin's subscribed devices. Urgent mail
 * always pushes with high urgency; other mail pushes at most once per
 * mailbox per collapse window (KV is eventually consistent, so a second push
 * can slip through across locations, which is acceptable). The result
 * carries counts only, never the subject or any address.
 */
export async function notifyMailAlert(
  payload: MailAlertPayload,
  input: NotifyMailAlertInput,
): Promise<MailAlertResult> {
  if (!isPushConfigured(input.vapid)) {
    return { outcome: 'push-not-configured', recipients: 0, sent: 0 }
  }

  if (!payload.urgent) {
    const claimed = await claimCollapseWindow(input.kv, payload.mailbox)

    if (!claimed) {
      return { outcome: 'collapsed', recipients: 0, sent: 0 }
    }
  }

  const recipients = await listAdminRecipients(input.db, input.config)

  if (recipients.size === 0) {
    return { outcome: 'no-recipients', recipients: 0, sent: 0 }
  }

  const push = buildMailAlertPush(payload, input.createTag)
  const delivery = payload.urgent
    ? URGENT_MAIL_PUSH_DELIVERY
    : MAIL_PUSH_DELIVERY
  let sent = 0

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
      continue
    }
  }

  return {
    outcome: sent > 0 ? 'sent' : 'push-failed',
    recipients: recipients.size,
    sent,
  }
}

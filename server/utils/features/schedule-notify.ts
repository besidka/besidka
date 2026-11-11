import type { FeatureEvaluationConfig } from '~~/server/utils/features/provider'
import type { VapidKeys } from '~~/server/utils/push'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type {
  FeatureScheduleNotification,
} from '~~/server/utils/features/schedules'
import { getFeatureDefinition } from '#shared/utils/features/registry'
import { listAdminRecipients } from '~~/server/utils/features/admin-recipients'
import { sendTemplateEmail } from '~~/server/utils/email-template'
import { getFeatureEvaluationConfig } from '~~/server/utils/features/evaluate'
import {
  buildVapidSubject,
  isPushConfigured,
  sendPushNotificationToUser,
} from '~~/server/utils/push'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

const DEFAULT_SITE_URL = 'https://besidka.com'

interface NotifyFeatureAdminsInput {
  db: ReturnType<typeof useDb>
  config: FeatureEvaluationConfig
  vapid: VapidKeys
  siteUrl: string
  logger?: LoggerLike
}

function formatBasisPoints(basisPoints: number): string {
  return `${Number((basisPoints / 100).toFixed(2))}%`
}

function describeChange(
  change: FeatureScheduleNotification['schedule']['change'],
) {
  const parts: string[] = []

  if (change.enabled !== undefined) {
    parts.push(change.enabled ? 'turned on' : 'turned off')
  }

  if (change.rolloutBps !== undefined) {
    parts.push(`rollout ${formatBasisPoints(change.rolloutBps)}`)
  }

  if (change.allowRoles) {
    parts.push(`roles: ${change.allowRoles.join(', ')}`)
  }

  if (change.variants) {
    parts.push(`${change.variants.length} variant weights`)
  }

  return parts.join(', ') || 'no change'
}

export function buildFeatureScheduleMessage(
  notification: FeatureScheduleNotification,
  siteUrl: string,
) {
  const { schedule, outcome } = notification
  const title = getFeatureDefinition(schedule.flag)?.title ?? schedule.flag
  const change = describeChange(schedule.change)
  const when = new Date(schedule.runAt * 1000).toISOString()
  const auditUrl = `${siteUrl}/admin/audit`

  if (outcome === 'applied') {
    return {
      subject: `Scheduled change applied: ${title}`,
      heading: `Scheduled change applied: ${title}`,
      body: `Planned for ${when}: ${change}. It is live and the rules cache `
        + `was refreshed. Audit log: ${auditUrl}`,
      pushTitle: 'Scheduled change applied',
      pushBody: `${title}: ${change}`,
    }
  }

  return {
    subject: `Scheduled change failed: ${title}`,
    heading: `Scheduled change failed: ${title}`,
    body: `Planned for ${when}: ${change}. It was not applied and will not `
      + `be retried. Reason: ${schedule.error ?? 'unknown'}. `
      + `Open ${siteUrl}/admin/features/${schedule.flag} to schedule it `
      + `again. Audit log: ${auditUrl}`,
    pushTitle: 'Scheduled change failed',
    pushBody: `${title}: ${change}`,
  }
}

/**
 * Tells every admin (env admins with a verified email and `admin` role
 * holders) that a scheduled change was applied or failed: an email, and a
 * web push to the devices that subscribed. The message carries the flag, the
 * change and the time, never an account id or email. One failing recipient
 * never blocks the others or the job.
 */
export async function notifyFeatureAdmins(
  notification: FeatureScheduleNotification,
  input: NotifyFeatureAdminsInput,
): Promise<void> {
  const siteUrl = input.siteUrl || DEFAULT_SITE_URL
  const message = buildFeatureScheduleMessage(notification, siteUrl)
  const recipients = await listAdminRecipients(input.db, input.config)
  let emailsSent = 0
  let pushesAttempted = 0
  let failures = 0

  for (const [userId, email] of recipients) {
    try {
      await sendTemplateEmail({
        to: email,
        subject: message.subject,
        template: 'NoticeEmail',
        props: {
          preview: message.subject,
          heading: message.heading,
          body: message.body,
        },
      })
      emailsSent += 1
    } catch (exception) {
      failures += 1
      input.logger?.set({
        attributes: {
          featureScheduleNotify: {
            channel: 'email',
            error: exceptionMessage(exception),
          },
        },
      })
    }

    if (!isPushConfigured(input.vapid)) {
      continue
    }

    try {
      await sendPushNotificationToUser(input.db, userId, {
        title: message.pushTitle,
        body: message.pushBody,
        url: `/admin/features/${notification.schedule.flag}`,
        tag: `besidka-feature-schedule-${notification.schedule.id}`,
      }, input.vapid)
      pushesAttempted += 1
    } catch (exception) {
      failures += 1
      input.logger?.set({
        attributes: {
          featureScheduleNotify: {
            channel: 'push',
            error: exceptionMessage(exception),
          },
        },
      })
    }
  }

  input.logger?.set({
    attributes: {
      featureScheduleNotify: {
        recipients: recipients.size,
        emailsSent,
        pushesAttempted,
        failures,
      },
    },
  })
}

export function createFeatureScheduleNotifier(
  db: ReturnType<typeof useDb>,
  now: Date,
  logger?: LoggerLike,
) {
  const runtimeConfig = useRuntimeConfig()
  const config = getFeatureEvaluationConfig(runtimeConfig, now)
  const vapid = {
    subject: buildVapidSubject(runtimeConfig.vapidSubject),
    publicKey: runtimeConfig.public.vapidPublicKey || undefined,
    privateKey: runtimeConfig.vapidPrivateKey || undefined,
  }

  return async (notification: FeatureScheduleNotification) => {
    await notifyFeatureAdmins(notification, {
      db,
      config,
      vapid,
      siteUrl: String(runtimeConfig.public.baseUrl ?? ''),
      logger,
    })
  }
}

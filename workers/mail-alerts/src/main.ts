import {
  MAIL_ALERT_ROUTE,
  MAIL_ALERT_SIGNATURE_HEADER,
  MAIL_ALERT_TIMESTAMP_HEADER,
  sanitizeMailSubject,
  signMailAlert,
  type MailAlertPayload,
} from '../../../shared/utils/mail-alert-protocol'
import { decodeHeaderValue, isUrgentMail, resolveMailbox } from './classify'

export interface MailAlertsEnv {
  FORWARD_TO?: string
  MAIL_ALERT_SECRET?: string
  APP: Pick<Fetcher, 'fetch'>
}

export type MailAlertOutcome
  = | 'sent'
    | 'skipped-mailbox'
    | 'skipped-unconfigured'
    | 'rejected'
    | 'failed'

const APP_ORIGIN = 'https://besidka.com'

export function buildMailAlertPayload(
  message: Pick<ForwardableEmailMessage, 'headers'>,
  mailbox: MailAlertPayload['mailbox'],
): MailAlertPayload {
  const rawSubject = decodeHeaderValue(message.headers.get('subject') ?? '')

  return {
    mailbox,
    subject: sanitizeMailSubject(rawSubject),
    urgent: isUrgentMail({
      subject: rawSubject,
      fromHeader: message.headers.get('from'),
      authenticationResults: message.headers.get('authentication-results'),
    }),
  }
}

/**
 * Tells the main app that mail arrived, through the service binding. It
 * never throws: an alert that fails must not affect the forward, which has
 * already happened.
 */
export async function sendMailAlert(
  message: Pick<ForwardableEmailMessage, 'to' | 'headers'>,
  env: MailAlertsEnv,
  nowMilliseconds: number = Date.now(),
): Promise<MailAlertOutcome> {
  try {
    const mailbox = resolveMailbox(message.to)

    if (!mailbox) {
      return 'skipped-mailbox'
    }

    if (!env.MAIL_ALERT_SECRET) {
      return 'skipped-unconfigured'
    }

    const body = JSON.stringify(buildMailAlertPayload(message, mailbox))
    const timestamp = String(Math.floor(nowMilliseconds / 1000))
    const signature = await signMailAlert(
      env.MAIL_ALERT_SECRET,
      timestamp,
      body,
    )
    const response = await env.APP.fetch(`${APP_ORIGIN}${MAIL_ALERT_ROUTE}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [MAIL_ALERT_TIMESTAMP_HEADER]: timestamp,
        [MAIL_ALERT_SIGNATURE_HEADER]: signature,
      },
      body,
    })

    return response.ok ? 'sent' : 'rejected'
  } catch {
    return 'failed'
  }
}

/**
 * Forwards first, exactly like the plain forward rule this Worker replaces.
 * A forward that fails throws, so Email Routing records a failure instead of
 * the message disappearing. Only after the forward succeeded is the alert
 * scheduled, outside the forward's path.
 */
export async function handleEmail(
  message: ForwardableEmailMessage,
  env: MailAlertsEnv,
  context: Pick<ExecutionContext, 'waitUntil'>,
): Promise<void> {
  if (!env.FORWARD_TO) {
    throw new Error('FORWARD_TO is not set; refusing to drop the message.')
  }

  await message.forward(env.FORWARD_TO)

  context.waitUntil(sendMailAlert(message, env))
}

export default {
  email: handleEmail,
} satisfies ExportedHandler<MailAlertsEnv>

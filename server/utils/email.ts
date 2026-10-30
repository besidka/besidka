import { createError } from 'evlog'
// @ts-ignore
import { env } from 'cloudflare:workers'

type From = 'noreply' | 'personalized'

export const EMAIL_NOOP_MESSAGE_ID = 'email-noop'

export const EMAIL_NOT_CONFIGURED_CODE = 'E_EMAIL_NOT_CONFIGURED'

interface EmailRuntimeConfig {
  emailNoopEnabled: boolean | string
  emailSenderNoreply: string
  emailSenderPersonalized: string
}

function getSenderEmail(
  from: From,
  emailSenderNoreply: string,
  emailSenderPersonalized: string,
): string {
  switch (from) {
    case 'noreply':
      if (emailSenderNoreply) {
        return emailSenderNoreply
      }

      throw createError({
        message: 'Sender email is required for noreply emails',
        status: 500,
        code: EMAIL_NOT_CONFIGURED_CODE,
      })
    case 'personalized':
      if (emailSenderPersonalized) {
        return emailSenderPersonalized
      }

      throw createError({
        message: 'Sender email is required for personalized emails',
        status: 500,
        code: EMAIL_NOT_CONFIGURED_CODE,
      })
    default:
      throw createError('Invalid sender type')
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The Cloudflare Email Sending binding reports a failure as an error whose
 * `code` is an `E_` constant, for example `E_RATE_LIMIT_EXCEEDED`. `useEmail`
 * copies it to the error it throws, so callers can tell a quota stop from a
 * rejected recipient without parsing messages.
 */
export function getEmailErrorCode(exception: unknown): string | null {
  const candidates = [
    exception,
    exception instanceof Error ? exception.cause : undefined,
  ]

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue
    }

    const code = (candidate as { code?: unknown }).code

    if (typeof code === 'string' && code) {
      return code
    }
  }

  return null
}

export const useEmail = (
  runtimeConfig: EmailRuntimeConfig = useRuntimeConfig(),
  emailBinding: SendEmail | undefined = env.EMAIL,
) => {
  const {
    emailNoopEnabled,
    emailSenderNoreply,
    emailSenderPersonalized,
  } = runtimeConfig

  async function send({
    to,
    subject,
    html,
    text,
    from = 'noreply' as From,
  }: {
    to: string
    subject: string
    html: string
    text?: string
    from?: From
  }) {
    if (!to || !subject || !html) {
      throw createError('Missing required parameters: to, subject, or html')
    }

    if (String(emailNoopEnabled) === 'true') {
      return { messageId: EMAIL_NOOP_MESSAGE_ID }
    }

    if (!emailBinding) {
      throw createError({
        message: 'Email binding (EMAIL) is not available in the runtime.',
        status: 500,
        code: EMAIL_NOT_CONFIGURED_CODE,
      })
    }

    const resultFrom = getSenderEmail(
      from,
      emailSenderNoreply,
      emailSenderPersonalized,
    )

    try {
      return await emailBinding.send({
        from: {
          name: 'Besidka',
          email: resultFrom,
        },
        to,
        subject,
        html,
        text: text ?? htmlToText(html),
      })
    } catch (exception: any) {
      throw createError({
        message: exception.message,
        status: 500,
        code: getEmailErrorCode(exception) ?? undefined,
        cause: exception,
      })
    }
  }

  return {
    send,
  }
}

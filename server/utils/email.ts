// @ts-ignore
import { env } from 'cloudflare:workers'

type From = 'noreply' | 'personalized'

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

      throw createError('Sender email is required for noreply emails')
    case 'personalized':
      if (emailSenderPersonalized) {
        return emailSenderPersonalized
      }

      throw createError('Sender email is required for personalized emails')
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
      return { messageId: 'email-noop' }
    }

    if (!emailBinding) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Email binding (EMAIL) is not available in the runtime.',
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
      throw createError(exception)
    }
  }

  return {
    send,
  }
}

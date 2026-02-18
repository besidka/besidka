import { Resend } from 'resend'

type From = 'noreply' | 'personalized'

interface EmailRuntimeConfig {
  emailNoopEnabled: boolean | string
  resendApiKey: string
  resendSenderNoreply: string
  resendSenderPersonalized: string
}

function getSenderEmail(
  from: From,
  resendSenderNoreply: string,
  resendSenderPersonalized: string,
): string {
  switch (from) {
    case 'noreply':
      if (resendSenderNoreply) {
        return resendSenderNoreply
      }

      throw createError('Sender email is required for noreply emails')
    case 'personalized':
      if (resendSenderPersonalized) {
        return resendSenderPersonalized
      }

      throw createError('Sender email is required for personalized emails')
    default:
      throw createError('Invalid sender type')
  }
}

export const useEmail = (
  runtimeConfig: EmailRuntimeConfig = useRuntimeConfig(),
) => {
  const {
    emailNoopEnabled,
    resendApiKey,
    resendSenderNoreply,
    resendSenderPersonalized,
  } = runtimeConfig

  async function send({
    to,
    subject,
    html,
    from = 'noreply' as From,
  }: {
    to: string
    subject: string
    html: string
    from?: From
  }) {
    if (!to || !subject || !html) {
      throw createError('Missing required parameters: to, subject, or html')
    }

    if (String(emailNoopEnabled) === 'true') {
      return { id: 'email-noop' }
    }

    if (!resendApiKey) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Resend API key is not set in the runtime configuration.',
      })
    }

    const resultFrom = getSenderEmail(
      from,
      resendSenderNoreply,
      resendSenderPersonalized,
    )
    const resend = new Resend(resendApiKey)

    try {
      return await resend.emails.send({
        from: resultFrom,
        to,
        subject,
        html,
      })
    } catch (exception: any) {
      throw createError(exception)
    }
  }

  return {
    send,
  }
}

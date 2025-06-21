import { Resend } from 'resend'

type From = 'noreply' | 'personalized'

export const useEmail = () => {
  const {
    resendApiKey,
    resendSenderNoreply,
    resendSenderPersonalized,
  } = useRuntimeConfig(useEvent())

  if (!resendApiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Resend API key is not set in the runtime configuration.',
    })
  }

  const resend = new Resend(resendApiKey)

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

    let resultFrom: string = ''

    switch (from) {
      case 'noreply':
        if (resendSenderNoreply) {
          resultFrom = resendSenderNoreply
          break
        }

        throw createError('Sender email is required for noreply emails')
      case 'personalized':
        if (resendSenderPersonalized) {
          resultFrom = resendSenderPersonalized
          break
        }

        throw createError('Sender email is required for personalized emails')
      default:
        throw createError('Invalid sender type')
    }

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

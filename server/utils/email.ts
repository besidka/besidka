import { Resend } from 'resend'

type From = 'noreply' | 'personalized'

export const useEmail = () => {
  const { apiKey, sender } = useRuntimeConfig().resend

  if (!apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Resend API key is not set in the runtime configuration.',
    })
  }

  const resend = new Resend(apiKey)

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

    if (!sender[from as keyof typeof sender]) {
      throw createError('Sender email is required for personalized emails')
    }

    try {
      return await resend.emails.send({
        from: sender[from as keyof typeof sender],
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

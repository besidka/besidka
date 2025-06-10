import { Resend } from 'resend'

type From = 'no-reply' | 'personalized'

export const useEmail = () => {
  const resend = new Resend(process.env.RESEND_API_KEY || '')
  const { sender } = useRuntimeConfig().resend

  async function send({
    to,
    subject,
    html,
    from = 'no-reply' as From,
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

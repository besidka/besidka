import type { RenderedEmail } from '~~/server/utils/email-template'

export interface SendLegalNoticeEmailInput extends RenderedEmail {
  to: string
  subject: string
}

export async function renderLegalNoticeEmail(
  props: Record<string, unknown>,
): Promise<RenderedEmail> {
  return await renderTemplateEmail({
    template: 'LegalNoticeEmail',
    props,
  })
}

export async function sendLegalNoticeEmail(
  input: SendLegalNoticeEmailInput,
): Promise<{ messageId: string }> {
  return await sendRenderedEmail({
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    from: 'noreply',
  })
}

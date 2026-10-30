export interface SendLegalNoticeEmailInput {
  to: string
  subject: string
  props: Record<string, unknown>
}

export async function sendLegalNoticeEmail(
  input: SendLegalNoticeEmailInput,
): Promise<{ messageId: string }> {
  return await sendTemplateEmail({
    to: input.to,
    subject: input.subject,
    template: 'LegalNoticeEmail',
    props: input.props,
    from: 'noreply',
  })
}

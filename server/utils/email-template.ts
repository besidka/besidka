interface SendTemplateEmailOptions {
  to: string
  subject: string
  template: 'ActionEmail' | 'NoticeEmail'
  props: Record<string, unknown>
  from?: 'noreply' | 'personalized'
}

/**
 * `renderEmailComponent` returns a bare string, UNLESS the template renders
 * an `<ESubject>` - then it returns `{ html, subject }` instead (with the
 * plain-text body still under `.html`). Neither `ActionEmail` nor
 * `NoticeEmail` uses `<ESubject>`, but the narrowing below handles either
 * shape safely.
 */
export async function sendTemplateEmail({
  to,
  subject,
  template,
  props,
  from,
}: SendTemplateEmailOptions): Promise<void> {
  const htmlResult = await renderEmailComponent(template, props)
  const textResult = await renderEmailComponent(template, props, {
    plainText: true,
  })

  const html = typeof htmlResult === 'string' ? htmlResult : htmlResult.html
  const text = typeof textResult === 'string' ? textResult : textResult.html

  const { send: sendEmail } = useEmail()

  await sendEmail({
    to,
    subject,
    html,
    text,
    from,
  })
}

type EmailTemplateName = 'ActionEmail' | 'NoticeEmail' | 'LegalNoticeEmail'

interface RenderTemplateEmailOptions {
  template: EmailTemplateName
  props: Record<string, unknown>
}

export interface RenderedEmail {
  html: string
  text: string
}

interface SendRenderedEmailOptions extends RenderedEmail {
  to: string
  subject: string
  from?: 'noreply' | 'personalized'
}

interface SendTemplateEmailOptions extends RenderTemplateEmailOptions {
  to: string
  subject: string
  from?: 'noreply' | 'personalized'
}

/**
 * `renderEmailComponent` returns a bare string, UNLESS the template renders
 * an `<ESubject>` - then it returns `{ html, subject }` instead (with the
 * plain-text body still under `.html`). Neither `ActionEmail` nor
 * `NoticeEmail` uses `<ESubject>`, but the narrowing below handles either
 * shape safely.
 */
export async function renderTemplateEmail({
  template,
  props,
}: RenderTemplateEmailOptions): Promise<RenderedEmail> {
  const htmlResult = await renderEmailComponent(template, props)
  const textResult = await renderEmailComponent(template, props, {
    plainText: true,
  })

  return {
    html: typeof htmlResult === 'string' ? htmlResult : htmlResult.html,
    text: typeof textResult === 'string' ? textResult : textResult.html,
  }
}

export async function sendRenderedEmail({
  to,
  subject,
  html,
  text,
  from,
}: SendRenderedEmailOptions): Promise<{ messageId: string }> {
  const { send: sendEmail } = useEmail()

  const result = await sendEmail({
    to,
    subject,
    html,
    text,
    from,
  })

  return { messageId: result.messageId }
}

export async function sendTemplateEmail({
  to,
  subject,
  template,
  props,
  from,
}: SendTemplateEmailOptions): Promise<{ messageId: string }> {
  const { html, text } = await renderTemplateEmail({ template, props })

  return await sendRenderedEmail({ to, subject, html, text, from })
}

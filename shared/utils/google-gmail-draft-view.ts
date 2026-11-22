export interface GmailDraftApprovalView {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
  isReply: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((recipient): string[] => {
    if (!isRecord(recipient) || typeof recipient.email !== 'string') {
      return []
    }

    return typeof recipient.name === 'string' && recipient.name.trim()
      ? [`${recipient.name.trim()} <${recipient.email}>`]
      : [recipient.email]
  })
}

/**
 * What a draft approval shows, read from the tool part's input: every
 * recipient address (with the display name when there is one), the subject
 * and the whole body. The card renders this and nothing else, so the user
 * answers on exactly the input that will run. Null for an input that is not
 * a draft.
 */
export function readGmailDraftApprovalView(
  input: unknown,
): GmailDraftApprovalView | null {
  if (
    !isRecord(input)
    || typeof input.subject !== 'string'
    || typeof input.body !== 'string'
  ) {
    return null
  }

  return {
    to: readRecipients(input.to),
    cc: readRecipients(input.cc),
    bcc: readRecipients(input.bcc),
    subject: input.subject,
    body: input.body,
    isReply: typeof input.replyToThreadId === 'string'
      && input.replyToThreadId.length > 0,
  }
}

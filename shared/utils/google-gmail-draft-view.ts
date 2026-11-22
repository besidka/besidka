export interface GmailDraftApprovalView {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
  cardBody: string
  lineCount: number
  isReply: boolean
}

const BLANK_RUN_SHOWN_MAX = 2

/**
 * The body as the approval card shows it: every run of more than two blank
 * lines becomes one visible "[N blank lines]" line, so text cannot hide
 * below a screen of empty lines in the scrolling box. Only the card view
 * changes; the draft keeps the body exactly as given.
 */
export function collapseBlankLinesForCard(body: string): string {
  const lines = body.split(/\r\n|\n/)
  const shown: string[] = []
  let blankRun = 0

  const flushBlankRun = () => {
    if (blankRun > BLANK_RUN_SHOWN_MAX) {
      shown.push(`[${blankRun} blank lines]`)
    } else {
      shown.push(...Array.from({ length: blankRun }, () => ''))
    }

    blankRun = 0
  }

  for (const line of lines) {
    if (!line.trim()) {
      blankRun += 1

      continue
    }

    flushBlankRun()
    shown.push(line)
  }

  flushBlankRun()

  return shown.join('\n')
}

export function countBodyLines(body: string): number {
  return body.split(/\r\n|\n/).length
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

    return typeof recipient.name === 'string'
      ? [`${recipient.name} <${recipient.email}>`]
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
    cardBody: collapseBlankLinesForCard(input.body),
    lineCount: countBodyLines(input.body),
    isReply: typeof input.replyToThreadId === 'string'
      && input.replyToThreadId.length > 0,
  }
}

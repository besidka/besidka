export const REPLY_STOPPED_PART_TYPE = 'data-reply-stopped'

/**
 * The last part of a reply the user stopped: the run stored what it had
 * streamed so far. A resend of the same user message (Retry) generates a
 * fresh reply and deletes this one instead of replaying it.
 */
export interface ReplyStoppedPart {
  type: typeof REPLY_STOPPED_PART_TYPE
  data: { stoppedAt: string }
}

export function createReplyStoppedPart(
  stoppedAt: Date = new Date(),
): ReplyStoppedPart {
  return {
    type: REPLY_STOPPED_PART_TYPE,
    data: { stoppedAt: stoppedAt.toISOString() },
  }
}

export function hasReplyStoppedPart(parts: unknown): boolean {
  if (!Array.isArray(parts)) {
    return false
  }

  return parts.some((part) => {
    return typeof part === 'object'
      && part !== null
      && (part as { type?: unknown }).type === REPLY_STOPPED_PART_TYPE
  })
}

/**
 * A stopped reply that has no answer text yet (only reasoning or tool
 * steps): the chat shows a neutral "Stopped." line for it instead of
 * leaving the bubble without an ending.
 */
export function isTextlessStoppedReply(parts: unknown): boolean {
  if (!hasReplyStoppedPart(parts) || !Array.isArray(parts)) {
    return false
  }

  return !parts.some((part) => {
    return typeof part === 'object'
      && part !== null
      && (part as { type?: unknown }).type === 'text'
      && typeof (part as { text?: unknown }).text === 'string'
      && ((part as { text: string }).text).trim().length > 0
  })
}

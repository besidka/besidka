export const GOOGLE_TOOLS_WITHHELD_PART_TYPE = 'data-google-tools-withheld'

export const GOOGLE_TOOLS_WITHHELD_REASONS = [
  'model_may_not_receive_google_data',
  'provider_tool_not_removable',
] as const

export type GoogleToolsWithheldReason
  = typeof GOOGLE_TOOLS_WITHHELD_REASONS[number]

export const GOOGLE_TOOLS_WITHHELD_KEYS_PATH = '/profile/keys?provider=google'

export interface GoogleToolsWithheldNote {
  summary: string
  detail: string
  linkLabel: string | null
}

export const GOOGLE_TOOLS_WITHHELD_NOTES: Record<
  GoogleToolsWithheldReason,
  GoogleToolsWithheldNote
> = {
  model_may_not_receive_google_data: {
    summary: 'Google tools were not offered to this model.',
    detail: 'Besidka does not send Google data to a model that may use it '
      + 'for training. Pick another model, or confirm on the API Keys page '
      + 'that your Gemini key is a paid one.',
    linkLabel: 'Open API Keys',
  },
  provider_tool_not_removable: {
    summary: 'Google tools were not offered with built-in web search.',
    detail: 'Turn the built-in web search off for this message, or ask '
      + 'again after a Google file is in the chat.',
    linkLabel: null,
  },
}

/**
 * The one part a send writes on the assistant message when it offered no
 * Google tool for a reason the user can act on. It holds only the reason
 * code: the texts live in `GOOGLE_TOOLS_WITHHELD_NOTES`, so nothing the
 * model or the server wrote is ever rendered, and it never reaches a model.
 */
export interface GoogleToolsWithheldPart {
  type: typeof GOOGLE_TOOLS_WITHHELD_PART_TYPE
  data: { reason: GoogleToolsWithheldReason }
}

export function isGoogleToolsWithheldReason(
  value: unknown,
): value is GoogleToolsWithheldReason {
  return typeof value === 'string'
    && (GOOGLE_TOOLS_WITHHELD_REASONS as readonly string[]).includes(value)
}

export function createGoogleToolsWithheldPart(
  reason: GoogleToolsWithheldReason,
): GoogleToolsWithheldPart {
  return {
    type: GOOGLE_TOOLS_WITHHELD_PART_TYPE,
    data: { reason },
  }
}

export function getGoogleToolsWithheldReason(
  message: { parts?: readonly unknown[] },
): GoogleToolsWithheldReason | null {
  for (const part of message.parts ?? []) {
    if (
      typeof part !== 'object'
      || part === null
      || (part as { type?: unknown }).type !== GOOGLE_TOOLS_WITHHELD_PART_TYPE
    ) {
      continue
    }

    const reason = (part as { data?: { reason?: unknown } }).data?.reason

    if (isGoogleToolsWithheldReason(reason)) {
      return reason
    }
  }

  return null
}

import { decideGoogleDataRecipient } from '#shared/utils/google-data-recipient'
import type { GoogleDataRecipient } from '#shared/utils/google-data-recipient'
import {
  GOOGLE_TOOLS_WITHHELD_NOTES,
  isGoogleToolsWithheldReason,
} from '#shared/utils/google-tools-withheld'
import type {
  GoogleToolsWithheldNote,
  GoogleToolsWithheldReason,
} from '#shared/utils/google-tools-withheld'

export const GOOGLE_TOOLS_GATEWAY_REASON = 'gateway_needs_google_data'

export const GOOGLE_TOOLS_CALLING_OFF_REASON = 'tool_calling_off'

/**
 * Why a send offers no Google tool even though the user could have some. The
 * two withheld reasons are the ones a send writes on the assistant message
 * (`GoogleToolsWithheldReason`). The gateway reason never reaches a message:
 * a gateway send in a chat without Google data has no candidates at all, so
 * only the picker states it. `tool_calling_off` has no text, because a model
 * without tool calling gets no tools of any kind.
 */
export type GoogleToolsUnavailableReason
  = | GoogleToolsWithheldReason
    | typeof GOOGLE_TOOLS_GATEWAY_REASON
    | typeof GOOGLE_TOOLS_CALLING_OFF_REASON

export interface GoogleToolsAvailabilityInput {
  toolCalling: boolean
  gateway: boolean
  holdsGoogleData: boolean
  providerToolsStayCallable: boolean
  recipient?: GoogleDataRecipient
  geminiPaidTierConfirmed?: boolean
  recipientAllowed?: boolean
}

/**
 * Why Google tools are not offered to this send, or null when they are. The
 * checks run in this order, which is the order the send applies them:
 * 1. a gateway route in a chat that does not hold Google data yet: the send
 *    has no Google candidates there (the gateway safeguards are sent only
 *    once Google data is in the chat), so a Drive file has to be attached
 *    first;
 * 2. a model without tool calling;
 * 3. a provider tool that cannot be removed between steps (web search or Run
 *    code on direct Anthropic, search on Qwen) in a chat without Google
 *    data;
 * 4. a recipient that may not receive Google data. `recipientAllowed` is the
 *    send's own verdict (the server reads the user's keys for it); without
 *    it the verdict comes from `recipient` and `geminiPaidTierConfirmed`,
 *    the same allow-list the server uses, with the gateway safeguards counted
 *    as sent because a send in a chat with Google data always sends them.
 * The Google-data flag of the chat is the only thing the chat contributes: a
 * switch or a Blocked tool never changes the answer.
 */
export function getGoogleToolsUnavailableReason(
  input: GoogleToolsAvailabilityInput,
): GoogleToolsUnavailableReason | null {
  if (input.gateway && !input.holdsGoogleData) {
    return GOOGLE_TOOLS_GATEWAY_REASON
  }

  if (!input.toolCalling) {
    return GOOGLE_TOOLS_CALLING_OFF_REASON
  }

  if (input.providerToolsStayCallable && !input.holdsGoogleData) {
    return 'provider_tool_not_removable'
  }

  const isRecipientAllowed = input.recipientAllowed
    ?? (input.recipient
      ? decideGoogleDataRecipient(input.recipient, {
        geminiPaidTierConfirmed: input.geminiPaidTierConfirmed === true,
        gatewaySafeguardsSent: input.gateway,
      }).allowed
      : true)

  return isRecipientAllowed ? null : 'model_may_not_receive_google_data'
}

const GATEWAY_NOTE: GoogleToolsWithheldNote = {
  summary: 'Google tools need a Google file in this chat first.',
  detail: 'In a gateway chat, Besidka offers Google tools only once a '
    + 'Google file is in the chat, because only then it sends the '
    + 'gateway\'s data safeguards. Attach a Drive file first.',
  linkLabel: null,
}

/**
 * The text that explains a reason in the connector picker, or null for a
 * reason that has none to show.
 */
export function getGoogleToolsUnavailableNote(
  reason: GoogleToolsUnavailableReason,
): GoogleToolsWithheldNote | null {
  if (reason === GOOGLE_TOOLS_GATEWAY_REASON) {
    return GATEWAY_NOTE
  }

  return isGoogleToolsWithheldReason(reason)
    ? GOOGLE_TOOLS_WITHHELD_NOTES[reason]
    : null
}

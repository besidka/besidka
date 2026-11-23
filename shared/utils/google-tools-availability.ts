import { decideGoogleDataRecipient } from '#shared/utils/google-data-recipient'
import type { GoogleDataRecipient } from '#shared/utils/google-data-recipient'
import {
  GOOGLE_TOOLS_OPEN_KEYS_LABEL,
  GOOGLE_TOOLS_WITHHELD_KEYS_PATH,
  getGoogleToolsWithheldNote,
  googleProviderNeedsPaidTier,
  isGoogleToolsWithheldReason,
} from '#shared/utils/google-tools-withheld'
import type {
  GoogleToolsRecipientHint,
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
 * reason that has none to show. The refused-recipient text depends on the
 * recipient (see `getGoogleToolsWithheldNote`).
 */
export function getGoogleToolsUnavailableNote(
  reason: GoogleToolsUnavailableReason,
  recipient: GoogleToolsRecipientHint = {},
): GoogleToolsWithheldNote | null {
  if (reason === GOOGLE_TOOLS_GATEWAY_REASON) {
    return GATEWAY_NOTE
  }

  return isGoogleToolsWithheldReason(reason)
    ? getGoogleToolsWithheldNote(reason, recipient)
    : null
}

export const GOOGLE_TOOLS_CHOOSE_MODEL_LABEL = 'Choose another model'

export const GEMINI_PROVIDER_ID = 'google'

/**
 * What the picker offers under a reason note. `open-api-keys` and
 * `choose-model` are buttons; `confirm-paid-tier` renders the API Keys
 * page's own paid-tier confirmation, so the wording and the route stay the
 * ones the user sees there.
 */
export type GoogleToolsNoteAction
  = | { kind: 'open-api-keys', label: string, path: string }
    | { kind: 'confirm-paid-tier' }
    | { kind: 'choose-model', label: string }

export interface GoogleToolsNoteActionContext {
  recipientProviderId: string | null
  hasGeminiKey: boolean
  geminiPaidTierConfirmed: boolean
  isGateway?: boolean
}

/**
 * The actions under the note of a reason. Only a recipient the allow-list
 * refuses has any. The API Keys link and the inline paid-tier confirmation
 * exist only for a direct Gemini model (the one refusal the API Keys page can
 * lift; the confirmation shows only while the saved key is not yet
 * confirmed, so one tap cannot withdraw the statement). A provider the list
 * refuses outright (DeepSeek, Moonshot AI) or allows only on models its
 * vendor serves (Qwen) gets just a way to another model, because nothing on
 * the API Keys page unlocks it. A gateway keeps the link and the way to
 * another model.
 */
export function getGoogleToolsUnavailableActions(
  reason: GoogleToolsUnavailableReason,
  context: GoogleToolsNoteActionContext,
): GoogleToolsNoteAction[] {
  if (reason !== 'model_may_not_receive_google_data') {
    return []
  }

  const openApiKeys: GoogleToolsNoteAction = {
    kind: 'open-api-keys',
    label: GOOGLE_TOOLS_OPEN_KEYS_LABEL,
    path: GOOGLE_TOOLS_WITHHELD_KEYS_PATH,
  }
  const chooseModel: GoogleToolsNoteAction = {
    kind: 'choose-model',
    label: GOOGLE_TOOLS_CHOOSE_MODEL_LABEL,
  }

  if (context.isGateway === true) {
    return [openApiKeys, chooseModel]
  }

  if (!googleProviderNeedsPaidTier(context.recipientProviderId)) {
    return [chooseModel]
  }

  if (context.geminiPaidTierConfirmed) {
    return [openApiKeys, chooseModel]
  }

  return context.hasGeminiKey
    ? [openApiKeys, { kind: 'confirm-paid-tier' }]
    : [openApiKeys]
}

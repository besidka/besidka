import {
  decideGoogleDataRecipient,
  googleDataRefusalReason,
} from '#shared/utils/google-data-recipient'
import type { GoogleDataRecipient } from '#shared/utils/google-data-recipient'

/**
 * Which chats hold Google data (`chats.google_data_at`, sticky on the
 * server), keyed by slug. The chat page records what it loaded; the flag
 * never goes back to false in a session, as on the server.
 */
export function useChatGoogleData() {
  const holdsBySlug = useState<Record<string, boolean>>(
    'chat-google-data:holds-by-slug',
    () => ({}),
  )

  function isChatHoldingGoogleData(slug: string | null | undefined): boolean {
    return !!slug && holdsBySlug.value[slug] === true
  }

  function rememberChatGoogleData(
    slug: string,
    holdsGoogleData: boolean | null | undefined,
  ) {
    if (!holdsGoogleData || holdsBySlug.value[slug]) {
      return
    }

    holdsBySlug.value = { ...holdsBySlug.value, [slug]: true }
  }

  return { isChatHoldingGoogleData, rememberChatGoogleData }
}

/**
 * The reason a model cannot be picked in the current chat because the chat
 * holds Google data, or an empty string when it can. Uses the same
 * allow-list as the server guard; gateway routes count their safeguard as
 * sent, because the server always sends it in such a chat.
 */
export function useGoogleDataRecipientReason() {
  const { routeSlug } = useChatRoute()
  const { isChatHoldingGoogleData } = useChatGoogleData()
  const { isGeminiPaidTierConfirmed } = useUserKeys()

  const holdsGoogleData = computed<boolean>(() => {
    return isChatHoldingGoogleData(routeSlug.value)
  })

  function googleDataReasonFor(recipient: GoogleDataRecipient): string {
    if (!holdsGoogleData.value) {
      return ''
    }

    const decision = decideGoogleDataRecipient(recipient, {
      geminiPaidTierConfirmed: isGeminiPaidTierConfirmed.value,
      gatewaySafeguardsSent: true,
    })

    return googleDataRefusalReason(decision, recipient)
  }

  return { holdsGoogleData, googleDataReasonFor }
}

import { parseError } from 'evlog'
import type { MaybeRefOrGetter } from 'vue'
import {
  GOOGLE_KEYS_TAB_PATH,
  GOOGLE_LABS_PATH,
  buildGoogleEntryPath,
} from '#shared/utils/google-connectors'
import type { GoogleConnectionStatusResponse } from '#shared/utils/google-connections'
import { GOOGLE_SERVICES } from '#shared/utils/google-tool-catalog'
import type { GoogleService } from '#shared/utils/google-tool-catalog'
import {
  getGoogleToolsUnavailableNote,
  getGoogleToolsUnavailableReason,
} from '#shared/utils/google-tools-availability'
import type {
  GoogleToolsUnavailableReason,
} from '#shared/utils/google-tools-availability'
import type { GoogleToolsWithheldNote } from '#shared/utils/google-tools-withheld'
import { resolveGoogleEntries } from '~/utils/google-entries'
import type { GoogleEntry } from '~/utils/google-entries'

export const NEW_CHAT_GOOGLE_TOOLS_KEY = 'new'

export const GOOGLE_ROW_UNAVAILABLE_LINE = 'Not available with this model'

export const GOOGLE_ROW_OFF_LINE = 'Off in this chat'

export interface GoogleToolsSelectionState {
  chatKey: string
  off: GoogleService[]
  isKnown: boolean
  shouldSend: boolean
}

export interface ComposerGoogleRowLink {
  label: string
  path: string
}

export interface ComposerGoogleRow {
  entryId: GoogleEntry['id']
  service: GoogleService
  title: string
  icon: string
  kind: 'switch' | 'link'
  isOn: boolean
  subLine: string
  reasonNote: GoogleToolsWithheldNote | null
  link: ComposerGoogleRowLink | null
}

function buildLink(entry: GoogleEntry): ComposerGoogleRowLink {
  if (entry.state === 'needs-client') {
    return { label: 'Add client', path: GOOGLE_KEYS_TAB_PATH }
  }

  if (entry.state === 'off-in-labs') {
    return { label: 'Open Labs', path: GOOGLE_LABS_PATH }
  }

  return {
    label: entry.state === 'needs-reauth' ? 'Reconnect' : 'Connect',
    path: buildGoogleEntryPath(entry.id),
  }
}

/**
 * The picker rows of the Google services, from the entries the Connectors
 * page shows (so a service the user may not see there is not here either)
 * and the chat's switches. A connected service gets a switch; one that is
 * not connected, needs a reconnect, needs the user's own Google client or is
 * off in Labs gets a link to where that is fixed. A leftover connection that
 * the account no longer passes the gate for (`unavailable`) gets no row.
 * `reason` is why this send offers no Google tool at all, the same for every
 * service: the switch is then disabled and the reason sits behind an info
 * button.
 */
export function buildComposerGoogleRows(input: {
  entries: readonly GoogleEntry[]
  servicesOff: readonly GoogleService[]
  reason: GoogleToolsUnavailableReason | null
}): ComposerGoogleRow[] {
  const reasonNote = input.reason
    ? getGoogleToolsUnavailableNote(input.reason)
    : null

  return input.entries.flatMap((entry): ComposerGoogleRow[] => {
    if (entry.state === 'unavailable') {
      return []
    }

    const base = {
      entryId: entry.id,
      service: entry.service,
      title: entry.title,
      icon: entry.icon,
    }

    if (entry.state !== 'connected' && entry.state !== 'partial') {
      return [{
        ...base,
        kind: 'link',
        isOn: false,
        subLine: entry.stateLine,
        reasonNote: null,
        link: buildLink(entry),
      }]
    }

    const isOn = !input.servicesOff.includes(entry.service)
    let subLine = entry.stateLine

    if (reasonNote) {
      subLine = GOOGLE_ROW_UNAVAILABLE_LINE
    } else if (!isOn) {
      subLine = GOOGLE_ROW_OFF_LINE
    }

    return [{
      ...base,
      kind: 'switch',
      isOn,
      subLine,
      reasonNote,
      link: null,
    }]
  })
}

/**
 * Whether per-chat Google switches can exist at all: tool approvals and the
 * `google.drive` flag active, the same gate as the switch routes.
 */
export function useGoogleToolsAvailability() {
  const toolApprovalsFeature = useFeature('tool-approvals')
  const driveFeature = useFeature('google.drive')

  return computed<boolean>(() => {
    return toolApprovalsFeature.value.active && driveFeature.value.active
  })
}

/**
 * The per-chat Google choice shared by the picker and the send body. Every
 * service is on by default. `isKnown` is false until the stored choice was
 * read (or handed over from the new-chat page), so a send never overwrites a
 * stored choice it has not seen; `shouldSend` is true only for a choice
 * handed over from the new-chat page, which the first send carries.
 */
export function useGoogleToolsSelection() {
  const selection = useState<GoogleToolsSelectionState>(
    'google-tools:selection',
    () => ({
      chatKey: NEW_CHAT_GOOGLE_TOOLS_KEY,
      off: [],
      isKnown: true,
      shouldSend: false,
    }),
  )

  function handOff(chatSlug: string) {
    if (selection.value.chatKey !== NEW_CHAT_GOOGLE_TOOLS_KEY) {
      return
    }

    selection.value = {
      chatKey: chatSlug,
      off: selection.value.off,
      isKnown: true,
      shouldSend: true,
    }
  }

  return { selection, handOff }
}

export function useComposerGoogleTools(
  chatSlug: MaybeRefOrGetter<string | null>,
  context: {
    enabledTools: MaybeRefOrGetter<readonly string[]>
    isToolCallingSupported: MaybeRefOrGetter<boolean>
  },
) {
  const isAvailable = useGoogleToolsAvailability()
  const { selection } = useGoogleToolsSelection()
  const { selection: modelSelection } = useUserModel()
  const { isChatHoldingGoogleData } = useChatGoogleData()
  const { isGeminiPaidTierConfirmed } = useUserKeys()
  const driveFeature = useFeature('google.drive')
  const gmailFeature = useFeature('google.gmail')
  const calendarFeature = useFeature('google.calendar')
  const isSaving = shallowRef<boolean>(false)
  const loadingChatKey = shallowRef<string | null>(null)
  const status = shallowRef<GoogleConnectionStatusResponse | null>(null)

  const chatKey = computed<string>(() => {
    return toValue(chatSlug) ?? NEW_CHAT_GOOGLE_TOOLS_KEY
  })

  const servicesOff = computed<GoogleService[]>(() => {
    return selection.value.chatKey === chatKey.value
      ? selection.value.off
      : []
  })

  const unavailableReason = computed<GoogleToolsUnavailableReason | null>(
    () => {
      const current = modelSelection.value
      const isGateway = current.source === 'gateway'
      const providerId = isGateway
        ? null
        : getModel(current.modelId).provider?.id ?? null
      const tools = toValue(context.enabledTools)
      const hasNativeSearch = tools.includes('web_search')
      const providerToolsStayCallable
        = (providerId === 'anthropic'
          && (hasNativeSearch || tools.includes('code_execution')))
        || (providerId === 'qwen' && hasNativeSearch)

      return getGoogleToolsUnavailableReason({
        toolCalling: toValue(context.isToolCallingSupported),
        gateway: isGateway,
        holdsGoogleData: isChatHoldingGoogleData(toValue(chatSlug)),
        providerToolsStayCallable,
        recipient: current.source === 'gateway'
          ? { gatewayId: current.gatewayId, modelId: current.modelId }
          : { providerId, modelId: current.modelId },
        geminiPaidTierConfirmed: isGeminiPaidTierConfirmed.value,
      })
    },
  )

  const rows = computed<ComposerGoogleRow[]>(() => {
    if (!isAvailable.value) {
      return []
    }

    return buildComposerGoogleRows({
      entries: resolveGoogleEntries({
        status: status.value,
        driveFeature: driveFeature.value,
        isGmailActive: gmailFeature.value.active,
        isCalendarActive: calendarFeature.value.active,
      }),
      servicesOff: servicesOff.value,
      reason: unavailableReason.value,
    })
  })

  watch(chatKey, (key) => {
    if (selection.value.chatKey === key) {
      return
    }

    selection.value = {
      chatKey: key,
      off: [],
      isKnown: key === NEW_CHAT_GOOGLE_TOOLS_KEY,
      shouldSend: false,
    }
  }, { immediate: true })

  watch(
    [isAvailable, chatKey, () => selection.value.isKnown],
    async ([available, key, isKnown]) => {
      if (
        !available
        || isKnown
        || key === NEW_CHAT_GOOGLE_TOOLS_KEY
        || loadingChatKey.value === key
      ) {
        return
      }

      loadingChatKey.value = key

      try {
        const response = await $fetch(`/api/v1/chats/${key}/google-tools`)

        if (selection.value.chatKey !== key || selection.value.isKnown) {
          return
        }

        selection.value = {
          chatKey: key,
          off: GOOGLE_SERVICES.filter(service => !response[service]),
          isKnown: true,
          shouldSend: false,
        }
      } catch {
        return
      } finally {
        loadingChatKey.value = null
      }
    },
    { immediate: true },
  )

  async function refresh() {
    if (!isAvailable.value) {
      return
    }

    try {
      status.value = await $fetch('/api/v1/google/connections')
    } catch {
      return
    }
  }

  async function toggle(service: GoogleService) {
    if (isSaving.value) {
      return
    }

    const key = chatKey.value
    const slug = toValue(chatSlug)
    const previous = selection.value
    const isOn = !servicesOff.value.includes(service)
    const off = isOn
      ? [...servicesOff.value, service]
      : servicesOff.value.filter(entry => entry !== service)

    selection.value = {
      chatKey: key,
      off,
      isKnown: true,
      shouldSend: previous.chatKey === key && previous.shouldSend,
    }

    if (!slug) {
      return
    }

    isSaving.value = true

    try {
      const response = await $fetch(`/api/v1/chats/${slug}/google-tools`, {
        method: 'PUT',
        body: { service, enabled: !isOn },
      })

      if (selection.value.chatKey === key) {
        selection.value = {
          chatKey: key,
          off: GOOGLE_SERVICES.filter(entry => !response[entry]),
          isKnown: true,
          shouldSend: false,
        }
      }
    } catch (exception) {
      if (selection.value.chatKey === key) {
        selection.value = previous
      }

      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Could not update Google tools',
        parsedException.why,
      )
    } finally {
      isSaving.value = false
    }
  }

  return {
    isAvailable,
    isSaving,
    rows,
    servicesOff,
    unavailableReason,
    refresh,
    toggle,
  }
}

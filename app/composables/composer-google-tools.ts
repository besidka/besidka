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
  GEMINI_PROVIDER_ID,
  getGoogleToolsUnavailableActions,
  getGoogleToolsUnavailableNote,
  getGoogleToolsUnavailableReason,
} from '#shared/utils/google-tools-availability'
import type {
  GoogleToolsNoteAction,
  GoogleToolsUnavailableReason,
} from '#shared/utils/google-tools-availability'
import type { GoogleToolsWithheldNote } from '#shared/utils/google-tools-withheld'
import { resolveGoogleEntries } from '~/utils/google-entries'
import type { GoogleEntry } from '~/utils/google-entries'

export const NEW_CHAT_GOOGLE_TOOLS_KEY = 'new'

export const googleServicePutQueue = createSpacedKeyedQueue()

const GOOGLE_SERVICE_FALLBACK_TITLES: Readonly<Record<GoogleService, string>>
  = {
    drive: 'Google Drive',
    gmail: 'Gmail',
    calendar: 'Google Calendar',
  }

export const GOOGLE_ROW_UNAVAILABLE_LINE = 'Not available with this model'

export const GOOGLE_ROW_OFF_LINE = 'Off in this chat'

export interface GoogleToolsSelectionState {
  chatKey: string
  off: GoogleService[]
  isKnown: boolean
  shouldSend: boolean
}

export type GoogleChoiceState = 'ready' | 'loading' | 'error'

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
  reasonActions: GoogleToolsNoteAction[]
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
 * button, with the actions that can lift the reason under it.
 */
export function buildComposerGoogleRows(input: {
  entries: readonly GoogleEntry[]
  servicesOff: readonly GoogleService[]
  reason: GoogleToolsUnavailableReason | null
  recipientProviderId?: string | null
  isGatewayRecipient?: boolean
  hasGeminiKey?: boolean
  geminiPaidTierConfirmed?: boolean
}): ComposerGoogleRow[] {
  const reasonNote = input.reason
    ? getGoogleToolsUnavailableNote(input.reason, {
      providerId: input.recipientProviderId ?? null,
      isGateway: input.isGatewayRecipient === true,
    })
    : null
  const reasonActions = input.reason && reasonNote
    ? getGoogleToolsUnavailableActions(input.reason, {
      recipientProviderId: input.recipientProviderId ?? null,
      isGateway: input.isGatewayRecipient === true,
      hasGeminiKey: input.hasGeminiKey === true,
      geminiPaidTierConfirmed: input.geminiPaidTierConfirmed === true,
    })
    : []

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
        reasonActions: [],
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
      reasonActions,
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
 * The `googleServicesOff` field of a send body: present only while a choice
 * handed over from the new-chat page has not been carried by a send that
 * went through (`shouldSend`). Later sends of the chat never carry it, so
 * the picker's saves are the only writer of an existing chat's choice.
 */
export function getGoogleServicesOffField(
  selection: GoogleToolsSelectionState,
  isAvailable: boolean,
  chatSlug: string,
): { googleServicesOff?: GoogleService[] } {
  if (
    !isAvailable
    || !selection.isKnown
    || !selection.shouldSend
    || selection.chatKey !== chatSlug
  ) {
    return {}
  }

  return { googleServicesOff: selection.off }
}

/**
 * The per-chat Google choice shared by the picker and the send body. Every
 * service is on by default. `isKnown` is false until the stored choice was
 * read (or handed over from the new-chat page), so a send never overwrites a
 * stored choice it has not seen; `shouldSend` is true only for a choice
 * handed over from the new-chat page, which the first send carries until
 * `settleFirstSend` clears it.
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

  function settleFirstSend(chatSlug: string) {
    if (
      selection.value.chatKey !== chatSlug
      || !selection.value.shouldSend
    ) {
      return
    }

    selection.value = { ...selection.value, shouldSend: false }
  }

  return { selection, handOff, settleFirstSend }
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
  const { isGeminiPaidTierConfirmed, keyStatusForProvider } = useUserKeys()
  const driveFeature = useFeature('google.drive')
  const gmailFeature = useFeature('google.gmail')
  const calendarFeature = useFeature('google.calendar')
  const savingServices = shallowRef<GoogleService[]>([])
  const hasLoadFailed = shallowRef<boolean>(false)
  const announcement = shallowRef<string>('')
  const status = shallowRef<GoogleConnectionStatusResponse | null>(null)
  let loadSequence = 0
  let statusSequence = 0

  const chatKey = computed<string>(() => {
    return toValue(chatSlug) ?? NEW_CHAT_GOOGLE_TOOLS_KEY
  })

  const isChoiceKnown = computed<boolean>(() => {
    return selection.value.chatKey === chatKey.value
      && selection.value.isKnown
  })

  const choiceState = computed<GoogleChoiceState>(() => {
    if (isChoiceKnown.value) {
      return 'ready'
    }

    return hasLoadFailed.value ? 'error' : 'loading'
  })

  const servicesOff = computed<GoogleService[]>(() => {
    return selection.value.chatKey === chatKey.value
      ? selection.value.off
      : []
  })

  const recipientProviderId = computed<string | null>(() => {
    const current = modelSelection.value

    return current.source === 'gateway'
      ? null
      : getModel(current.modelId).provider?.id ?? null
  })

  const unavailableReason = computed<GoogleToolsUnavailableReason | null>(
    () => {
      const current = modelSelection.value
      const isGateway = current.source === 'gateway'
      const providerId = recipientProviderId.value
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
      recipientProviderId: recipientProviderId.value,
      isGatewayRecipient: modelSelection.value.source === 'gateway',
      hasGeminiKey: keyStatusForProvider(GEMINI_PROVIDER_ID) === 'saved',
      geminiPaidTierConfirmed: isGeminiPaidTierConfirmed.value,
    })
  })

  watch(chatKey, (key) => {
    hasLoadFailed.value = false

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

  async function loadStoredChoice(key: string) {
    loadSequence += 1

    const sequence = loadSequence

    hasLoadFailed.value = false

    try {
      const response = await $fetch(`/api/v1/chats/${key}/google-tools`)

      if (
        sequence !== loadSequence
        || selection.value.chatKey !== key
        || selection.value.isKnown
      ) {
        return
      }

      selection.value = {
        chatKey: key,
        off: GOOGLE_SERVICES.filter(service => !response[service]),
        isKnown: true,
        shouldSend: false,
      }
    } catch {
      if (sequence === loadSequence) {
        hasLoadFailed.value = true
      }
    }
  }

  watch(
    [isAvailable, chatKey, () => selection.value.isKnown],
    ([available, key, isKnown]) => {
      if (!available || isKnown || key === NEW_CHAT_GOOGLE_TOOLS_KEY) {
        return
      }

      loadStoredChoice(key)
    },
    { immediate: true },
  )

  function retry() {
    if (
      !isAvailable.value
      || isChoiceKnown.value
      || chatKey.value === NEW_CHAT_GOOGLE_TOOLS_KEY
    ) {
      return
    }

    loadStoredChoice(chatKey.value)
  }

  async function refresh() {
    if (!isAvailable.value) {
      return
    }

    announcement.value = ''
    statusSequence += 1

    const sequence = statusSequence

    try {
      const response = await $fetch('/api/v1/google/connections')

      if (sequence === statusSequence) {
        status.value = response
      }
    } catch {
      return
    }
  }

  function describeService(service: GoogleService): string {
    return rows.value.find(row => row.service === service)?.title
      ?? GOOGLE_SERVICE_FALLBACK_TITLES[service]
  }

  function setServiceState(
    key: string,
    service: GoogleService,
    isOn: boolean,
  ) {
    const others = selection.value.off.filter(entry => entry !== service)

    selection.value = {
      ...selection.value,
      chatKey: key,
      off: GOOGLE_SERVICES.filter((entry) => {
        return entry === service ? !isOn : others.includes(entry)
      }),
      isKnown: true,
    }
  }

  async function toggle(service: GoogleService) {
    const key = chatKey.value

    if (
      !isChoiceKnown.value
      || savingServices.value.includes(service)
    ) {
      return
    }

    const slug = toValue(chatSlug)
    const wasOn = !servicesOff.value.includes(service)
    const title = describeService(service)

    setServiceState(key, service, !wasOn)

    if (!slug) {
      announcement.value = `${title} is now ${wasOn ? 'off' : 'on'} in `
        + 'this chat'

      return
    }

    savingServices.value = [...savingServices.value, service]

    try {
      const response = await googleServicePutQueue.enqueue(service, () => {
        return $fetch(`/api/v1/chats/${slug}/google-tools`, {
          method: 'PUT',
          body: { service, enabled: !wasOn },
        })
      })

      if (selection.value.chatKey === key) {
        const pending = savingServices.value.filter((entry) => {
          return entry !== service
        })

        selection.value = {
          chatKey: key,
          off: GOOGLE_SERVICES.filter((entry) => {
            return pending.includes(entry)
              ? selection.value.off.includes(entry)
              : !response[entry]
          }),
          isKnown: true,
          shouldSend: false,
        }
      }

      announcement.value = `${title} is now ${wasOn ? 'off' : 'on'} in `
        + 'this chat'
    } catch (exception) {
      if (selection.value.chatKey === key) {
        setServiceState(key, service, wasOn)
      }

      const parsedException = parseError(exception)

      announcement.value = `${title} is back ${wasOn ? 'on' : 'off'} in `
        + 'this chat. Saving failed.'
      useErrorMessage(
        parsedException.message || 'Could not update Google tools',
        parsedException.why,
      )
    } finally {
      savingServices.value = savingServices.value.filter((entry) => {
        return entry !== service
      })
    }
  }

  return {
    isAvailable,
    savingServices,
    choiceState,
    announcement,
    rows,
    servicesOff,
    unavailableReason,
    refresh,
    retry,
    toggle,
  }
}

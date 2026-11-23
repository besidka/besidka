import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, ref } from 'vue'
import type {
  GoogleByoConnectionStatus,
  GoogleConnectionStatusResponse,
  GoogleConnectionSummary,
} from '#shared/utils/google-connections'
import {
  GOOGLE_ROW_OFF_LINE,
  GOOGLE_ROW_UNAVAILABLE_LINE,
  NEW_CHAT_GOOGLE_TOOLS_KEY,
  buildComposerGoogleRows,
  getGoogleServicesOffField,
  googleServicePutQueue,
  useComposerGoogleTools,
  useGoogleToolsSelection,
} from '../../../app/composables/composer-google-tools'
import type {
  GoogleToolsSelectionState,
} from '../../../app/composables/composer-google-tools'
import { resolveGoogleEntries } from '../../../app/utils/google-entries'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  errorMessage: vi.fn(),
}))

const activeFlags = ref<Set<string>>(new Set())
const modelSelection = ref<Record<string, string>>({
  source: 'provider',
  modelId: 'claude-sonnet-5-5',
})
const holdsBySlug = ref<Record<string, boolean>>({})
const paidTier = ref<boolean>(false)
const hasGeminiKey = ref<boolean>(true)

mockNuxtImport('useFeature', () => {
  return (flag: string) => computed(() => ({
    enabled: activeFlags.value.has(flag),
    active: activeFlags.value.has(flag),
    variant: null,
  }))
})
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)
mockNuxtImport('useUserModel', () => {
  return () => ({ selection: modelSelection })
})
mockNuxtImport('useChatGoogleData', () => {
  return () => ({
    isChatHoldingGoogleData: (slug: string | null) => {
      return !!slug && holdsBySlug.value[slug] === true
    },
  })
})
mockNuxtImport('useUserKeys', () => {
  return () => ({
    isGeminiPaidTierConfirmed: computed(() => paidTier.value),
    hasKeyForProvider: () => hasGeminiKey.value,
  })
})

const SLUG = '01HZXBBBBBBBBBBBBBBBBBBBBB'

function allOn() {
  return { drive: true, gmail: true, calendar: true }
}

function putCalls() {
  return mocks.fetch.mock.calls.filter(([, init]) => {
    return (init as { method?: string } | undefined)?.method === 'PUT'
  })
}

function deferPuts() {
  const pending = new Map<string, {
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
  }>()

  mocks.fetch.mockImplementation((_url: string, init?: {
    method?: string
    body?: { service: string }
  }) => {
    if (init?.method === 'PUT') {
      return new Promise((resolve, reject) => {
        pending.set(init.body!.service, { resolve, reject })
      })
    }

    return Promise.resolve(allOn())
  })

  return {
    resolve: (service: string, value: unknown) => {
      pending.get(service)!.resolve(value)
    },
    reject: (service: string, reason: unknown) => {
      pending.get(service)!.reject(reason)
    },
  }
}

function summary(
  patch: Partial<GoogleConnectionSummary> = {},
): GoogleConnectionSummary {
  return {
    clientMode: 'besidka',
    status: 'active',
    email: 'person@example.test',
    isWorkspaceAccount: false,
    capabilities: ['identity', 'drive-picked'],
    connectedAt: '2026-11-22T12:00:00.000Z',
    ...patch,
  }
}

function status(
  patch: Partial<GoogleConnectionStatusResponse> = {},
  byo: Partial<GoogleByoConnectionStatus> | null = null,
): GoogleConnectionStatusResponse {
  return {
    connection: summary(),
    canConnect: true,
    dedicatedClient: true,
    byo: byo
      ? {
        canManage: true,
        redirectUri: 'https://besidka.example/api/v1/google/byo/callback',
        hasClient: true,
        connection: null,
        ...byo,
      }
      : null,
    ...patch,
  }
}

function entriesOf(
  input: GoogleConnectionStatusResponse | null,
  overrides: { gmail?: boolean, calendar?: boolean } = {},
) {
  return resolveGoogleEntries({
    status: input,
    driveFeature: { enabled: true, active: true },
    isGmailActive: overrides.gmail ?? true,
    isCalendarActive: overrides.calendar ?? true,
  })
}

const BYO_CONNECTED = {
  connection: summary({
    clientMode: 'byo',
    capabilities: ['identity', 'gmail-read', 'gmail-compose', 'calendar'],
  }),
}

describe('buildComposerGoogleRows', () => {
  it('gives a connected service a switch with its account as the sub-line',
    () => {
      const [drive] = buildComposerGoogleRows({
        entries: entriesOf(status()),
        servicesOff: [],
        reason: null,
      })

      expect(drive).toMatchObject({
        service: 'drive',
        kind: 'switch',
        isOn: true,
        subLine: 'person@example.test',
        reasonNote: null,
        reasonActions: [],
        link: null,
        title: 'Google Drive',
      })
    })

  it('says "Off in this chat" for a service the chat switched off', () => {
    const rows = buildComposerGoogleRows({
      entries: entriesOf(status()),
      servicesOff: ['drive'],
      reason: null,
    })

    expect(rows[0]).toMatchObject({
      isOn: false,
      subLine: GOOGLE_ROW_OFF_LINE,
    })
    expect(GOOGLE_ROW_OFF_LINE).toBe('Off in this chat')
  })

  it('gives a service not connected a Connect link to its panel', () => {
    const rows = buildComposerGoogleRows({
      entries: entriesOf(status({ connection: null })),
      servicesOff: [],
      reason: null,
    })

    expect(rows[0]).toMatchObject({
      kind: 'link',
      subLine: 'Not connected',
      link: {
        label: 'Connect',
        path: '/chats/connectors?panel=google-drive',
      },
    })
  })

  it('gives a connection that needs a reconnect a Reconnect link', () => {
    const rows = buildComposerGoogleRows({
      entries: entriesOf(status({
        connection: summary({ status: 'needs_reauth' }),
      })),
      servicesOff: [],
      reason: null,
    })

    expect(rows[0]).toMatchObject({
      kind: 'link',
      subLine: 'Needs reconnect',
      link: { label: 'Reconnect' },
    })
  })

  it('links Gmail and Calendar without a saved client to the Google tab',
    () => {
      const rows = buildComposerGoogleRows({
        entries: entriesOf(status({}, { hasClient: false })),
        servicesOff: [],
        reason: null,
      })
      const gmail = rows.find(row => row.service === 'gmail')

      expect(gmail).toMatchObject({
        kind: 'link',
        subLine: 'Needs your own Google client',
        link: { path: '/profile/keys?tab=google' },
      })
    })

  it('shows no Gmail or Calendar row to a user who may not see them',
    () => {
      const rows = buildComposerGoogleRows({
        entries: entriesOf(status()),
        servicesOff: [],
        reason: null,
      })

      expect(rows.map(row => row.service)).toEqual(['drive'])
    })

  it('shows no row for a leftover connection the account may not use',
    () => {
      const rows = buildComposerGoogleRows({
        entries: entriesOf(status({}, {
          canManage: false,
          connection: BYO_CONNECTED.connection,
        })),
        servicesOff: [],
        reason: null,
      })

      expect(rows.map(row => row.service)).toEqual(['drive'])
    })

  it('links a service that is off in Labs to Labs', () => {
    const rows = buildComposerGoogleRows({
      entries: entriesOf(status({}, BYO_CONNECTED), { gmail: false }),
      servicesOff: [],
      reason: null,
    })
    const gmail = rows.find(row => row.service === 'gmail')

    expect(gmail).toMatchObject({
      kind: 'link',
      subLine: 'Off in Labs',
      link: { path: '/profile/labs' },
    })
  })

  it('keeps a switch for every connected service in the entry order', () => {
    const rows = buildComposerGoogleRows({
      entries: entriesOf(status({}, BYO_CONNECTED)),
      servicesOff: ['calendar'],
      reason: null,
    })

    expect(rows.map(row => [row.service, row.kind, row.isOn])).toEqual([
      ['drive', 'switch', true],
      ['gmail', 'switch', true],
      ['calendar', 'switch', false],
    ])
  })

  it('puts the reason on every switch and keeps a link row as it is', () => {
    const rows = buildComposerGoogleRows({
      entries: entriesOf(status({}, { hasClient: false })),
      servicesOff: ['drive'],
      reason: 'model_may_not_receive_google_data',
    })

    expect(rows[0]).toMatchObject({
      kind: 'switch',
      subLine: GOOGLE_ROW_UNAVAILABLE_LINE,
      reasonNote: { summary: expect.any(String), detail: expect.any(String) },
    })
    expect(rows[1]).toMatchObject({ kind: 'link', reasonNote: null })
    expect(GOOGLE_ROW_UNAVAILABLE_LINE).toBe('Not available with this model')
  })

  it('has no note for a model without tool calling', () => {
    const [drive] = buildComposerGoogleRows({
      entries: entriesOf(status()),
      servicesOff: [],
      reason: 'tool_calling_off',
    })

    expect(drive?.reasonNote).toBeNull()
    expect(drive?.subLine).toBe('person@example.test')
  })
})

async function mountComposable(
  chatSlug: string | null = null,
  options: { tools?: string[], toolCalling?: boolean } = {},
) {
  const slug = ref<string | null>(chatSlug)
  const tools = ref<string[]>(options.tools ?? [])
  const toolCalling = ref<boolean>(options.toolCalling ?? true)
  let result: ReturnType<typeof useComposerGoogleTools> | null = null

  await mountSuspended(defineComponent({
    setup() {
      result = useComposerGoogleTools(() => slug.value, {
        enabledTools: () => tools.value,
        isToolCallingSupported: () => toolCalling.value,
      })

      return () => null
    },
  }))
  await flushPromises()

  return { composable: result!, slug, tools, toolCalling }
}

describe('useComposerGoogleTools', () => {
  beforeEach(() => {
    activeFlags.value = new Set(['tool-approvals', 'google.drive'])
    modelSelection.value = { source: 'provider', modelId: 'claude-sonnet-5-5' }
    holdsBySlug.value = {}
    paidTier.value = false
    hasGeminiKey.value = true
    mocks.fetch.mockReset()
    mocks.errorMessage.mockReset()
    googleServicePutQueue.reset()
    useGoogleToolsSelection().selection.value = {
      chatKey: NEW_CHAT_GOOGLE_TOOLS_KEY,
      off: [],
      isKnown: true,
      shouldSend: false,
    }
  })

  it('exists only with tool approvals and google.drive active', async () => {
    const { composable } = await mountComposable()

    expect(composable.isAvailable.value).toBe(true)

    activeFlags.value = new Set(['tool-approvals'])

    expect(composable.isAvailable.value).toBe(false)
    expect(composable.rows.value).toEqual([])

    activeFlags.value = new Set(['google.drive'])

    expect(composable.isAvailable.value).toBe(false)
  })

  it('loads the connection status only when asked and builds the rows',
    async () => {
      mocks.fetch.mockResolvedValue(status())

      const { composable } = await mountComposable()

      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(composable.rows.value).toEqual([])

      await composable.refresh()

      expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/google/connections')
      expect(composable.rows.value.map(row => row.service)).toEqual(['drive'])
    })

  it('does not load the status when it does not exist', async () => {
    activeFlags.value = new Set()

    const { composable } = await mountComposable()

    await composable.refresh()

    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('keeps no rows when the status cannot be loaded', async () => {
    mocks.fetch.mockRejectedValue(new Error('Offline'))

    const { composable } = await mountComposable()

    await composable.refresh()

    expect(composable.rows.value).toEqual([])
  })

  it('is on for a new chat and toggles locally until it has a slug',
    async () => {
      const { composable } = await mountComposable()

      await composable.toggle('gmail')

      expect(composable.servicesOff.value).toEqual(['gmail'])
      expect(mocks.fetch).not.toHaveBeenCalled()

      useGoogleToolsSelection().handOff(SLUG)

      expect(useGoogleToolsSelection().selection.value).toEqual({
        chatKey: SLUG,
        off: ['gmail'],
        isKnown: true,
        shouldSend: true,
      })
    })

  it('does not hand a choice over to a chat that is not new', async () => {
    useGoogleToolsSelection().selection.value = {
      chatKey: SLUG,
      off: ['drive'],
      isKnown: true,
      shouldSend: false,
    }
    useGoogleToolsSelection().handOff('01HZXCCCCCCCCCCCCCCCCCCCCC')

    expect(useGoogleToolsSelection().selection.value.chatKey).toBe(SLUG)
  })

  it('reads the stored switches of a chat and saves a toggle', async () => {
    mocks.fetch.mockImplementation(async (_url: string, init?: {
      method?: string
      body?: { service: string, enabled: boolean }
    }) => {
      if (init?.method === 'PUT') {
        return { drive: true, gmail: init.body!.enabled, calendar: false }
      }

      return { drive: true, gmail: false, calendar: false }
    })

    const { composable } = await mountComposable(SLUG)

    expect(mocks.fetch)
      .toHaveBeenCalledWith(`/api/v1/chats/${SLUG}/google-tools`)
    expect(composable.servicesOff.value).toEqual(['gmail', 'calendar'])

    await composable.toggle('gmail')

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      `/api/v1/chats/${SLUG}/google-tools`,
      { method: 'PUT', body: { service: 'gmail', enabled: true } },
    )
    expect(composable.servicesOff.value).toEqual(['calendar'])
    expect(useGoogleToolsSelection().selection.value.shouldSend).toBe(false)
  })

  it('does not read the stored switches without the feature', async () => {
    activeFlags.value = new Set()

    await mountComposable(SLUG)

    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rolls back and reports a failed save', async () => {
    mocks.fetch.mockResolvedValueOnce({
      drive: true,
      gmail: true,
      calendar: true,
    })

    const { composable } = await mountComposable(SLUG)

    mocks.fetch.mockRejectedValueOnce(new Error('Nope'))

    await composable.toggle('calendar')

    expect(composable.servicesOff.value).toEqual([])
    expect(mocks.errorMessage).toHaveBeenCalled()
    expect(composable.savingServices.value).toEqual([])
  })

  it('ignores a second toggle of a service while its save is running',
    async () => {
      mocks.fetch.mockResolvedValueOnce(allOn())

      const { composable } = await mountComposable(SLUG)
      const puts = deferPuts()

      const first = composable.toggle('gmail')

      await flushPromises()
      await composable.toggle('gmail')

      expect(composable.savingServices.value).toEqual(['gmail'])
      expect(putCalls()).toHaveLength(1)

      puts.resolve('gmail', { drive: true, gmail: false, calendar: true })
      await first

      expect(composable.servicesOff.value).toEqual(['gmail'])
      expect(composable.savingServices.value).toEqual([])
    })

  it('saves another service while one save is running and keeps both '
    + 'choices when the answers arrive out of order', async () => {
    mocks.fetch.mockResolvedValueOnce(allOn())

    const { composable } = await mountComposable(SLUG)
    const puts = deferPuts()

    const driveSave = composable.toggle('drive')
    const gmailSave = composable.toggle('gmail')

    await flushPromises()

    expect(putCalls()).toHaveLength(2)
    expect(composable.savingServices.value).toEqual(['drive', 'gmail'])

    puts.resolve('drive', { drive: false, gmail: true, calendar: true })
    await driveSave

    expect(composable.servicesOff.value).toEqual(['drive', 'gmail'])

    puts.resolve('gmail', { drive: false, gmail: false, calendar: true })
    await gmailSave

    expect(composable.servicesOff.value).toEqual(['drive', 'gmail'])
  })

  it('rolls back only the service whose save failed', async () => {
    mocks.fetch.mockResolvedValueOnce(allOn())

    const { composable } = await mountComposable(SLUG)
    const puts = deferPuts()

    const driveSave = composable.toggle('drive')
    const gmailSave = composable.toggle('gmail')

    await flushPromises()
    puts.reject('drive', new Error('Nope'))
    await driveSave

    expect(composable.servicesOff.value).toEqual(['gmail'])

    puts.resolve('gmail', { drive: true, gmail: false, calendar: true })
    await gmailSave

    expect(composable.servicesOff.value).toEqual(['gmail'])
  })

  describe('spacing saves of one service', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('queues a second save of the same service until 1.1 s after the '
      + 'first, and never drops it', async () => {
      mocks.fetch.mockResolvedValueOnce(allOn())

      const { composable } = await mountComposable(SLUG)

      mocks.fetch.mockImplementation(async (_url: string, init?: {
        body?: { service: string, enabled: boolean }
      }) => {
        return { ...allOn(), gmail: init!.body!.enabled }
      })
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })

      await composable.toggle('gmail')
      expect(putCalls()).toHaveLength(1)

      const second = composable.toggle('gmail')

      await vi.advanceTimersByTimeAsync(0)

      expect(putCalls()).toHaveLength(1)
      expect(composable.savingServices.value).toEqual(['gmail'])

      await vi.advanceTimersByTimeAsync(1099)

      expect(putCalls()).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(1)
      await second

      expect(putCalls()).toHaveLength(2)
      expect(composable.servicesOff.value).toEqual([])
    })

    it('does not delay a save of a different service', async () => {
      mocks.fetch.mockResolvedValueOnce(allOn())

      const { composable } = await mountComposable(SLUG)

      mocks.fetch.mockImplementation(async () => allOn())
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })

      await composable.toggle('gmail')
      await composable.toggle('drive')

      expect(putCalls()).toHaveLength(2)
    })
  })

  describe('while the stored choice is not known', () => {
    it('is loading, ignores toggles and then becomes ready', async () => {
      let finishLoad: (value: unknown) => void = () => undefined

      mocks.fetch.mockReturnValueOnce(new Promise((resolve) => {
        finishLoad = resolve
      }))

      const { composable } = await mountComposable(SLUG)

      expect(composable.choiceState.value).toBe('loading')

      await composable.toggle('gmail')

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(composable.servicesOff.value).toEqual([])

      finishLoad({ drive: true, gmail: false, calendar: true })
      await flushPromises()

      expect(composable.choiceState.value).toBe('ready')
      expect(composable.servicesOff.value).toEqual(['gmail'])
    })

    it('shows an error after a failed read, keeps ignoring toggles and '
      + 'recovers on retry', async () => {
      mocks.fetch.mockRejectedValueOnce(new Error('Offline'))

      const { composable } = await mountComposable(SLUG)

      expect(composable.choiceState.value).toBe('error')

      await composable.toggle('gmail')

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(composable.servicesOff.value).toEqual([])

      mocks.fetch.mockResolvedValueOnce({
        drive: true,
        gmail: false,
        calendar: true,
      })
      composable.retry()
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      expect(composable.choiceState.value).toBe('ready')
      expect(composable.servicesOff.value).toEqual(['gmail'])
    })

    it('goes back to loading while a retry runs', async () => {
      mocks.fetch.mockRejectedValueOnce(new Error('Offline'))

      const { composable } = await mountComposable(SLUG)

      mocks.fetch.mockReturnValueOnce(new Promise(() => undefined))
      composable.retry()

      expect(composable.choiceState.value).toBe('loading')
    })

    it('is ready at once for a new chat', async () => {
      const { composable } = await mountComposable()

      expect(composable.choiceState.value).toBe('ready')
    })

    it('ignores the answer of a chat the composer has left', async () => {
      const otherSlug = '01HZXCCCCCCCCCCCCCCCCCCCCC'
      let finishFirst: (value: unknown) => void = () => undefined

      mocks.fetch.mockReturnValueOnce(new Promise((resolve) => {
        finishFirst = resolve
      }))

      const { composable, slug } = await mountComposable(SLUG)

      mocks.fetch.mockResolvedValueOnce({
        drive: false,
        gmail: true,
        calendar: true,
      })
      slug.value = otherSlug
      await flushPromises()

      expect(composable.servicesOff.value).toEqual(['drive'])

      finishFirst({ drive: true, gmail: false, calendar: false })
      await flushPromises()

      expect(composable.servicesOff.value).toEqual(['drive'])
      expect(composable.choiceState.value).toBe('ready')
    })

    it('keeps the latest connection status when answers arrive out of '
      + 'order', async () => {
      let finishFirst: (value: unknown) => void = () => undefined

      mocks.fetch.mockReturnValueOnce(new Promise((resolve) => {
        finishFirst = resolve
      }))
      mocks.fetch.mockResolvedValueOnce(status())

      const { composable } = await mountComposable()
      const first = composable.refresh()

      await composable.refresh()

      expect(composable.rows.value[0]?.kind).toBe('switch')

      finishFirst(status({ connection: null }))
      await first

      expect(composable.rows.value[0]?.kind).toBe('switch')
    })
  })

  describe('the announcement', () => {
    it('says the final state after a save', async () => {
      mocks.fetch.mockResolvedValueOnce(allOn())

      const { composable } = await mountComposable(SLUG)

      mocks.fetch.mockResolvedValueOnce({
        drive: true,
        gmail: false,
        calendar: true,
      })
      await composable.toggle('gmail')

      expect(composable.announcement.value)
        .toBe('Gmail is now off in this chat')
    })

    it('says it is back and that saving failed after a rollback',
      async () => {
        mocks.fetch.mockResolvedValueOnce(allOn())

        const { composable } = await mountComposable(SLUG)

        mocks.fetch.mockRejectedValueOnce(new Error('Nope'))
        await composable.toggle('gmail')

        expect(composable.announcement.value)
          .toBe('Gmail is back on in this chat. Saving failed.')
      })

    it('says it is back off when turning a service on failed', async () => {
      mocks.fetch.mockResolvedValueOnce({
        drive: true,
        gmail: false,
        calendar: true,
      })

      const { composable } = await mountComposable(SLUG)

      mocks.fetch.mockRejectedValueOnce(new Error('Nope'))
      await composable.toggle('gmail')

      expect(composable.announcement.value)
        .toBe('Gmail is back off in this chat. Saving failed.')
    })

    it('clears when the connection status is refreshed', async () => {
      mocks.fetch.mockResolvedValueOnce(allOn())

      const { composable } = await mountComposable(SLUG)

      mocks.fetch.mockResolvedValueOnce(allOn())
      await composable.toggle('gmail')

      expect(composable.announcement.value).not.toBe('')

      mocks.fetch.mockResolvedValueOnce(status())
      await composable.refresh()

      expect(composable.announcement.value).toBe('')
    })
  })

  describe('the first-send field', () => {
    const handedOver: GoogleToolsSelectionState = {
      chatKey: SLUG,
      off: ['gmail'],
      isKnown: true,
      shouldSend: true,
    }

    it('is sent for a choice handed over from the new-chat page and '
      + 'not after the first send settled', () => {
      const { selection, settleFirstSend } = useGoogleToolsSelection()

      selection.value = { ...handedOver }

      expect(getGoogleServicesOffField(selection.value, true, SLUG))
        .toEqual({ googleServicesOff: ['gmail'] })

      settleFirstSend(SLUG)

      expect(getGoogleServicesOffField(selection.value, true, SLUG))
        .toEqual({})
      expect(selection.value.off).toEqual(['gmail'])
    })

    it('is absent when the feature is off, the choice is unknown or the '
      + 'chat differs', () => {
      expect(getGoogleServicesOffField(handedOver, false, SLUG)).toEqual({})
      expect(getGoogleServicesOffField(
        { ...handedOver, isKnown: false },
        true,
        SLUG,
      )).toEqual({})
      expect(getGoogleServicesOffField(handedOver, true, 'other'))
        .toEqual({})
    })

    it('is not cleared by the first send of another chat', () => {
      const { selection, settleFirstSend } = useGoogleToolsSelection()

      selection.value = { ...handedOver }
      settleFirstSend('other')

      expect(selection.value.shouldSend).toBe(true)
    })
  })

  describe('the reason a model gets no Google tool', () => {
    async function rowsFor(slug: string | null = null) {
      mocks.fetch.mockResolvedValue(status())

      const mounted = await mountComposable(slug)

      await mounted.composable.refresh()

      return mounted
    }

    it('has none for a model on the list', async () => {
      const { composable } = await rowsFor()

      expect(composable.unavailableReason.value).toBeNull()
      expect(composable.rows.value[0]?.reasonNote).toBeNull()
    })

    it('says the model may not receive Google data for a refused model',
      async () => {
        modelSelection.value = { source: 'provider', modelId: 'deepseek-flash' }

        const { composable } = await rowsFor()

        expect(composable.unavailableReason.value)
          .toBe('model_may_not_receive_google_data')
        expect(composable.rows.value[0]).toMatchObject({
          subLine: GOOGLE_ROW_UNAVAILABLE_LINE,
        })
      })

    it('lets a direct Gemini model through once the paid tier is confirmed',
      async () => {
        modelSelection.value = { source: 'provider', modelId: 'gemini-3.8-flash' }

        const { composable } = await rowsFor()

        expect(composable.unavailableReason.value)
          .toBe('model_may_not_receive_google_data')

        paidTier.value = true

        expect(composable.unavailableReason.value).toBeNull()
      })

    it('offers the keys link and a way to another model for a refused '
      + 'non-Gemini model', async () => {
      modelSelection.value = { source: 'provider', modelId: 'deepseek-flash' }

      const { composable } = await rowsFor()

      expect(composable.rows.value[0]?.reasonActions).toEqual([
        {
          kind: 'open-api-keys',
          label: 'Open API Keys',
          path: '/profile/keys?provider=google',
        },
        { kind: 'choose-model', label: 'Choose another model' },
      ])
    })

    it('offers the inline paid-tier confirmation for Gemini with a saved '
      + 'key and drops every action once it is confirmed', async () => {
      modelSelection.value = { source: 'provider', modelId: 'gemini-3.8-flash' }

      const { composable } = await rowsFor()

      expect(composable.rows.value[0]?.reasonActions.map((action) => {
        return action.kind
      })).toEqual(['open-api-keys', 'confirm-paid-tier'])

      paidTier.value = true

      expect(composable.rows.value[0]?.reasonActions).toEqual([])
    })

    it('leaves out the inline confirmation for Gemini without a saved key',
      async () => {
        modelSelection.value = {
          source: 'provider',
          modelId: 'gemini-3.8-flash',
        }
        hasGeminiKey.value = false

        const { composable } = await rowsFor()

        expect(composable.rows.value[0]?.reasonActions.map((action) => {
          return action.kind
        })).toEqual(['open-api-keys'])
      })

    it('has no action for a provider tool that cannot be removed',
      async () => {
        const { composable, tools } = await rowsFor()

        tools.value = ['web_search']

        expect(composable.rows.value[0]?.reasonNote).not.toBeNull()
        expect(composable.rows.value[0]?.reasonActions).toEqual([])
      })

    it('says a provider tool stays callable for Anthropic web search or '
      + 'Run code in a chat without Google data', async () => {
      const { composable, tools } = await rowsFor()

      tools.value = ['web_search']

      expect(composable.unavailableReason.value)
        .toBe('provider_tool_not_removable')

      tools.value = ['code_execution']

      expect(composable.unavailableReason.value)
        .toBe('provider_tool_not_removable')

      tools.value = ['web_search_brave']

      expect(composable.unavailableReason.value).toBeNull()
    })

    it('lets Anthropic web search through once the chat holds Google data',
      async () => {
        const { composable, tools } = await rowsFor(SLUG)

        tools.value = ['web_search']
        holdsBySlug.value = { [SLUG]: true }

        expect(composable.unavailableReason.value).toBeNull()
      })

    it('says a provider tool stays callable for Qwen search only',
      async () => {
        modelSelection.value = { source: 'provider', modelId: 'qwen3.7-plus' }

        const { composable, tools } = await rowsFor()

        tools.value = ['code_execution']

        expect(composable.unavailableReason.value).toBeNull()

        tools.value = ['web_search']

        expect(composable.unavailableReason.value)
          .toBe('provider_tool_not_removable')
      })

    it('says a gateway chat needs a Google file first, and lifts it once '
      + 'the chat holds Google data', async () => {
      modelSelection.value = {
        source: 'gateway',
        gatewayId: 'vercel',
        modelId: 'anthropic/claude-sonnet-4.5',
      }

      const { composable } = await rowsFor(SLUG)

      expect(composable.unavailableReason.value)
        .toBe('gateway_needs_google_data')
      expect(composable.rows.value[0]?.reasonNote?.detail)
        .toContain('Attach a Drive file first')

      holdsBySlug.value = { [SLUG]: true }

      expect(composable.unavailableReason.value).toBeNull()
    })

    it('has no reason note for a model without tool calling', async () => {
      const { composable, toolCalling } = await rowsFor()

      toolCalling.value = false

      expect(composable.unavailableReason.value).toBe('tool_calling_off')
      expect(composable.rows.value[0]?.reasonNote).toBeNull()
    })
  })
})

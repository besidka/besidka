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
  useComposerGoogleTools,
  useGoogleToolsSelection,
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
  return () => ({ isGeminiPaidTierConfirmed: computed(() => paidTier.value) })
})

const SLUG = '01HZXBBBBBBBBBBBBBBBBBBBBB'

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
    mocks.fetch.mockReset()
    mocks.errorMessage.mockReset()
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
    expect(composable.isSaving.value).toBe(false)
  })

  it('ignores a second toggle while one is saving', async () => {
    mocks.fetch.mockResolvedValueOnce({
      drive: true,
      gmail: true,
      calendar: true,
    })

    const { composable } = await mountComposable(SLUG)
    let finish: (value: unknown) => void = () => undefined

    mocks.fetch.mockReturnValueOnce(new Promise((resolve) => {
      finish = resolve
    }))

    const first = composable.toggle('gmail')

    await composable.toggle('drive')

    expect(mocks.fetch).toHaveBeenCalledTimes(2)

    finish({ drive: true, gmail: false, calendar: true })
    await first
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

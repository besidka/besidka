import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, ref } from 'vue'
import {
  NEW_CHAT_CONNECTORS_KEY,
  getConnectorEnableBlock,
  planTurnAllOn,
  useChatConnectorSelection,
  useComposerConnectors,
  useConnectorTitles,
} from '../../../app/composables/composer-connectors'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  fetch: vi.fn(),
  errorMessage: vi.fn(),
}))

const connectorsActive = ref<boolean>(true)
const data = ref<unknown>(null)

mockNuxtImport('useFeature', () => {
  return () => computed(() => ({
    enabled: connectorsActive.value,
    active: connectorsActive.value,
    variant: null,
  }))
})
mockNuxtImport('useLazyFetch', () => {
  return () => ({ data, execute: mocks.execute })
})
mockNuxtImport('useNuxtData', () => {
  return () => ({ data })
})
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)

function createConnector(
  overrides: Partial<{
    id: string
    slug: string
    title: string
    host: string
    status: string
    enabled: boolean
    toolMode: string
    consent: { state: string }
    tools: { isBaselined: boolean }
  }> = {},
) {
  return {
    id: 'c1',
    slug: 'notion',
    title: 'Notion',
    host: 'mcp.notion.com',
    status: 'ready',
    enabled: true,
    toolMode: 'manual',
    authType: 'oauth',
    createdVia: 'preset',
    presetId: 'notion',
    consent: { state: 'current' },
    tools: { isBaselined: true },
    updatedAt: '2026-11-14T00:00:00.000Z',
    ...overrides,
  }
}

async function mountComposable(chatSlug: string | null = null) {
  const slug = ref<string | null>(chatSlug)
  let result: ReturnType<typeof useComposerConnectors> | null = null

  await mountSuspended(defineComponent({
    setup() {
      result = useComposerConnectors(() => slug.value)

      return () => null
    },
  }))

  return { composable: result!, slug }
}

function resetSelection() {
  useChatConnectorSelection().selection.value = {
    chatKey: NEW_CHAT_CONNECTORS_KEY,
    ids: [],
    offIds: [],
    isKnown: true,
  }
}

describe('useComposerConnectors', () => {
  beforeEach(() => {
    connectorsActive.value = true
    data.value = null
    mocks.execute.mockReset()
    mocks.fetch.mockReset()
    mocks.errorMessage.mockReset()
    resetSelection()
  })

  it('fetches the connector list only while the connectors flag is on', async () => {
    connectorsActive.value = false

    await mountComposable()

    expect(mocks.execute).not.toHaveBeenCalled()

    connectorsActive.value = true
    await flushPromises()

    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('does not fetch again when the list is already loaded', async () => {
    data.value = { connectors: [] }

    await mountComposable()

    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('lists only enabled, ready or drifted connectors, by title', async () => {
    data.value = {
      connectors: [
        createConnector({ id: 'z', slug: 'zeta', title: 'Zeta' }),
        createConnector({
          id: 'd',
          slug: 'drift',
          title: 'Drift',
          status: 'drifted',
        }),
        createConnector({ id: 'o', slug: 'off', title: 'Off', enabled: false }),
        createConnector({
          id: 'n',
          slug: 'needs',
          title: 'Needs',
          status: 'needs-auth',
        }),
        createConnector({ id: 'e', slug: 'err', title: 'Err', status: 'error' }),
      ],
    }

    const { composable } = await mountComposable()

    expect(composable.items.value.map(item => item.id)).toEqual(['d', 'z'])
    expect(composable.items.value[0]).toEqual({
      id: 'd',
      slug: 'drift',
      title: 'Drift',
      host: 'mcp.notion.com',
      status: 'drifted',
      toolMode: 'manual',
      presetId: 'notion',
      isIconAvailable: true,
    })
    expect(composable.isVisible.value).toBe(true)
  })

  it('stays visible with nothing selectable and hides only when the flag is off', async () => {
    data.value = { connectors: [createConnector({ enabled: false })] }

    const { composable } = await mountComposable()

    expect(composable.items.value).toEqual([])
    expect(composable.isVisible.value).toBe(true)

    data.value = { connectors: [] }

    expect(composable.isVisible.value).toBe(true)

    data.value = { connectors: [createConnector()] }
    connectorsActive.value = false

    expect(composable.items.value).toEqual([])
    expect(composable.isVisible.value).toBe(false)
  })

  it('keeps the choice in client state on a new chat without calling the server', async () => {
    data.value = { connectors: [createConnector()] }

    const { composable } = await mountComposable()

    await composable.toggle('c1')

    expect(composable.selectedIds.value).toEqual(['c1'])
    expect(mocks.fetch).not.toHaveBeenCalled()

    await composable.toggle('c1')

    expect(composable.selectedIds.value).toEqual([])
  })

  it('reads the stored choice of an existing chat once connectors exist', async () => {
    data.value = { connectors: [createConnector()] }
    mocks.fetch.mockResolvedValueOnce({ connectorIds: ['c1'] })

    const { composable } = await mountComposable('chat-slug')

    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/chats/chat-slug/connectors')
    expect(composable.selectedIds.value).toEqual(['c1'])
    expect(useChatConnectorSelection().selection.value.isKnown).toBe(true)
  })

  it('filters a stored choice against the selectable connectors', async () => {
    data.value = {
      connectors: [
        createConnector(),
        createConnector({ id: 'c2', slug: 'linear', title: 'Linear' }),
        createConnector({ id: 'c3', slug: 'off', title: 'Off', enabled: false }),
      ],
    }
    mocks.fetch
      .mockResolvedValueOnce({ connectorIds: ['c3', 'gone', 'c1'] })
      .mockResolvedValueOnce({ connectorIds: ['c1', 'c2'] })

    const { composable } = await mountComposable('chat-slug')

    await flushPromises()

    expect(composable.selectedIds.value).toEqual(['c1'])

    await composable.toggle('c2')

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/chats/chat-slug/connectors',
      { method: 'PUT', body: { connectorIds: ['c1', 'c2'], offConnectorIds: [] } },
    )
    expect(composable.selectedIds.value).toEqual(['c1', 'c2'])
  })

  it('does not read the stored choice when the user has no connectors', async () => {
    data.value = { connectors: [] }

    await mountComposable('chat-slug')
    await flushPromises()

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(useChatConnectorSelection().selection.value.isKnown).toBe(false)
  })

  it('leaves the choice unknown when reading it fails', async () => {
    data.value = { connectors: [createConnector()] }
    mocks.fetch.mockRejectedValueOnce(new Error('boom'))

    const { composable } = await mountComposable('chat-slug')

    await flushPromises()

    expect(composable.selectedIds.value).toEqual([])
    expect(useChatConnectorSelection().selection.value.isKnown).toBe(false)
  })

  it('keeps a choice handed over from the new chat page without reading it again', async () => {
    data.value = { connectors: [createConnector()] }

    const selection = useChatConnectorSelection()

    selection.selection.value = {
      chatKey: NEW_CHAT_CONNECTORS_KEY,
      ids: ['c1'],
      offIds: [],
      isKnown: true,
    }
    selection.handOff('chat-slug')

    const { composable } = await mountComposable('chat-slug')

    await flushPromises()

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(composable.selectedIds.value).toEqual(['c1'])
  })

  it('hands nothing over when no connector is selected', () => {
    const selection = useChatConnectorSelection()

    selection.handOff('chat-slug')

    expect(selection.selection.value.chatKey).toBe(NEW_CHAT_CONNECTORS_KEY)
  })

  it('persists a toggle on an existing chat with the full set', async () => {
    data.value = {
      connectors: [
        createConnector(),
        createConnector({ id: 'c2', slug: 'linear', title: 'Linear' }),
      ],
    }
    mocks.fetch
      .mockResolvedValueOnce({ connectorIds: ['c1'] })
      .mockResolvedValueOnce({ connectorIds: ['c1', 'c2'] })

    const { composable } = await mountComposable('chat-slug')

    await flushPromises()
    await composable.toggle('c2')

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/chats/chat-slug/connectors',
      { method: 'PUT', body: { connectorIds: ['c1', 'c2'], offConnectorIds: [] } },
    )
    expect(composable.selectedIds.value).toEqual(['c1', 'c2'])
  })

  it('rolls a toggle back and shows the error when saving fails', async () => {
    data.value = { connectors: [createConnector()] }
    mocks.fetch
      .mockResolvedValueOnce({ connectorIds: [] })
      .mockRejectedValueOnce({
        data: {
          message: 'Too many connectors for one chat',
          why: 'A chat can use at most 5 connectors at a time',
        },
      })

    const { composable } = await mountComposable('chat-slug')

    await flushPromises()
    await composable.toggle('c1')

    expect(composable.selectedIds.value).toEqual([])
    expect(mocks.errorMessage).toHaveBeenCalledTimes(1)
    expect(composable.isSaving.value).toBe(false)
  })

  it('refuses a sixth connector and reports the limit', async () => {
    data.value = {
      connectors: Array.from({ length: 6 }, (_, index) => {
        return createConnector({
          id: `c${index}`,
          slug: `slug${index}`,
          title: `Connector ${index}`,
        })
      }),
    }

    const { composable } = await mountComposable()

    for (const index of [0, 1, 2, 3, 4]) {
      await composable.toggle(`c${index}`)
    }

    expect(composable.isAtLimit.value).toBe(true)

    await composable.toggle('c5')

    expect(composable.selectedIds.value).toHaveLength(5)
    expect(composable.selectedIds.value).not.toContain('c5')

    await composable.toggle('c0')

    expect(composable.selectedIds.value).toHaveLength(4)
    expect(composable.isAtLimit.value).toBe(false)
  })

  it('drops selected ids whose connector is no longer selectable', async () => {
    data.value = {
      connectors: [
        createConnector(),
        createConnector({ id: 'c2', slug: 'linear', title: 'Linear' }),
      ],
    }

    const { composable } = await mountComposable()

    await composable.toggle('c1')
    await composable.toggle('c2')

    data.value = {
      connectors: [
        createConnector({ enabled: false }),
        createConnector({ id: 'c2', slug: 'linear', title: 'Linear' }),
      ],
    }
    await flushPromises()

    expect(composable.selectedIds.value).toEqual(['c2'])
  })

  it('turns every connector off in one call', async () => {
    data.value = { connectors: [createConnector()] }
    mocks.fetch
      .mockResolvedValueOnce({ connectorIds: ['c1'] })
      .mockResolvedValueOnce({ connectorIds: [] })

    const { composable } = await mountComposable('chat-slug')

    await flushPromises()
    await composable.clear()

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/chats/chat-slug/connectors',
      { method: 'PUT', body: { connectorIds: [], offConnectorIds: [] } },
    )
    expect(composable.selectedIds.value).toEqual([])
  })

  it('turns the given connectors on in one call, capped at five', async () => {
    data.value = {
      connectors: Array.from({ length: 7 }, (_, index) => {
        return createConnector({
          id: `c${index}`,
          slug: `slug${index}`,
          title: `Connector ${index}`,
        })
      }),
    }
    mocks.fetch
      .mockResolvedValueOnce({ connectorIds: [] })
      .mockImplementationOnce(async (_url: string, options: {
        body: { connectorIds: string[] }
      }) => ({ connectorIds: options.body.connectorIds }))

    const { composable } = await mountComposable('chat-slug')

    await flushPromises()
    await composable.setAll([
      'c0',
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
      'unknown',
    ])

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/chats/chat-slug/connectors',
      {
        method: 'PUT',
        body: { connectorIds: ['c0', 'c1', 'c2', 'c3', 'c4'], offConnectorIds: [] },
      },
    )
    expect(composable.selectedIds.value)
      .toEqual(['c0', 'c1', 'c2', 'c3', 'c4'])
  })

  it('starts from nothing when the chat changes', async () => {
    data.value = { connectors: [createConnector()] }
    mocks.fetch.mockResolvedValue({ connectorIds: ['c1'] })

    const { composable, slug } = await mountComposable('chat-a')

    await flushPromises()

    expect(composable.selectedIds.value).toEqual(['c1'])

    mocks.fetch.mockResolvedValue({ connectorIds: [] })
    slug.value = 'chat-b'
    await flushPromises()

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/chats/chat-b/connectors',
    )
    expect(composable.selectedIds.value).toEqual([])
  })
})

describe('useComposerConnectors modes', () => {
  beforeEach(() => {
    connectorsActive.value = true
    data.value = null
    mocks.execute.mockReset()
    mocks.fetch.mockReset()
    mocks.errorMessage.mockReset()
    resetSelection()
  })

  function createModeConnectors() {
    return [
      createConnector({ id: 'm1', slug: 'manual-one', title: 'Manual One' }),
      createConnector({
        id: 'a1',
        slug: 'auto-one',
        title: 'Auto One',
        toolMode: 'auto',
      }),
      createConnector({
        id: 'o1',
        slug: 'always-one',
        title: 'Always One',
        toolMode: 'always-on',
      }),
    ]
  }

  it('makes an Auto and an Always on connector available without a toggle', async () => {
    data.value = { connectors: createModeConnectors() }

    const { composable } = await mountComposable()

    expect(composable.availableIds.value).toEqual(['o1', 'a1'])
    expect(composable.selectedIds.value).toEqual([])
    expect(composable.offIds.value).toEqual([])
  })

  it('adds a Manual connector to the available ones only once it is on', async () => {
    data.value = { connectors: createModeConnectors() }

    const { composable } = await mountComposable()

    await composable.toggle('m1')

    expect(composable.selectedIds.value).toEqual(['m1'])
    expect(composable.availableIds.value).toEqual(['o1', 'a1', 'm1'])
  })

  it('switches an Auto connector off for the chat and saves both lists', async () => {
    data.value = { connectors: createModeConnectors() }
    mocks.fetch
      .mockResolvedValueOnce({ connectorIds: [], offConnectorIds: [] })
      .mockResolvedValueOnce({ connectorIds: [], offConnectorIds: ['a1'] })

    const { composable } = await mountComposable('chat-slug')

    await flushPromises()
    await composable.toggle('a1')

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/chats/chat-slug/connectors',
      { method: 'PUT', body: { connectorIds: [], offConnectorIds: ['a1'] } },
    )
    expect(composable.offIds.value).toEqual(['a1'])
    expect(composable.availableIds.value).toEqual(['o1'])
    expect(composable.selectedIds.value).toEqual([])
  })

  it('switches an Auto connector back on by clearing its off', async () => {
    data.value = { connectors: createModeConnectors() }
    mocks.fetch
      .mockResolvedValueOnce({ connectorIds: [], offConnectorIds: ['a1'] })
      .mockResolvedValueOnce({ connectorIds: [], offConnectorIds: [] })

    const { composable } = await mountComposable('chat-slug')

    await flushPromises()

    expect(composable.availableIds.value).toEqual(['o1'])

    await composable.toggle('a1')

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/chats/chat-slug/connectors',
      { method: 'PUT', body: { connectorIds: [], offConnectorIds: [] } },
    )
    expect(composable.availableIds.value).toEqual(['o1', 'a1'])
  })

  it('keeps the off list on a new chat in client state only', async () => {
    data.value = { connectors: createModeConnectors() }

    const { composable } = await mountComposable()

    await composable.toggle('o1')

    expect(composable.offIds.value).toEqual(['o1'])
    expect(composable.availableIds.value).toEqual(['a1'])
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rolls an off back when saving fails', async () => {
    data.value = { connectors: createModeConnectors() }
    mocks.fetch
      .mockResolvedValueOnce({ connectorIds: [], offConnectorIds: [] })
      .mockRejectedValueOnce({ data: { message: 'nope' } })

    const { composable } = await mountComposable('chat-slug')

    await flushPromises()
    await composable.toggle('a1')

    expect(composable.offIds.value).toEqual([])
    expect(mocks.errorMessage).toHaveBeenCalledTimes(1)
  })

  it('counts Always on connectors against the cap that only blocks Manual ones', async () => {
    data.value = {
      connectors: [
        ...Array.from({ length: 4 }, (_, index) => {
          return createConnector({
            id: `m${index}`,
            slug: `manual${index}`,
            title: `Manual ${index}`,
          })
        }),
        createConnector({
          id: 'o1',
          slug: 'always-one',
          title: 'Always One',
          toolMode: 'always-on',
        }),
        createConnector({
          id: 'a1',
          slug: 'auto-one',
          title: 'Auto One',
          toolMode: 'auto',
        }),
      ],
    }

    const { composable } = await mountComposable()

    expect(composable.manualCapacity.value).toBe(4)

    for (const index of [0, 1, 2, 3]) {
      await composable.toggle(`m${index}`)
    }

    expect(composable.isAtLimit.value).toBe(true)

    await composable.toggle('a1')

    expect(composable.offIds.value).toEqual(['a1'])

    await composable.toggle('o1')

    expect(composable.offIds.value).toEqual(['a1', 'o1'])
    expect(composable.isAtLimit.value).toBe(false)
  })

  it('turns all on and off for Manual connectors only and leaves offs alone', async () => {
    data.value = { connectors: createModeConnectors() }
    mocks.fetch
      .mockResolvedValueOnce({ connectorIds: [], offConnectorIds: ['a1'] })
      .mockImplementation(async (_url: string, options: {
        body: { connectorIds: string[], offConnectorIds: string[] }
      }) => ({
        connectorIds: options.body.connectorIds,
        offConnectorIds: options.body.offConnectorIds,
      }))

    const { composable } = await mountComposable('chat-slug')

    await flushPromises()
    await composable.setAll(['m1', 'a1', 'o1'])

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/chats/chat-slug/connectors',
      { method: 'PUT', body: { connectorIds: ['m1'], offConnectorIds: ['a1'] } },
    )

    await composable.clear()

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/chats/chat-slug/connectors',
      { method: 'PUT', body: { connectorIds: [], offConnectorIds: ['a1'] } },
    )
  })

  it('drops off ids whose connector is gone', async () => {
    data.value = { connectors: createModeConnectors() }
    mocks.fetch.mockResolvedValueOnce({
      connectorIds: [],
      offConnectorIds: ['a1', 'gone'],
    })

    const { composable } = await mountComposable('chat-slug')

    await flushPromises()

    expect(composable.offIds.value).toEqual(['a1'])
  })

  it('hands an off over from the new chat page', async () => {
    data.value = { connectors: createModeConnectors() }

    const selection = useChatConnectorSelection()

    selection.selection.value = {
      chatKey: NEW_CHAT_CONNECTORS_KEY,
      ids: [],
      offIds: ['a1'],
      isKnown: true,
    }
    selection.handOff('chat-slug')

    const { composable } = await mountComposable('chat-slug')

    await flushPromises()

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(composable.offIds.value).toEqual(['a1'])
  })
})

describe('useConnectorTitles', () => {
  beforeEach(() => {
    data.value = null
  })

  it('maps slugs to titles from the cached list and has no entry for a deleted connector', async () => {
    data.value = {
      connectors: [createConnector({ slug: 'notion', title: 'Notion' })],
    }

    let titles: Map<string, string> | null = null

    await mountSuspended(defineComponent({
      setup() {
        titles = useConnectorTitles().titlesBySlug.value

        return () => null
      },
    }))

    expect(titles!.get('notion')).toBe('Notion')
    expect(titles!.get('gone')).toBeUndefined()
  })

  it('maps slugs to ids and titles for the connector icon route', async () => {
    data.value = {
      connectors: [createConnector({
        id: 'conn-1',
        slug: 'notion',
        title: 'Notion',
      })],
    }

    let connectorsBySlug: Map<string, { id: string, title: string }> | null
      = null

    await mountSuspended(defineComponent({
      setup() {
        connectorsBySlug = useConnectorTitles().connectorsBySlug.value

        return () => null
      },
    }))

    expect(connectorsBySlug!.get('notion')).toEqual({
      id: 'conn-1',
      title: 'Notion',
    })
    expect(connectorsBySlug!.get('gone')).toBeUndefined()
  })
})

describe('planTurnAllOn', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']

  it('turns every connector on when they fit', () => {
    expect(planTurnAllOn(['a', 'b', 'c'], [])).toEqual({
      ids: ['a', 'b', 'c'],
      skippedCount: 0,
    })
  })

  it('turns on the first five in list order and counts the rest', () => {
    expect(planTurnAllOn(ids, [])).toEqual({
      ids: ['a', 'b', 'c', 'd', 'e'],
      skippedCount: 2,
    })
  })

  it('keeps the connectors already on and fills up to the cap', () => {
    expect(planTurnAllOn(ids, ['f', 'b'])).toEqual({
      ids: ['f', 'b', 'a', 'c', 'd'],
      skippedCount: 2,
    })
  })

  it('drops selected ids that are not in the list', () => {
    expect(planTurnAllOn(['a', 'b'], ['gone', 'b'])).toEqual({
      ids: ['b', 'a'],
      skippedCount: 0,
    })
  })
})

describe('connectors that are off in the Connectors page', () => {
  beforeEach(() => {
    connectorsActive.value = true
    data.value = null
    mocks.execute.mockReset()
    mocks.fetch.mockReset()
    mocks.errorMessage.mockReset()
    resetSelection()
  })

  it('lists connected connectors with Use in chats off apart from items',
    async () => {
      data.value = {
        connectors: [
          createConnector({ id: 'on', slug: 'on', title: 'On' }),
          createConnector({
            id: 'gmail',
            slug: 'gmail',
            title: 'Gmail',
            enabled: false,
          }),
          createConnector({
            id: 'drift',
            slug: 'drift',
            title: 'Drift',
            enabled: false,
            status: 'drifted',
          }),
          createConnector({
            id: 'auth',
            slug: 'auth',
            title: 'Auth',
            enabled: false,
            status: 'needs-auth',
          }),
          createConnector({
            id: 'err',
            slug: 'err',
            title: 'Err',
            enabled: false,
            status: 'error',
          }),
        ],
      }

      const { composable } = await mountComposable()

      expect(composable.items.value.map(item => item.id)).toEqual(['on'])
      expect(composable.disabledItems.value.map(item => item.id))
        .toEqual(['drift', 'gmail'])
      expect(composable.disabledItems.value.map(item => item.block))
        .toEqual(['review', null])
    })

  it('maps every reason a connector cannot be turned on here', () => {
    const ready = {
      status: 'ready',
      consent: { state: 'current' },
      tools: { isBaselined: true },
    }

    expect(getConnectorEnableBlock(ready)).toBeNull()
    expect(getConnectorEnableBlock({ ...ready, status: 'drifted' }))
      .toBe('review')
    expect(getConnectorEnableBlock({
      ...ready,
      tools: { isBaselined: false },
    })).toBe('review')
    expect(getConnectorEnableBlock({
      ...ready,
      consent: { state: 'outdated' },
    })).toBe('connect')
    expect(getConnectorEnableBlock({ ...ready, status: 'needs-auth' }))
      .toBe('connect')
  })

  it('turns the connector on, reloads the list, then selects a manual '
    + 'connector for the chat', async () => {
    data.value = {
      connectors: [
        createConnector({ id: 'gmail', slug: 'gmail', enabled: false }),
      ],
    }
    mocks.execute.mockImplementation(async () => {
      data.value = {
        connectors: [createConnector({ id: 'gmail', slug: 'gmail' })],
      }
    })
    mocks.fetch.mockResolvedValue({ connectorIds: ['gmail'] })

    const { composable } = await mountComposable()

    await composable.enable('gmail')

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/connectors/gmail', {
      method: 'PATCH',
      body: { enabled: true },
    })
    expect(mocks.execute).toHaveBeenCalled()
    expect(composable.items.value.map(item => item.id)).toEqual(['gmail'])
    expect(composable.selectedIds.value).toEqual(['gmail'])
    expect(composable.isSaving.value).toBe(false)
  })

  it('does not select an auto connector, which is available once enabled',
    async () => {
      data.value = {
        connectors: [
          createConnector({
            id: 'gmail',
            slug: 'gmail',
            enabled: false,
            toolMode: 'auto',
          }),
        ],
      }
      mocks.execute.mockImplementation(async () => {
        data.value = {
          connectors: [
            createConnector({ id: 'gmail', slug: 'gmail', toolMode: 'auto' }),
          ],
        }
      })

      const { composable } = await mountComposable()

      await composable.enable('gmail')

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(composable.selectedIds.value).toEqual([])
      expect(composable.availableIds.value).toEqual(['gmail'])
    })

  it('refuses a connector whose tools still need a review, without a '
    + 'request', async () => {
    data.value = {
      connectors: [
        createConnector({
          id: 'gmail',
          slug: 'gmail',
          enabled: false,
          tools: { isBaselined: false },
        }),
      ],
    }

    const { composable } = await mountComposable()

    await composable.enable('gmail')

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(composable.selectedIds.value).toEqual([])
  })

  it('reports a refusal from the route and reloads the list', async () => {
    data.value = {
      connectors: [
        createConnector({ id: 'gmail', slug: 'gmail', enabled: false }),
      ],
    }
    mocks.fetch.mockRejectedValue(new Error('review required'))

    const { composable } = await mountComposable()

    await composable.enable('gmail')

    expect(mocks.errorMessage).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalled()
    expect(composable.selectedIds.value).toEqual([])
    expect(composable.isSaving.value).toBe(false)
  })
})

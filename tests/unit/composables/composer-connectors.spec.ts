import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, ref } from 'vue'
import {
  NEW_CHAT_CONNECTORS_KEY,
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
  }> = {},
) {
  return {
    id: 'c1',
    slug: 'notion',
    title: 'Notion',
    host: 'mcp.notion.com',
    status: 'ready',
    enabled: true,
    authType: 'oauth',
    createdVia: 'preset',
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
      { method: 'PUT', body: { connectorIds: ['c1', 'c2'] } },
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
      { method: 'PUT', body: { connectorIds: ['c1', 'c2'] } },
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
      { method: 'PUT', body: { connectorIds: [] } },
    )
    expect(composable.selectedIds.value).toEqual([])
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

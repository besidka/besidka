import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import {
  FEATURED_CONNECTOR_TIP,
  isDirectoryPresetItem,
  useConnectorDirectoryActions,
} from '../../../app/composables/connector-directory'
import { hasConnectorIcon } from '../../../app/composables/connectors'
import {
  createConnectorItem,
  createDirectoryItem,
} from '../../setup/helpers/connectors-ui'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refreshConnectors: vi.fn(),
  connectOpen: vi.fn(),
  sidePanelOpen: vi.fn(),
  error: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('refreshConnectors', () => mocks.refreshConnectors)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('useSidePanel', () => () => ({ open: mocks.sidePanelOpen }))
mockNuxtImport('useConnectorConnect', () => () => ({
  targetId: ref(null),
  open: mocks.connectOpen,
  close: vi.fn(),
}))

describe('connector directory composable', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset()
    }
    mocks.fetch.mockResolvedValue({ connector: { id: 'conn7' } })
    mocks.refreshConnectors.mockResolvedValue(undefined)
  })

  it('adds a registry entry by its directory id and opens Connect', async () => {
    const actions = useConnectorDirectoryActions()

    expect(await actions.add(createDirectoryItem())).toBe('conn7')
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/connectors', {
      method: 'POST',
      body: { registryId: 'io.example/tracker@1.0.0' },
    })
    expect(mocks.connectOpen).toHaveBeenCalledWith('conn7')
  })

  it('adds a preset entry by its preset id', async () => {
    const actions = useConnectorDirectoryActions()

    await actions.add(createDirectoryItem({
      id: 'preset:github',
      presetId: 'github',
    }))

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/connectors', {
      method: 'POST',
      body: { presetId: 'github' },
    })
  })

  it('reports a failed add and opens nothing', async () => {
    mocks.fetch.mockRejectedValue(new Error('Server did not answer'))

    const actions = useConnectorDirectoryActions()

    expect(await actions.add(createDirectoryItem())).toBeNull()
    expect(mocks.error).toHaveBeenCalled()
    expect(mocks.connectOpen).not.toHaveBeenCalled()
  })

  it('opens an entry in the side panel under its own view key', () => {
    useConnectorDirectoryActions().openEntry(createDirectoryItem())

    expect(mocks.sidePanelOpen).toHaveBeenCalledWith(expect.objectContaining({
      viewKey: 'connector-directory:io.example/tracker@1.0.0',
      title: 'Tracker',
    }))
  })

  it('tells presets apart and explains the Featured mark', () => {
    expect(isDirectoryPresetItem({ id: 'preset:github' })).toBe(true)
    expect(isDirectoryPresetItem({ id: 'com.notion/mcp@1' })).toBe(false)
    expect(FEATURED_CONNECTOR_TIP).toBe(
      'Picked by Besidka as a well-known service. Not a security review.',
    )
  })

  it('asks for a connector icon unless its consent was withdrawn', () => {
    expect(hasConnectorIcon(createConnectorItem({ status: 'needs-auth' })))
      .toBe(true)
    expect(hasConnectorIcon(createConnectorItem({
      consent: { state: 'withdrawn', version: null, issuerHost: null },
    } as never))).toBe(false)
  })
})

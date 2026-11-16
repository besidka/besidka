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
  connectOpenDraft: vi.fn(),
  sidePanelOpen: vi.fn(),
  error: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('refreshConnectors', () => mocks.refreshConnectors)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('useSidePanel', () => () => ({ open: mocks.sidePanelOpen }))
mockNuxtImport('useConnectorConnect', () => () => ({
  targetId: ref(null),
  draft: ref(null),
  open: mocks.connectOpen,
  openDraft: mocks.connectOpenDraft,
  close: vi.fn(),
}))

describe('connector directory composable', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset()
    }
    mocks.refreshConnectors.mockResolvedValue(undefined)
  })

  it('starts a registry entry as a draft by its directory id and stores '
    + 'nothing', () => {
    useConnectorDirectoryActions().add(createDirectoryItem())

    expect(mocks.connectOpenDraft).toHaveBeenCalledWith({
      registryId: 'io.example/tracker@1.0.0',
    })
    expect(mocks.connectOpen).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.refreshConnectors).not.toHaveBeenCalled()
  })

  it('starts a preset entry as a draft by its preset id', () => {
    useConnectorDirectoryActions().add(createDirectoryItem({
      id: 'preset:github',
      presetId: 'github',
    }))

    expect(mocks.connectOpenDraft).toHaveBeenCalledWith({
      presetId: 'github',
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('finishes the row that never connected instead of adding another', () => {
    useConnectorDirectoryActions().add(createDirectoryItem({
      addedConnectorId: 'conn3',
    }))

    expect(mocks.connectOpen).toHaveBeenCalledWith('conn3')
    expect(mocks.connectOpenDraft).not.toHaveBeenCalled()
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
